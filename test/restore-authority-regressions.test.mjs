import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

function setupMockDom() {
  const nodes = new Map();
  function getNode(id) {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        value: "",
        innerHTML: "",
        textContent: "",
        disabled: false,
        style: {},
        dataset: {},
        classList: {
          s: new Set(),
          add(...xs) { xs.forEach(x => this.s.add(x)); },
          remove(...xs) { xs.forEach(x => this.s.delete(x)); },
          contains(x) { return this.s.has(x); },
          toggle(x, b) {
            if (b === true) this.s.add(x);
            else if (b === false) this.s.delete(x);
            else if (this.s.has(x)) this.s.delete(x);
            else this.s.add(x);
          }
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        focus() {}
      });
    }
    return nodes.get(id);
  }

  const storageMap = new Map();
  globalThis.localStorage = {
    m: storageMap,
    getItem(k) { return this.m.get(k) ?? null; },
    setItem(k, v) { this.m.set(k, String(v)); },
    removeItem(k) { this.m.delete(k); },
    clear() { this.m.clear(); }
  };

  globalThis.window = {
    location: { search: "", hash: "", href: "http://isolated.invalid/" },
    history: { replaceState() {} },
    addEventListener() {},
    localStorage: globalThis.localStorage
  };

  globalThis.document = {
    getElementById(id) { return getNode(id); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    visibilityState: "visible"
  };

  globalThis.fetch = async () => {
    throw new Error("No network allowed in structural proof");
  };
}

setupMockDom();

const root = process.cwd();
const { TeamAppState } = await import(pathToFileURL(root + "/app.js"));
const { api } = await import(pathToFileURL(root + "/src/api/index.js"));

test("RESTORE-01: Coach with persisted team confirms coach role and membership into ContextCoordinator", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "coach");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");
  localStorage.setItem("talde_team_season_id", "TEAM_A");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  const commits = [];
  const original = app.contextCoordinator.applyIdentityTransition.bind(app.contextCoordinator);
  app.contextCoordinator.applyIdentityTransition = (p) => {
    commits.push({ role: p.role, team: p.teamSeasonId, mode: p.appMode });
    return original(p);
  };

  let resolveMembers, started;
  const called = new Promise(r => started = r);
  api.teams.getMyMemberships = () => {
    started();
    return new Promise(r => resolveMembers = r);
  };

  const initPromise = app.init();
  await called;
  resolveMembers({
    items: [{
      role: "COACH",
      status: "ACTIVE",
      team_season_id: "TEAM_A",
      team_id: "TEAM",
      team_name: "Synthetic Club"
    }]
  });

  await initPromise;
  await app.goToScreen(app.currentScreen);
  await new Promise(r => setImmediate(r));

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.currentRole, "coach", "App role must be coach");
  assert.equal(confirmed.currentRole, "coach", "ContextCoordinator confirmed currentRole must be coach (not onboard)");
  assert.equal(confirmed.teamSeasonId, "TEAM_A", "Confirmed teamSeasonId must match persisted TEAM_A");
  assert.equal(confirmed.appMode, "BETA_NORMAL", "Confirmed appMode must be BETA_NORMAL");
  assert.equal(commits.length, 1, "Exactly 1 identity commit should have occurred");
  assert.equal(app.contextGeneration, 1, "contextGeneration must advance to 1");
});

test("RESTORE-02: Control - Coach without persisted team confirms coach role", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "coach");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  const commits = [];
  const original = app.contextCoordinator.applyIdentityTransition.bind(app.contextCoordinator);
  app.contextCoordinator.applyIdentityTransition = (p) => {
    commits.push({ role: p.role, team: p.teamSeasonId, mode: p.appMode });
    return original(p);
  };

  let resolveMembers, started;
  const called = new Promise(r => started = r);
  api.teams.getMyMemberships = () => {
    started();
    return new Promise(r => resolveMembers = r);
  };

  const initPromise = app.init();
  await called;
  resolveMembers({
    items: [{
      role: "COACH",
      status: "ACTIVE",
      team_season_id: "TEAM_A",
      team_id: "TEAM",
      team_name: "Synthetic Club"
    }]
  });

  await initPromise;
  await app.goToScreen(app.currentScreen);
  await new Promise(r => setImmediate(r));

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.currentRole, "coach");
  assert.equal(confirmed.currentRole, "coach");
  assert.equal(confirmed.teamSeasonId, "TEAM_A");
  assert.equal(commits.length, 1);
});

