import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uuid = s => {
  const h = crypto.createHash("sha256").update("audit12-remediation:" + s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const [TEAM_A, TEAM_B, EA, EB, EC, CALLUP_B, CALLUP_C, P1, P2] =
  ["TEAM_A", "TEAM_B", "EA", "EB", "EC", "CALLUP_B", "CALLUP_C", "P1", "P2"].map(uuid);

const storage = new Map();
const nodes = new Map();

globalThis.localStorage = {
  getItem: k => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear()
};
globalThis.sessionStorage = { clear() {} };

function el(id) {
  if (!nodes.has(id)) {
    const classes = new Set();
    let html = "", text = "";
    nodes.set(id, {
      id,
      value: "",
      disabled: false,
      style: {},
      dataset: {},
      classList: {
        add(...xs) { xs.forEach(x => classes.add(x)); },
        remove(...xs) { xs.forEach(x => classes.delete(x)); },
        contains: x => classes.has(x),
        toggle(x, on) { if (on ?? !classes.has(x)) classes.add(x); else classes.delete(x); }
      },
      get innerHTML() { return html; },
      set innerHTML(v) { html = String(v); text = String(v).replace(/<[^>]*>/g, ""); },
      get textContent() { return text; },
      set textContent(v) { text = String(v); html = String(v); },
      focus() {},
      click() { if (typeof this.onclick === "function") this.onclick(); },
      addEventListener() {},
      querySelector(selector) {
        if (selector === "span" || selector === "span:first-child") {
          return el(id + "-span");
        }
        return null;
      },
      querySelectorAll() { return []; },
      setAttribute() {},
      removeAttribute() {}
    });
  }
  return nodes.get(id);
}

globalThis.document = {
  getElementById: el,
  addEventListener() {},
  querySelectorAll() { return []; },
  querySelector(sel) {
    if (sel === "#screen_e_create_squad footer button") {
      const btn = el("screen_e_create_squad-btn");
      btn.querySelector = () => el("screen_e_create_squad-btn-span");
      return btn;
    }
    if (sel.includes("hub-hero-title")) return el("hub-hero-title");
    return null;
  }
};

globalThis.window = {
  localStorage: globalThis.localStorage,
  location: { search: "", hash: "", pathname: "/" },
  history: { replaceState() {} }
};

const defer = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const { TeamAppState } = await import("../app.js");
const { api } = await import("../src/api/index.js");

const patches = [];
function patch(obj, key, val) {
  patches.push([obj, key, obj[key]]);
  obj[key] = val;
}
function restoreAllPatches() {
  while (patches.length) {
    const [obj, key, val] = patches.pop();
    obj[key] = val;
  }
}

function freshApp(role = "coach", mode = "BETA_NORMAL") {
  restoreAllPatches();
  storage.clear();
  nodes.clear();
  api.client.setToken("TOKEN_SYNTHETIC_ACTIVE");

  const a = new TeamAppState();
  a.appMode = mode;
  a.currentRole = role;
  a.currentSessionId = "SESSION_SYNTHETIC_1";
  a.tokens.coach = "TOKEN_SYNTHETIC_ACTIVE";
  a.tokens.parent = "TOKEN_SYNTHETIC_ACTIVE";
  a.beta.teamSeasonId = TEAM_A;
  a.beta.activeEventId = EA;
  a.beta.guardianPlayer = role === "parent" ? { id: P1, playerId: P1 } : null;
  a.currentScreen = role === "coach" ? "v2_01_coach_home" : "v2_07_parent_home";
  a.showToast = () => {};
  a.goToScreen = async screen => { a.currentScreen = screen; };
  return a;
}

// ============================================================================
// 1. D12-F01: prepareAndPublishCallup B late cannot override confirmed C
// ============================================================================
test("D12-F01 & Priority 1: B slow during players phase cannot overwrite C nor dispatch new POSTs", async () => {
  const a = freshApp();
  const gB_players = defer();
  const ledger = [];

  patch(api.teams, "getPlayers", async teamSeasonId => {
    ledger.push({ method: "GET", url: `/teams/${teamSeasonId}/players` });
    return gB_players.promise;
  });

  patch(api.callup, "createDraft", async (eventId, playerIds) => {
    ledger.push({ method: "POST", url: `/events/${eventId}/callup`, body: { playerIds } });
    return { id: eventId === EB ? CALLUP_B : CALLUP_C, event_id: eventId, team_season_id: TEAM_A, status: "DRAFT", version: 1, warnings: [] };
  });

  patch(api.callup, "publishCallup", async (callupId, payload) => {
    ledger.push({ method: "POST", url: `/callups/${callupId}/publish`, body: payload });
    const evId = callupId === CALLUP_B ? EB : EC;
    return { id: callupId, event_id: evId, team_season_id: TEAM_A, status: "PUBLISHED", version: 2, warnings: [] };
  });

  // B starts prepareAndPublishCallup and hangs on getPlayers
  const pB = a.prepareAndPublishCallup(EB);

  // While B is hanging on getPlayers, C is invoked with immediate players resolution
  patch(api.teams, "getPlayers", async () => ({ items: [{ id: P1 }] }));
  await a.prepareAndPublishCallup(EC);

  assert.equal(a.beta.activeEventId, EC, "C must be confirmed as activeEventId");
  assert.equal(a.live.callup?.event_id, EC, "live.callup must point to C");
  assert.equal(localStorage.getItem("talde_active_event_id"), EC, "Storage must be EC");

  const boundaryRequestsCount = ledger.length;

  // Now B's players call resolves
  gB_players.resolve({ items: [{ id: P1 }] });
  await pB;

  // B MUST NOT override C
  assert.equal(a.beta.activeEventId, EC, "Stale B must NOT replace confirmed C in activeEventId");
  assert.equal(a.live.callup?.event_id, EC, "Stale B must NOT replace confirmed C in live.callup");
  assert.equal(localStorage.getItem("talde_active_event_id"), EC, "Stale B must NOT replace storage");

  // B MUST NOT dispatch further requests (no draft, no publish)
  const newRequests = ledger.slice(boundaryRequestsCount);
  assert.equal(newRequests.length, 0, "Stale B must NOT dispatch new HTTP requests after being superseded");
});

test("D12-F01 & Priority 1: B slow during publish phase reconciles in store but does NOT steal active selection from C", async () => {
  const a = freshApp();
  const gB_publish = defer();
  let hitPublish = false;

  patch(api.teams, "getPlayers", async () => ({ items: [{ id: P1 }] }));
  patch(api.callup, "createDraft", async (eventId, playerIds) => ({
    id: eventId === EB ? CALLUP_B : CALLUP_C,
    event_id: eventId,
    team_season_id: TEAM_A,
    status: "DRAFT",
    version: 1,
    warnings: []
  }));

  patch(api.callup, "publishCallup", async (callupId, payload) => {
    if (callupId === CALLUP_B) {
      hitPublish = true;
      return gB_publish.promise;
    }
    return { id: callupId, event_id: EC, team_season_id: TEAM_A, status: "PUBLISHED", version: 2, warnings: [] };
  });

  // B starts and reaches publish
  const pB = a.prepareAndPublishCallup(EB);

  // Wait until B reaches publish
  for (let i = 0; i < 500 && !hitPublish; i++) {
    await new Promise(r => setTimeout(r, 2));
  }
  assert.equal(hitPublish, true, "B must have reached publish request");

  // C starts and finishes
  await a.prepareAndPublishCallup(EC);
  assert.equal(a.beta.activeEventId, EC, "C confirmed");

  // Now B's publish resolves
  gB_publish.resolve({
    id: CALLUP_B,
    event_id: EB,
    team_season_id: TEAM_A,
    status: "PUBLISHED",
    version: 2,
    warnings: []
  });
  await pB;

  // C remains active
  assert.equal(a.beta.activeEventId, EC, "C must remain active");
  assert.equal(a.live.callup?.event_id, EC, "live.callup must remain C");

  // But B MUST be reconciled in ResourceStore
  const storedB = a.resourceStore.getCallup({
    teamSeasonId: TEAM_A,
    eventId: EB,
    callupId: CALLUP_B,
    namespace: "live"
  });
  assert.ok(storedB, "B must be reconciled into ResourceStore");
  assert.equal(storedB.status, "PUBLISHED");
  assert.equal(storedB.version, 2);
});

// ============================================================================
// 2. Priority 2: 401 Classification on Active Credential Across Event Shift
// ============================================================================
test("Priority 2: 401 on active session during callup publish expires session even if event shifted", async () => {
  const a = freshApp();
  let sessionExpiredCalled = false;
  patch(a, "handleSessionExpired", (err, scope) => {
    sessionExpiredCalled = true;
    a.clearSessionData();
  });

  patch(api.teams, "getPlayers", async () => ({ items: [{ id: P1 }] }));
  const gB_draft = defer();
  patch(api.callup, "createDraft", async (eventId) => {
    if (eventId === EB) return gB_draft.promise;
    return { id: CALLUP_C, event_id: EC, team_season_id: TEAM_A, status: "DRAFT", version: 1 };
  });

  const pB = a.prepareAndPublishCallup(EB);

  // User shifts context to EC
  a.beta.activeEventId = EC;

  // Backend rejects active token with 401
  const err401 = new Error("Token revoked");
  err401.status = 401;
  err401.wasAuthenticated = true;
  gB_draft.reject(err401);

  await pB.catch(() => {});

  assert.equal(sessionExpiredCalled, true, "401 on active credential MUST expire session even if activeEventId shifted");
});

test("Priority 2: 401 from superseded session does NOT expire active session", async () => {
  const a = freshApp();

  const staleScope = a.createScope({ role: "coach" });
  staleScope.sessionId = "OLD_SESSION_ID";

  const err401 = new Error("Token expired");
  err401.status = 401;
  err401.wasAuthenticated = true;

  // Call real handleSessionExpired with stale scope
  a.handleSessionExpired(err401, staleScope);

  // Active session MUST survive
  assert.equal(a.currentSessionId, "SESSION_SYNTHETIC_1", "401 from superseded session MUST NOT clear currentSessionId");
  assert.equal(api.client.getToken(), "TOKEN_SYNTHETIC_ACTIVE", "401 from superseded session MUST NOT clear active token");
});

// ============================================================================
// 3. Priority 5: RSVP Monotonic Version Reconciliation
// ============================================================================
test("Priority 5: saveParentRsvp reconciles returned version into live and store, subsequent mutation sends expectedVersion", async () => {
  const a = freshApp("parent");
  a.beta.activeEventId = EA;
  a.live.parentAvailability = { version: 7, status: "UNDECIDED" };
  a.parentRsvpChoice = "SI";

  let capturedMutation = null;
  patch(api.availability, "setGuardianAvailability", async (eventId, playerId, payload) => {
    capturedMutation = payload;
    return { status: "CAN_ATTEND", version: 8 };
  });

  await a.saveParentRsvp();

  // 1. Initial mutation sent expectedVersion: 7
  assert.equal(capturedMutation.expectedVersion, 7);

  // 2. live.parentAvailability updated to returned version 8
  assert.equal(a.live.parentAvailability.version, 8);
  assert.equal(a.live.parentAvailability.status, "CAN_ATTEND");

  // 3. ResourceStore holds version 8 (with namespace: "live")
  const inStore = a.resourceStore.getAvailability({
    teamSeasonId: TEAM_A,
    eventId: EA,
    playerId: P1,
    namespace: "live"
  });
  assert.equal(inStore?.version, 8);

  // 4. Second mutation sends expectedVersion: 8
  a.parentRsvpChoice = "NO";
  await a.saveParentRsvp();
  assert.equal(capturedMutation.expectedVersion, 8, "Second mutation must send expectedVersion: 8");
});

test("Priority 5: Stale availability response cannot downgrade monotonic version in store", async () => {
  const a = freshApp("parent");
  const store = a.resourceStore;
  const key = { teamSeasonId: TEAM_A, eventId: EA, playerId: P1, namespace: "live" };

  const res1 = store.reconcileAvailability(key, { version: 8, status: "CAN_ATTEND" });
  assert.equal(res1.applied, true);
  assert.equal(store.getAvailability(key)?.version, 8);

  // Attempting to reconcile older version 7 should be rejected as stale_version
  const res2 = store.reconcileAvailability(key, { version: 7, status: "CANNOT_ATTEND" });
  assert.equal(res2.applied, false);
  assert.equal(res2.reason, "stale_version");

  assert.equal(store.getAvailability(key)?.version, 8, "Store must keep version 8");
});

// ============================================================================
// 4. Priority 4: Auto-hub Selection & Pending Intent Block
// ============================================================================
test("Priority 4: Pending intent on event B prevents null-hub from adopting event A", async () => {
  const a = freshApp();
  a.beta.activeEventId = null;

  // Start an intent for EB
  const token = a.concurrencyTracker.startIntent("event", EB);
  assert.equal(a.concurrencyTracker.hasPendingIntent("event"), true);

  const gList = defer();
  patch(api.events, "getEvents", async () => gList.promise);
  patch(api.events, "getEvent", async id => ({ id, team_season_id: TEAM_A, status: "ACTIVE", callup_enabled: true }));
  patch(api.availability, "getEventAvailability", async () => ({ counts: {}, items: [] }));
  patch(api.teams, "getPlayers", async () => ({ items: [] }));

  const pHub = a.syncEventHubNormal();

  gList.resolve({ items: [{ id: EA, status: "ACTIVE" }, { id: EB, status: "ACTIVE" }] });
  await pHub;

  // Because an intent is pending, null-hub MUST NOT auto-commit EA
  assert.notEqual(a.beta.activeEventId, EA, "Null hub must not adopt EA while an intent is pending");

  a.concurrencyTracker.discardIntent(token);
});

// ============================================================================
// 5. Priority 6: Pure Domain Delegation
// ============================================================================
test("Priority 6: TeamAppState delegates callup publishing and RSVP to domain controllers", async () => {
  const a = freshApp();

  let eventsDomainCalled = false;
  patch(a.eventsDomain, "prepareAndPublishCallup", async () => {
    eventsDomainCalled = true;
  });

  await a.prepareAndPublishCallup(EB);
  assert.equal(eventsDomainCalled, true, "TeamAppState.prepareAndPublishCallup must delegate to eventsDomain");

  let familiesDomainCalled = false;
  patch(a.familiesDomain, "saveParentRsvp", async () => {
    familiesDomainCalled = true;
  });

  await a.saveParentRsvp();
  assert.equal(familiesDomainCalled, true, "TeamAppState.saveParentRsvp must delegate to familiesDomain");
});
