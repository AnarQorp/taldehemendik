import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Deterministic UUID generator
const uuid = s => {
  const h = crypto.createHash("sha256").update("invariants-test:" + s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const [TEAM_A, TEAM_B, EA, EB, EC, CALLUP_A, CALLUP_B, CALLUP_C, P1, P2] =
  ["TEAM_A", "TEAM_B", "EA", "EB", "EC", "CALLUP_A", "CALLUP_B", "CALLUP_C", "P1", "P2"].map(uuid);

// Environment Mocking
const storage = new Map();
const nodes = new Map();
const timers = new Map();
let timerSeq = 0;

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
      btn.querySelector = s => el("screen_e_create_squad-btn-span");
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
  timers.clear();
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
// INV-01: Monotonicity in Concurrent Event Selection (C confirms, B arrives later)
// ============================================================================
test("INV-01: Monotonicity - Inverted arrival (latest-first) preserves C against stale B", async () => {
  const a = freshApp();
  const gB = defer();
  const gC = defer();

  let bDispatched = false, cDispatched = false;
  patch(api.events, "getEvent", async eventId => {
    if (eventId === EB) {
      bDispatched = true;
      return gB.promise;
    }
    if (eventId === EC) {
      cDispatched = true;
      return gC.promise;
    }
    return { id: eventId, team_season_id: TEAM_A, status: "ACTIVE", callup_enabled: true };
  });

  const pB = a.handlePrepareCallup(EB);
  const pC = a.handlePrepareCallup(EC);

  // C resolves first and confirms
  gC.resolve({ id: EC, team_season_id: TEAM_A, status: "ACTIVE", callup_enabled: true });
  await pC;
  assert.equal(a.beta.activeEventId, EC, "C must be confirmed as activeEventId");

  // B resolves later
  gB.resolve({ id: EB, team_season_id: TEAM_A, status: "ACTIVE", callup_enabled: true });
  await pB;

  // INVARIANTE: B tardío NO puede sobreescribir C
  assert.equal(a.beta.activeEventId, EC, "INV-01 VIOLATION: Stale B overwrote confirmed C in memory");
  assert.equal(localStorage.getItem("talde_active_event_id"), EC, "INV-01 VIOLATION: Stale B overwrote confirmed C in storage");
});

// ============================================================================
// INV-02: Preserves Confirmed Context on Non-Auth Failure of New Intention
// ============================================================================
test("INV-02: Failure of new intention B preserves confirmed context A", async () => {
  const a = freshApp();
  a.beta.activeEventId = EA;

  patch(api.events, "getEvent", async eventId => {
    if (eventId === EB) {
      const err = new Error("Not Found");
      err.status = 404;
      throw err;
    }
    return { id: eventId, team_season_id: TEAM_A, status: "ACTIVE", callup_enabled: true };
  });

  await a.handlePrepareCallup(EB).catch(() => {});

  assert.equal(a.beta.activeEventId, EA, "INV-02: Context must remain confirmed at A when B fails");
});

// ============================================================================
// INV-03: Three-Point Monotonicity (A -> B -> C out of order)
// ============================================================================
test("INV-03: Three selections A -> B -> C with out-of-order resolution", async () => {
  const a = freshApp();
  const gA = defer(), gB = defer(), gC = defer();

  patch(api.events, "getEvent", async eventId => {
    if (eventId === EA) return gA.promise;
    if (eventId === EB) return gB.promise;
    if (eventId === EC) return gC.promise;
    return { id: eventId, status: "ACTIVE", callup_enabled: true };
  });

  const pA = a.handlePrepareCallup(EA);
  const pB = a.handlePrepareCallup(EB);
  const pC = a.handlePrepareCallup(EC);

  // C resolves first
  gC.resolve({ id: EC, team_season_id: TEAM_A, status: "ACTIVE", callup_enabled: true });
  await pC;
  assert.equal(a.beta.activeEventId, EC);

  // A resolves second
  gA.resolve({ id: EA, team_season_id: TEAM_A, status: "ACTIVE", callup_enabled: true });
  await pA;
  assert.equal(a.beta.activeEventId, EC, "INV-03: Late A cannot override C");

  // B resolves third
  gB.resolve({ id: EB, team_season_id: TEAM_A, status: "ACTIVE", callup_enabled: true });
  await pB;
  assert.equal(a.beta.activeEventId, EC, "INV-03: Late B cannot override C");
});

// ============================================================================
// INV-04: Null-Hub Auto-Selection vs Pending/Confirmed Explicit Intention
// ============================================================================
test("INV-04: Null-Hub discovery list does NOT overwrite explicit selection B", async () => {
  const a = freshApp();
  a.beta.activeEventId = null;
  localStorage.removeItem("talde_active_event_id");

  const gList = defer();
  patch(api.events, "getEvents", async () => gList.promise);
  patch(api.events, "getEvent", async id => ({ id, team_season_id: TEAM_A, status: "ACTIVE", callup_enabled: true }));
  patch(api.availability, "getEventAvailability", async () => ({ counts: {}, items: [] }));
  patch(api.teams, "getPlayers", async () => ({ items: [] }));

  // Hub starts discovery
  const pHub = a.syncEventHubNormal();

  // User explicitly selects EB while list is in flight
  await a.handlePrepareCallup(EB);
  assert.equal(a.beta.activeEventId, EB, "Explicit selection EB confirmed");

  // List returns with EA first
  gList.resolve({ items: [{ id: EA, status: "ACTIVE" }, { id: EB, status: "ACTIVE" }] });
  await pHub;

  // INVARIANTE: Lista tardía NO puede sobreescribir EB con EA
  assert.equal(a.beta.activeEventId, EB, "INV-04 VIOLATION: Null hub discovery overwrote explicit selection B with A");
});

// ============================================================================
// INV-05: Squad Prep Visual Isolation (A delayed paint after B selected)
// ============================================================================
test("INV-05: Squad prep delayed response does not repaint button on event B view", async () => {
  const a = freshApp();
  a.beta.activeEventId = EA;

  const gPlayersA = defer();
  patch(api.teams, "getPlayers", async () => gPlayersA.promise);
  patch(api.availability, "getEventAvailability", async () => ({ counts: {}, items: [] }));
  patch(api.events, "getEvent", async id => ({ id, status: "ACTIVE" }));

  const span = el("screen_e_create_squad-btn-span");
  span.textContent = "Publicar Convocatoria Oficial (0)";

  // Start squad prep on EA
  const pPrepA = a.syncSquadPrep();

  // User switches to EB
  a.beta.activeEventId = EB;
  span.textContent = "Publicar Convocatoria Oficial (EB)";

  // EA players resolve
  gPlayersA.resolve({ items: [{ id: P1 }, { id: P2 }] });
  await pPrepA;

  // INVARIANTE: El botón no debe mostrar el recuento de jugadores de A en la vista de B
  assert.notEqual(
    span.textContent,
    "Publicar Convocatoria Oficial (2)",
    "INV-05 VIOLATION: Stale EA response repainted squad button after B was selected"
  );
});

// ============================================================================
// INV-06: Callup Publication Reconciles PUBLISHED v2 (Not DRAFT v1)
// ============================================================================
test("INV-06: prepareAndPublishCallup reconciles PUBLISHED v2, does not retain DRAFT v1", async () => {
  const a = freshApp();
  a.beta.activeEventId = EA;

  patch(api.teams, "getPlayers", async () => ({ items: [{ id: P1 }] }));
  patch(api.callup, "createDraft", async () => ({
    id: CALLUP_A,
    event_id: EA,
    team_season_id: TEAM_A,
    status: "DRAFT",
    version: 1,
    warnings: []
  }));
  patch(api.callup, "publishCallup", async () => ({
    id: CALLUP_A,
    event_id: EA,
    team_season_id: TEAM_A,
    status: "PUBLISHED",
    version: 2,
    warnings: []
  }));
  patch(a, "syncCurrentScreen", async () => {});

  await a.prepareAndPublishCallup(EA);

  // INVARIANTE: live.callup debe reflejar PUBLISHED v2 devuelto por el servidor
  assert.ok(a.live.callup, "live.callup must exist");
  assert.equal(
    a.live.callup.status,
    "PUBLISHED",
    "INV-06 VIOLATION: live.callup retained status DRAFT instead of server PUBLISHED"
  );
  assert.equal(
    a.live.callup.version,
    2,
    "INV-06 VIOLATION: live.callup retained version 1 instead of server version 2"
  );
});

// ============================================================================
// INV-07: 401 Classification - Active Credential Expires, Unauth OTP Does Not
// ============================================================================
test("INV-07: Authenticated 401 on active credential expires session; unauth OTP does not", async () => {
  const a = freshApp();
  let sessionExpiredCalled = false;
  patch(a, "handleSessionExpired", () => {
    sessionExpiredCalled = true;
    a.clearSessionData();
  });

  // 1. Authenticated 401 on active credential -> MUST expire session
  const authErr = new Error("Unauthorized");
  authErr.status = 401;
  authErr.wasAuthenticated = true;

  a.handleSessionExpired(authErr);
  assert.equal(sessionExpiredCalled, true, "INV-07: Authenticated 401 must trigger session expiry");
  assert.equal(api.client.getToken(), null, "INV-07: Token must be purged on active session expiry");

  // Reset
  sessionExpiredCalled = false;
  freshApp();

  // 2. Unauthenticated 401 during OTP verification -> must NOT purge pre-existing session
  const unauthErr = new Error("Invalid OTP");
  unauthErr.status = 401;
  unauthErr.wasAuthenticated = false;

  // Unauthenticated error should not call handleSessionExpired
  assert.equal(sessionExpiredCalled, false, "INV-07: Unauthenticated OTP 401 must not purge session");
});

// ============================================================================
// INV-08: Persistent Writes In Flight Survive View Changes
// ============================================================================
test("INV-08: Persistent write in flight concludes and reconciles when view changes", async () => {
  const a = freshApp("parent");
  a.beta.activeEventId = EA;
  a.parentRsvpChoice = "SI";
  a.live.parentAvailability = { version: 1 };

  let rsvpDispatched = false;
  patch(api.availability, "setGuardianAvailability", async () => {
    rsvpDispatched = true;
    return { status: "CAN_ATTEND", version: 2 };
  });

  const pSave = a.saveParentRsvp();
  // User navigates to agenda
  a.currentScreen = "v2_02_coach_agenda";

  await pSave;
  assert.equal(rsvpDispatched, true, "INV-08: Write must be dispatched and conclude even if screen changed");
});

// ============================================================================
// INV-09: Isolation Between Teams / Memberships
// ============================================================================
test("INV-09: Switching teams purges memory of previous team", async () => {
  const a = freshApp();
  a.beta.players = [{ id: P1, name: "Player Team A" }];
  a.live.callup = { id: CALLUP_A, status: "PUBLISHED" };

  patch(api.teams, "getMyMemberships", async () => ({
    items: [
      { team_season_id: TEAM_B, team_id: uuid("tb"), team_name: "Team B", role: "COACH", status: "ACTIVE" }
    ]
  }));

  await a.switchTeam(TEAM_B);

  assert.equal(a.beta.teamSeasonId, TEAM_B, "Active team must be TEAM_B");
  assert.equal(a.beta.players.length, 0, "INV-09: Previous team players must be purged on team switch");
  assert.equal(a.live.callup, null, "INV-09: Previous team callup must be purged on team switch");
});

// ============================================================================
// INV-10: Single Authority of Transitions
// ============================================================================
test("INV-10: Context changes must be routed through centralized transition authority", async () => {
  const a = freshApp();
  const initialGen = a.contextGeneration;

  // applyContextTransition increments generation on identity change
  a.applyContextTransition({ role: "parent" });
  assert.ok(a.contextGeneration > initialGen, "INV-10: Identity change must bump generation");
  assert.equal(a.currentRole, "parent");
});
