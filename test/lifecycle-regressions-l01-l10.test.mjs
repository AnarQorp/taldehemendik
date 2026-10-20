import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Environment Mocking for Node.js test environment
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
        if (selector === "b" && html.includes("<b")) return { click() { if (globalThis.s !== undefined) globalThis.s = 1; } };
        if (selector === "img" && html.includes("<img")) return { src: "" };
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
    if (sel === "#agenda-season-label b") {
      const parent = nodes.get("agenda-season-label");
      if (parent && parent.innerHTML.includes("<b")) {
        return { click() { if (globalThis.s !== undefined) globalThis.s = 1; } };
      }
      return null;
    }
    return null;
  }
};

globalThis.window = {
  localStorage: globalThis.localStorage,
  location: { search: "", hash: "", pathname: "/" },
  history: { replaceState() {} }
};

globalThis.setTimeout = fn => {
  const id = ++timerSeq;
  timers.set(id, fn);
  return id;
};
globalThis.clearTimeout = id => timers.delete(id);
globalThis.setInterval = globalThis.setTimeout;
globalThis.clearInterval = globalThis.clearTimeout;

const { TeamAppState } = await import("../app.js");
const { api } = await import("../src/api/index.js");
const { ApiClient } = await import("../src/api/client.js");
const { DomainError } = await import("../src/api/errors.js");
const { AuthService } = await import("../src/api/auth.js");

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

function fresh() {
  restoreAllPatches();
  storage.clear();
  nodes.clear();
  timers.clear();
  api.client.setToken("A");
  const a = new TeamAppState();
  a.appMode = "BETA_NORMAL";
  a.currentRole = "coach";
  a.tokens.coach = "A";
  a.beta.teamSeasonId = "A";
  a.beta.activeEventId = "EV-A";
  a.goToScreen = async s => { a.currentScreen = s; };
  a.showToast = m => { a.lastToast = m; };
  a.applyCleanUI = () => {};
  a.updateRoleUI = () => {};
  a.updateBottomNav = () => {};
  return a;
}

const defer = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

test("L01: login success callback does NOT survive session purge / context switch", async () => {
  const a = fresh(), d = defer();
  patch(api.teams, "getMyMemberships", () => d.promise);
  await a.promptEmailLogin();
  const cb = a.otpState.onSuccess;
  const p = cb({ accessToken: "OLD-A" });
  a.clearSessionData();
  a.tokens.coach = "NEW-B";
  a.beta.teamSeasonId = "B";
  api.client.setToken("NEW-B");
  d.resolve({ items: [{ role: "COACH", status: "ACTIVE", team_season_id: "A", team_name: "Private A" }] });
  await p;
  assert.equal(a.beta.teamSeasonId, "B", "Team B must NOT be overwritten by stale callback for Team A");
  assert.equal(a.tokens.coach, "NEW-B", "Token NEW-B must NOT be overwritten by stale callback for OLD-A");
});

test("L02: prepareAndPublishCallup does NOT proceed after session purge / context switch", async () => {
  const a = fresh(), d = defer(), writes = [];
  patch(api.teams, "getPlayers", () => d.promise);
  patch(api.callup, "createDraft", async (...args) => { writes.push(["draft", ...args]); return { id: "D-A", version: 1 }; });
  patch(api.callup, "publishCallup", async (...args) => { writes.push(["publish", ...args]); return { id: "D-A" }; });
  patch(a, "syncCurrentScreen", async () => {});

  const p = a.prepareAndPublishCallup("EV-A");
  await flush();
  a.clearSessionData();
  api.client.setToken("NEW-B");
  d.resolve({ items: [{ id: "CHILD-A" }] });
  await p;
  assert.equal(writes.length, 0, "No drafts or publications must be issued after session purge");
});

test("L03: executePublishCallupFromSquad does NOT overwrite new context or new screen", async () => {
  const a = fresh(), d = defer();
  patch(api.teams, "getPlayers", async () => ({ items: [{ id: "CHILD-A" }] }));
  patch(api.availability, "getEventAvailability", async () => ({ items: [] }));
  patch(api.callup, "createDraft", async () => ({ id: "D-A", version: 1 }));
  patch(api.callup, "publishCallup", () => d.promise);

  const p = a.executePublishCallupFromSquad();
  await flush();
  a.clearSessionData();
  a.beta.teamSeasonId = "B";
  a.currentScreen = "B-SCREEN";
  d.resolve({ id: "PRIVATE-CALLUP-A" });
  await p;
  assert.equal(a.live.callup, null, "Callup from old context must not overwrite active state");
  assert.equal(a.currentScreen, "B-SCREEN", "Navigation must not switch back to old event hub");
});