test("RESTORE-03: Control - Parent with child confirms parent role", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "parent");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");
  localStorage.setItem("talde_team_season_id", "TEAM_A");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  const commits = [];
  const original = app.contextCoordinator.applyIdentityTransition.bind(app.contextCoordinator);
  app.contextCoordinator.applyIdentityTransition = (p) => {
    commits.push({ role: p.role, team: p.teamSeasonId, mode: p.appMode });
    return original(p);
  };

  let resolveMembers, started;
  const called = new Promise(r => started = r);
  api.teams.getMyMemberships = () => {
    started();
    return new Promise(r => resolveMembers = r);
  };

  const initPromise = app.init();
  await called;
  resolveMembers({
    items: [{
      role: "GUARDIAN",
      status: "ACTIVE",
      team_season_id: "TEAM_A",
      team_id: "TEAM",
      team_name: "Synthetic Club",
      guardian_players: [{ id: "CHILD_A", first_name: "Synthetic Child" }]
    }]
  });

  await initPromise;
  await app.goToScreen(app.currentScreen);
  await new Promise(r => setImmediate(r));

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.currentRole, "parent");
  assert.equal(confirmed.currentRole, "parent");
  assert.equal(commits.length, 1);
});

test("RESTORE-04: DEMO selected without session confirms DEMO mode on ContextCoordinator", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);

  localStorage.setItem("talde_app_mode", "DEMO");
  localStorage.setItem("talde_active_role", "coach");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  await app.init();
  await app.goToScreen(app.currentScreen);
  await new Promise(r => setImmediate(r));

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.appMode, "DEMO");
  assert.equal(confirmed.appMode, "DEMO", "Confirmed appMode must be DEMO, not null");
  assert.equal(confirmed.currentSessionId, null, "No session token means currentSessionId is null");
});

test("RESTORE-05: BETA selected without session confirms BETA_NORMAL mode on ContextCoordinator", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "onboard");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  await app.init();
  await app.goToScreen(app.currentScreen);
  await new Promise(r => setImmediate(r));

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.appMode, "BETA_NORMAL");
  assert.equal(confirmed.appMode, "BETA_NORMAL", "Confirmed appMode must be BETA_NORMAL, not null");
  assert.equal(confirmed.currentSessionId, null);
});

test("RESTORE-06: Control - Fresh unselected start preserves null appMode", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  await app.init();
  await app.goToScreen(app.currentScreen);
  await new Promise(r => setImmediate(r));

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.appMode, null, "App mode must be null for fresh start");
  assert.equal(confirmed.appMode, null, "Confirmed appMode must remain null for fresh start");
});

test("RESTORE-07: Inactive or absent membership prevents coach role adoption from storage", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "coach");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");
  localStorage.setItem("talde_team_season_id", "TEAM_A");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  let resolveMembers, started;
  const called = new Promise(r => started = r);
  api.teams.getMyMemberships = () => {
    started();
    return new Promise(r => resolveMembers = r);
  };

  const initPromise = app.init();
  await called;
  resolveMembers({ items: [] });

  await initPromise;
  await app.goToScreen(app.currentScreen);
  await new Promise(r => setImmediate(r));

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.currentRole, "onboard", "Storage coach must drop to onboard when backend has no active membership");
  assert.equal(confirmed.currentRole, "onboard", "Confirmed role must stay onboard");
  assert.equal(app.currentScreen, "beta_entry_screen", "Screen must be beta_entry_screen");
  assert.equal(confirmed.teamSeasonId, null, "Confirmed teamSeasonId must be null");
});

test("RESTORE-08: Scope invalidation during loadUserContext aborts stale init navigation", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "coach");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  let resolveMembers, started;
  const called = new Promise(r => started = r);
  api.teams.getMyMemberships = () => {
    started();
    return new Promise(r => resolveMembers = r);
  };

  const initPromise = app.init();
  await called;

  app.setAppMode("DEMO");
  assert.equal(app.appMode, "DEMO");

  resolveMembers({
    items: [{
      role: "COACH",
      status: "ACTIVE",
      team_season_id: "TEAM_A",
      team_id: "TEAM",
      team_name: "Synthetic Club"
    }]
  });

  await initPromise;
  await new Promise(r => setImmediate(r));

  assert.equal(app.appMode, "DEMO", "Stale init completion must not overwrite interleaved mode change");
});

test("RESTORE-09: Idempotent restore without changes does NOT emit redundant commits or advance generation", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "coach");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");
  localStorage.setItem("talde_team_season_id", "TEAM_A");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  const commits = [];
  const original = app.contextCoordinator.applyIdentityTransition.bind(app.contextCoordinator);
  app.contextCoordinator.applyIdentityTransition = (p) => {
    commits.push({ role: p.role, team: p.teamSeasonId, mode: p.appMode });
    return original(p);
  };

  const memberships = {
    items: [{
      role: "COACH",
      status: "ACTIVE",
      team_season_id: "TEAM_A",
      team_id: "TEAM",
      team_name: "Synthetic Club"
    }]
  };
  api.teams.getMyMemberships = async () => memberships;

  await app.init();
  await app.goToScreen(app.currentScreen);
  await new Promise(r => setImmediate(r));

  assert.equal(commits.length, 1, "First restore produces exactly 1 commit");
  assert.equal(app.contextGeneration, 1, "First restore generation is 1");

  const ok = await app.loadUserContext();
  assert.equal(ok, true);

  assert.equal(commits.length, 1, "Second pass must NOT emit additional commits");
  assert.equal(app.contextGeneration, 1, "Second pass must NOT bump contextGeneration");
});