test("L04: Delayed RSVP navigation callback does NOT execute after purge", async () => {
  const a = fresh();
  patch(api.availability, "setGuardianAvailability", async () => ({}));
  await a.saveParentRsvp();
  a.clearSessionData();
  a.currentScreen = "B-SCREEN";
  for (const fn of [...timers.values()]) fn();
  assert.equal(a.currentScreen, "B-SCREEN", "Delayed timer must not navigate after purge");
});

test("L05: Session purge clears private modal inputs, active event ID, and selections", () => {
  const a = fresh();
  storage.set("talde_active_event_id", "PRIVATE-EVENT-A");
  el("modal-player-firstname").value = "PRIVATE CHILD";
  el("modal-invite-link-input").value = "PRIVATE INVITE";
  el("modal-invite-title").textContent = "PRIVATE FAMILY";
  a.selectedCandidateId = "CHILD-A";
  a.selectedSubstitute = "PRIVATE SUBSTITUTE";

  a.clearSessionData();

  assert.equal(globalThis.localStorage.getItem("talde_active_event_id"), null, "Active event ID must be removed from storage");
  assert.equal(el("modal-player-firstname").value, "", "Modal player input must be cleared");
  assert.equal(el("modal-invite-link-input").value, "", "Modal invite link must be cleared");
  assert.equal(a.selectedCandidateId, null, "Candidate selection must be nulled");
  assert.equal(a.selectedSubstitute, null, "Substitute selection must be nulled");
});

test("L06: Unauthenticated 401 on OTP verification does NOT purge active session", async () => {
  const a = fresh();
  patch(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { code: "AUTH_INVALID", message: "wrong OTP" } }), {
    status: 401,
    headers: { "content-type": "application/json" }
  }));
  const c = new ApiClient("http://fixture.invalid");
  c.setToken("EXISTING");
  let err;
  try {
    await c.post("/auth/otp/verify", {});
  } catch (e) {
    err = e;
  }
  assert.equal(err.wasAuthenticated, false, "OTP verification 401 must have wasAuthenticated = false");
  a.handleSessionExpired(err);
  assert.equal(api.client.getToken(), "A", "Active bearer must remain intact on invalid OTP 401");
});

test("L07: 401 during publishCallup DOES trigger handleSessionExpired and purges session", async () => {
  const a = fresh();
  storage.set("talde_session_token", "A");
  patch(api.teams, "getPlayers", async () => ({ items: [{ id: "CHILD-A" }] }));
  patch(api.callup, "createDraft", async () => ({ id: "D-A" }));
  patch(api.callup, "publishCallup", async () => {
    throw Object.assign(new DomainError("AUTH_EXPIRED", "expired", 401), { wasAuthenticated: true });
  });

  await a.prepareAndPublishCallup("EV-A");
  assert.equal(globalThis.localStorage.getItem("talde_session_token"), null, "Session token must be purged from storage on 401");
  assert.equal(api.client.getToken(), null, "Client bearer token must be purged on 401");
});

test("L08: Late DEMO login does NOT reinstall bearer token into BETA_NORMAL mode", async () => {
  const a = fresh(), d = defer();
  a.appMode = "DEMO";
  a.tokens.coach = null;
  patch(api.auth, "loginDev", () => d.promise);
  const p = a.ensureAuth("coach");
  a.setAppMode("BETA_NORMAL");
  d.resolve({ accessToken: "OLD-DEMO" });
  await p;
  assert.notEqual(api.client.getToken(), "OLD-DEMO", "Demo token must not be installed in BETA_NORMAL mode");
  assert.equal(a.tokens.coach, null, "Coach token must not be set to old demo token");
});

test("L09: switchTeam resets beta.players, guardianPlayer, and clears player-detail DOM", async () => {
  const a = fresh();
  a.currentRole = "parent";
  a.beta.guardianPlayer = { id: "PRIVATE-CHILD-A" };
  a.beta.guardianPlayers = [a.beta.guardianPlayer];
  a.beta.players = [{ id: "PRIVATE-ROSTER-A" }];
  el("player-detail-parent-container").innerHTML = "PRIVATE CHILD A";

  patch(api.teams, "getMyMemberships", async () => ({ items: [{ role: "COACH", status: "ACTIVE", team_season_id: "B" }] }));
  await a.switchTeam("B");

  assert.equal(a.beta.guardianPlayer, null, "Guardian player from prior family must be nulled on coach team switch");
  assert.deepEqual(a.beta.players, [], "Players from prior team must be wiped on switch");
  assert.equal(el("player-detail-parent-container").innerHTML, "", "Player detail DOM must be cleared");
});

test("L10: selectGuardianChild increments contextGeneration and invalidates in-flight child detail sync", async () => {
  const a = fresh(), d = defer();
  a.currentRole = "parent";
  a.beta.guardianPlayers = [
    { id: "CHILD-A", first_name: "Private", last_name: "Child A" },
    { id: "CHILD-B", first_name: "Child", last_name: "B" }
  ];
  a.beta.guardianPlayer = a.beta.guardianPlayers[0];

  patch(api.events, "getEvents", async () => ({
    items: [{ id: "EV-A", title: "EVENT A", starts_at: "2026-10-20T12:00:00Z", callup_enabled: true, callup_status: "PUBLISHED" }]
  }));
  patch(api.callup, "getPlayerCallupStatus", () => d.promise);

  const initialGen = a.contextGeneration;
  const p = a.syncPlayerDetail();
  await flush();

  patch(a, "syncCurrentScreen", async () => {
    el("player-detail-parent-container").innerHTML = "NEW CHILD B";
  });

  a.selectGuardianChild("CHILD-B");
  assert.ok(a.contextGeneration > initialGen, "selectGuardianChild must increment contextGeneration");

  d.resolve({ called: true });
  await p;

  assert.equal(a.beta.guardianPlayer.id, "CHILD-B", "Active child must remain Child B");
  assert.ok(!el("player-detail-parent-container").innerHTML.includes("Private"), "Old Child A details must not overwrite Child B view");
});

test("C01: AuthService.verifyOtp does NOT install token in ApiClient (Positive Control)", async () => {
  restoreAllPatches();
  storage.clear();
  const c = new ApiClient("http://fixture.invalid");
  c.setToken("PREVIOUS");
  patch(globalThis, "fetch", async () => new Response(JSON.stringify({ accessToken: "NEW" }), {
    status: 200,
    headers: { "content-type": "application/json" }
  }));
  const res = await new AuthService(c).verifyOtp("fixture@example.test", "challenge", "123456", "Fixture");
  assert.equal(res.accessToken, "NEW");
  assert.equal(c.getToken(), "PREVIOUS", "AuthService must not mutate client token directly");
  assert.equal(storage.size, 0, "AuthService must not write to localStorage");
});

test("C02: clearSessionData preserves unrelated localStorage keys (Positive Control)", () => {
  const a = fresh();
  storage.set("unrelated-app-key", "KEEP");
  a.clearSessionData();
  assert.equal(storage.get("unrelated-app-key"), "KEEP", "Unrelated keys in localStorage must be preserved");
});

test("P1 XSS Regression: season_label is sanitized in syncCoachAgenda", async () => {
  const a = fresh();
  globalThis.s = 0;
  a.beta.teamSeasonId = null;
  a.beta.teamSeason = { season_label: '<b onclick="s=1">x</b>' };

  await a.syncCoachAgenda();

  const container = nodes.get("agenda-season-label");
  assert.ok(container, "agenda-season-label container must exist");
  assert.ok(!container.innerHTML.includes("<b onclick="), "Raw <b tag must NOT exist in innerHTML");
  assert.ok(container.innerHTML.includes("&lt;b onclick="), "Special characters in season_label must be HTML-escaped");
  assert.equal(globalThis.s, 0, "Injected click handler must not have run");
});

test("G1-A4 CSP Verification: HTML Meta-Directives and HTTP Response Headers", () => {
  const indexPath = path.join(projectRoot, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");

  // Verify presence of CSP meta tag using double-quote match
  const cspMetaMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  assert.ok(cspMetaMatch, "index.html must contain a Content-Security-Policy meta tag");

  const cspContent = cspMetaMatch[1];

  // Verify crucial HTML-enforceable directives
  assert.ok(cspContent.includes("default-src 'self'"), "CSP must include default-src 'self'");
  assert.ok(cspContent.includes("object-src 'none'"), "CSP must include object-src 'none'");
  assert.ok(cspContent.includes("base-uri 'self'"), "CSP must include base-uri 'self'");
  assert.ok(cspContent.includes("https://cdn.tailwindcss.com"), "CSP script-src must allow Tailwind CDN");
  assert.ok(cspContent.includes("https://fonts.googleapis.com"), "CSP style-src must allow Google Fonts");
  assert.ok(cspContent.includes("https://fonts.gstatic.com"), "CSP font-src must allow gstatic fonts");

  // Verify that header-only directives are NOT placed in meta tag (they are ignored or invalid in meta)
  assert.ok(!cspContent.includes("frame-ancestors"), "frame-ancestors must NOT be in meta tag (HTTP header only)");
  assert.ok(!cspContent.includes("report-uri"), "report-uri must NOT be in meta tag (HTTP header only)");
});
