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

test("RESTORE-01: Coach with persisted team confirms coach role and membership into ContextCoordinator natively during init", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "coach");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");
  localStorage.setItem("talde_team_season_id", "TEAM_A");

  const app = new TeamAppState();
  const trace = [];
  app.syncCoachHome = async () => {
    trace.push({ kind: "syncCoachHome", role: app.currentRole, team: app.beta.teamSeasonId });
  };
  app.syncParentHome = async () => {};

  const origGoTo = app.goToScreen.bind(app);
  app.goToScreen = async (...args) => {
    trace.push({ kind: "goToScreen", target: args[0] });
    return origGoTo(...args);
  };

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
  await new Promise(r => setImmediate(r));

  // Must have completed navigation and sync WITHOUT any external goToScreen call from the test
  const navCalls = trace.filter(x => x.kind === "goToScreen");
  const syncCalls = trace.filter(x => x.kind === "syncCoachHome");
  assert.equal(navCalls.length, 1, "init() must complete navigation natively");
  assert.equal(navCalls[0].target, "v2_01_coach_home", "Must navigate to v2_01_coach_home");
  assert.equal(syncCalls.length, 1, "init() must invoke syncCoachHome natively");
  assert.equal(syncCalls[0].role, "coach");
  assert.equal(syncCalls[0].team, "TEAM_A");

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.currentRole, "coach", "App role must be coach");
  assert.equal(confirmed.currentRole, "coach", "ContextCoordinator confirmed currentRole must be coach (not onboard)");
  assert.equal(confirmed.teamSeasonId, "TEAM_A", "Confirmed teamSeasonId must match persisted TEAM_A");
  assert.equal(confirmed.appMode, "BETA_NORMAL", "Confirmed appMode must be BETA_NORMAL");
  assert.equal(commits.length, 1, "Exactly 1 identity commit should have occurred");
  assert.equal(app.contextGeneration, 1, "contextGeneration must advance to 1");
});

test("RESTORE-02: Control - Coach without persisted team confirms coach role natively", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "coach");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");

  const app = new TeamAppState();
  const trace = [];
  app.syncCoachHome = async () => {
    trace.push({ kind: "syncCoachHome", role: app.currentRole });
  };
  app.syncParentHome = async () => {};

  const origGoTo = app.goToScreen.bind(app);
  app.goToScreen = async (...args) => {
    trace.push({ kind: "goToScreen", target: args[0] });
    return origGoTo(...args);
  };

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
  await new Promise(r => setImmediate(r));

  assert.equal(trace.filter(x => x.kind === "goToScreen").length, 1, "Must navigate natively");
  assert.equal(trace.filter(x => x.kind === "syncCoachHome").length, 1, "Must sync natively");

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.currentRole, "coach");
  assert.equal(confirmed.currentRole, "coach");
  assert.equal(confirmed.teamSeasonId, "TEAM_A");
  assert.equal(commits.length, 1);
});

test("RESTORE-03: Control - Parent with child confirms parent role natively", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "parent");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");
  localStorage.setItem("talde_team_season_id", "TEAM_A");

  const app = new TeamAppState();
  const trace = [];
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {
    trace.push({ kind: "syncParentHome", role: app.currentRole, team: app.beta.teamSeasonId });
  };

  const origGoTo = app.goToScreen.bind(app);
  app.goToScreen = async (...args) => {
    trace.push({ kind: "goToScreen", target: args[0] });
    return origGoTo(...args);
  };

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
  await new Promise(r => setImmediate(r));

  assert.equal(trace.filter(x => x.kind === "goToScreen").length, 1, "Must navigate natively to parent home");
  assert.equal(trace.filter(x => x.kind === "goToScreen")[0].target, "v2_07_parent_home");
  assert.equal(trace.filter(x => x.kind === "syncParentHome").length, 1, "Must sync parent home natively");

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.currentRole, "parent");
  assert.equal(confirmed.currentRole, "parent");
  assert.equal(commits.length, 1);
});

test("RESTORE-04: DEMO selected without session confirms DEMO mode on ContextCoordinator", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

  localStorage.setItem("talde_app_mode", "DEMO");
  localStorage.setItem("talde_active_role", "coach");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  await app.init();
  await new Promise(r => setImmediate(r));

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.appMode, "DEMO");
  assert.equal(confirmed.appMode, "DEMO", "Confirmed appMode must be DEMO, not null");
  assert.equal(confirmed.currentSessionId, null, "No session token means currentSessionId is null");
  assert.equal(app.contextGeneration, 0, "No session must preserve generation 0");
});

test("RESTORE-05: BETA selected without session confirms BETA_NORMAL mode on ContextCoordinator", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "onboard");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  await app.init();
  await new Promise(r => setImmediate(r));

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.appMode, "BETA_NORMAL");
  assert.equal(confirmed.appMode, "BETA_NORMAL", "Confirmed appMode must be BETA_NORMAL, not null");
  assert.equal(confirmed.currentSessionId, null);
  assert.equal(app.contextGeneration, 0, "No session must preserve generation 0");
});

test("RESTORE-06: Control - Fresh unselected start preserves null appMode", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  await app.init();
  await new Promise(r => setImmediate(r));

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.appMode, null, "App mode must be null for fresh start");
  assert.equal(confirmed.appMode, null, "Confirmed appMode must remain null for fresh start");
  assert.equal(app.contextGeneration, 0);
});

test("RESTORE-07: Inactive or absent membership prevents coach role adoption, neutralizes authoritatively before sync", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "?screen=v2_01_coach_home";

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "coach");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");
  localStorage.setItem("talde_team_season_id", "TEAM_A");

  const app = new TeamAppState();
  const trace = [];
  app.syncCoachHome = async () => {
    trace.push({ kind: "coach-screen-leaf-invoked", role: app.currentRole, team: app.beta.teamSeasonId });
  };
  app.syncParentHome = async () => {};

  const sync = app.syncCurrentScreen.bind(app);
  app.syncCurrentScreen = async () => {
    trace.push({ kind: "sync", role: app.currentRole, team: app.beta.teamSeasonId, screen: app.currentScreen });
    return sync();
  };

  const nav = app.goToScreen.bind(app);
  app.goToScreen = async (...args) => {
    trace.push({ kind: "nav", target: args[0] });
    return nav(...args);
  };

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
  await new Promise(r => setImmediate(r));

  // 318-NQ-02: Zero protected coach leaf invocations
  const coachLeafCalls = trace.filter(x => x.kind === "coach-screen-leaf-invoked");
  assert.equal(coachLeafCalls.length, 0, "Protected coach leaf must NEVER be called on absent membership");

  // 318-NQ-02: Zero unauthorized coach sync projections
  const unauthorizedProjections = trace.filter(x => x.kind === "sync" && x.role === "coach");
  assert.equal(unauthorizedProjections.length, 0, "No unauthorized coach sync projection");

  const confirmed = app.contextCoordinator.getConfirmedContext();
  assert.equal(app.currentRole, "onboard", "Storage coach must drop to onboard when backend has no active membership");
  assert.equal(confirmed.currentRole, "onboard", "Confirmed role must be onboard via coordinator transition");
  assert.equal(app.currentScreen, "beta_entry_screen", "Screen must be beta_entry_screen");
  assert.equal(confirmed.teamSeasonId, null, "Confirmed teamSeasonId must be null");
  assert.equal(app.contextGeneration, 1, "Neutralization must advance generation via coordinator authority");
  assert.equal(localStorage.getItem("talde_active_role"), "onboard", "Storage must reflect onboard role");
  assert.equal(localStorage.getItem("talde_team_season_id"), null, "Storage team must be removed");
});

test("RESTORE-08: Scope invalidation during loadUserContext aborts stale init navigation", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

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
  assert.equal(app.contextCoordinator.getConfirmedContext().currentRole, "onboard", "Stale coach must not be confirmed");
});

test("RESTORE-09: Idempotent restore without changes does NOT emit redundant commits or advance generation", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

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
  await new Promise(r => setImmediate(r));

  assert.equal(commits.length, 1, "First restore produces exactly 1 commit");
  assert.equal(app.contextGeneration, 1, "First restore generation is 1");

  const ok = await app.loadUserContext();
  assert.equal(ok, true);

  assert.equal(commits.length, 1, "Second pass must NOT emit additional commits");
  assert.equal(app.contextGeneration, 1, "Second pass must NOT bump contextGeneration");
});

test("RESTORE-10: Inactive COACH membership with explicit deeplink neutralizes and avoids leaf sync", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "?screen=v2_01_coach_home";

  localStorage.setItem("talde_app_mode", "BETA_NORMAL");
  localStorage.setItem("talde_active_role", "coach");
  localStorage.setItem("talde_session_token", "SYNTHETIC_TOKEN");
  localStorage.setItem("talde_team_season_id", "TEAM_A");

  const app = new TeamAppState();
  const trace = [];
  app.syncCoachHome = async () => {
    trace.push({ kind: "coach-screen-leaf-invoked", role: app.currentRole, team: app.beta.teamSeasonId });
  };
  app.syncParentHome = async () => {};

  const sync = app.syncCurrentScreen.bind(app);
  app.syncCurrentScreen = async () => {
    trace.push({ kind: "sync", role: app.currentRole, team: app.beta.teamSeasonId, screen: app.currentScreen });
    return sync();
  };

  api.teams.getMyMemberships = async () => ({
    items: [{
      role: "COACH",
      status: "INACTIVE",
      team_season_id: "TEAM_A",
      team_id: "TEAM",
      team_name: "Synthetic Club"
    }]
  });

  await app.init();
  await new Promise(r => setImmediate(r));

  assert.equal(trace.some(x => x.kind === "coach-screen-leaf-invoked"), false);
  assert.equal(trace.some(x => x.kind === "sync" && x.role === "coach"), false);
  assert.equal(app.currentRole, "onboard");
  assert.equal(app.currentScreen, "beta_entry_screen");
  assert.equal(app.contextCoordinator.getConfirmedContext().currentRole, "onboard");
  assert.equal(app.contextCoordinator.getConfirmedContext().teamSeasonId, null);
});

test("RESTORE-11: Mode divergence without identity change does not bump generation or abort in-flight", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

  const app = new TeamAppState();
  app.appMode = "BETA_NORMAL";
  let aborted = 0;
  app.inFlightControllers.add({ abort() { aborted++; } });

  const beforeGen = app.contextGeneration;
  const beforeEpoch = app.sessionManager.getCredentialEpoch();

  app.applyContextTransition({ appMode: "BETA_NORMAL" });

  assert.equal(app.contextGeneration, beforeGen, "Same-mode applyContextTransition must NOT bump generation");
  assert.equal(app.sessionManager.getCredentialEpoch(), beforeEpoch, "Epoch must be unchanged");
  assert.equal(aborted, 0, "No in-flight controllers must be aborted");
});

test("RESTORE-12: Stale init re-entry on accepted context discards continuation when foreign transition bumps generation (+1)", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

  for (const [k, v] of Object.entries({
    talde_app_mode: "BETA_NORMAL",
    talde_active_role: "coach",
    talde_session_token: "SYNTHETIC_TOKEN",
    talde_team_season_id: "TEAM_A"
  })) {
    localStorage.setItem(k, v);
  }

  const app = new TeamAppState();
  const trace = [];
  app.syncCoachHome = async () => {
    trace.push({
      kind: "coach-sync",
      team: app.beta.teamSeasonId,
      role: app.currentRole,
      generation: app.contextGeneration,
      session: app.currentSessionId,
      mode: app.appMode
    });
  };
  app.syncParentHome = async () => {};

  const originalGoToScreen = app.goToScreen.bind(app);
  app.goToScreen = async (...args) => {
    trace.push({ kind: "navigation", target: args[0], role: app.currentRole, team: app.beta.teamSeasonId });
    return originalGoToScreen(...args);
  };
  app.contextCoordinator.subscribe((ctx, keys) => trace.push({ kind: "notify", keys, ctx }));

  api.teams.getMyMemberships = async () => ({
    items: [
      { role: "COACH", status: "ACTIVE", team_season_id: "TEAM_A", team_id: "TEAM", team_name: "Synthetic Club" },
      { role: "COACH", status: "ACTIVE", team_season_id: "TEAM_B", team_id: "TEAM", team_name: "Synthetic Club" }
    ]
  });

  // 1. Initial valid init establishes accepted context on TEAM_A (generation 1)
  await app.init();
  await new Promise(r => setImmediate(r));

  assert.equal(app.contextGeneration, 1, "Baseline generation is 1");
  assert.equal(app.beta.teamSeasonId, "TEAM_A", "Baseline team is TEAM_A");
  assert.equal(trace.filter(x => x.kind === "navigation").length, 1, "Baseline navigation occurred");
  trace.length = 0;

  // 2. Re-entry on already accepted context. Real loader returns true without own commit.
  // Interleave foreign transition A->B before init resumes.
  const realLoad = app.loadUserContext.bind(app);
  let originScope;
  let foreignTransition;

  app.loadUserContext = function() {
    originScope = this.createScope();
    return realLoad().then((ok) => {
      assert.equal(ok, true, "Real loader returns true");
      assert.equal(this.contextGeneration, originScope.generation, "Loader did NOT commit own transition");

      this.applyContextTransition({
        role: "coach",
        teamSeasonId: "TEAM_B",
        team: { id: "TEAM", name: "Synthetic Club" },
        teamSeason: { id: "TEAM_B" }
      });

      foreignTransition = {
        generation: this.contextGeneration,
        session: this.currentSessionId,
        mode: this.appMode,
        team: this.beta.teamSeasonId
      };
      assert.equal(this.isScopeActive(originScope), false, "Origin scope is now invalidated by foreign transition");
      trace.push({ kind: "foreign-team-commit-completed", ...foreignTransition });
      return ok;
    });
  };

  await app.init();
  await new Promise(r => setImmediate(r));

  assert.equal(foreignTransition.generation, originScope.generation + 1, "Foreign transition bumped exactly +1");
  assert.equal(foreignTransition.session, originScope.sessionId, "Session remained identical");
  assert.equal(foreignTransition.mode, originScope.mode, "Mode remained identical");

  const staleNavigations = trace.filter(x => x.kind === "navigation");
  const staleCoachSyncs = trace.filter(x => x.kind === "coach-sync");

  assert.equal(staleNavigations.length, 0, "Stale init MUST produce 0 navigation calls");
  assert.equal(staleCoachSyncs.length, 0, "Stale init MUST produce 0 coach-sync calls");

  // Legitimate foreign selection B remains authoritative and intact
  assert.equal(app.beta.teamSeasonId, "TEAM_B", "TEAM_B must remain active in app.beta");
  assert.equal(app.contextCoordinator.getConfirmedContext().teamSeasonId, "TEAM_B", "TEAM_B must remain confirmed in coordinator");
  assert.equal(app.contextGeneration, 2, "Generation 2 must remain authoritative");
});

test("RESTORE-13: Concurrent real loader confirms foreign team; stale init does not adopt foreign receipt and produces 0 effects", async () => {
  localStorage.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);
  window.location.search = "";

  for (const [k, v] of Object.entries({
    talde_app_mode: "BETA_NORMAL",
    talde_active_role: "coach",
    talde_session_token: "SYNTHETIC_TOKEN",
    talde_team_season_id: "TEAM_A"
  })) {
    localStorage.setItem(k, v);
  }

  const app = new TeamAppState();
  const trace = [];
  app.syncCoachHome = async () => {
    trace.push({
      kind: "coach-sync",
      team: app.beta.teamSeasonId,
      role: app.currentRole,
      generation: app.contextGeneration,
      session: app.currentSessionId,
      mode: app.appMode
    });
  };
  app.syncParentHome = async () => {};

  const originalGoToScreen = app.goToScreen.bind(app);
  app.goToScreen = async (...args) => {
    trace.push({ kind: "navigation", target: args[0], role: app.currentRole, team: app.beta.teamSeasonId });
    return originalGoToScreen(...args);
  };
  app.contextCoordinator.subscribe((ctx, keys) => trace.push({ kind: "notify", keys, ctx }));

  let phase = "baseline";
  api.teams.getMyMemberships = async () => ({
    items: phase === "foreign"
      ? [{ role: "COACH", status: "ACTIVE", team_season_id: "TEAM_B", team_id: "TEAM", team_name: "Synthetic Club" }]
      : [
          { role: "COACH", status: "ACTIVE", team_season_id: "TEAM_A", team_id: "TEAM", team_name: "Synthetic Club" },
          { role: "COACH", status: "ACTIVE", team_season_id: "TEAM_B", team_id: "TEAM", team_name: "Synthetic Club" }
        ]
  });

  // 1. Initial valid init establishes accepted context on TEAM_A (generation 1)
  await app.init();
  await new Promise(r => setImmediate(r));

  assert.equal(app.contextGeneration, 1, "Baseline generation is 1");
  assert.equal(app.beta.teamSeasonId, "TEAM_A", "Baseline team is TEAM_A");
  assert.equal(trace.filter(x => x.kind === "navigation").length, 1, "Baseline navigation occurred");
  trace.length = 0;

  // 2. Re-entry on already accepted context. Call 1 of real loader returns true without own commit.
  // Interleave Call 2 of real loader which confirms TEAM_B before Call 1's init resumes.
  const realLoad = app.loadUserContext.bind(app);
  let originScope;
  let foreignTransition;

  app.loadUserContext = function() {
    originScope = this.createScope();
    return realLoad().then(async (ok) => {
      assert.equal(ok, true, "First loader returns true");
      assert.equal(this.contextGeneration, originScope.generation, "First loader did not commit own transition");
      assert.equal(this._lastRestoreCommit, null, "First loader produced null restore commit");

      phase = "foreign";
      // Second REAL invocation of loadUserContext
      const foreignOk = await realLoad();
      assert.equal(foreignOk, true, "Foreign loader returns true");

      foreignTransition = {
        generation: this.contextGeneration,
        session: this.currentSessionId,
        mode: this.appMode,
        team: this.beta.teamSeasonId,
        restoreReceipt: this._lastRestoreCommit
      };
      assert.equal(this.isScopeActive(originScope), false, "Origin scope is invalidated by foreign loader");
      trace.push({ kind: "foreign-loader-commit-completed", ...foreignTransition });
      return ok;
    });
  };

  await app.init();
  await new Promise(r => setImmediate(r));

  assert.equal(foreignTransition.generation, originScope.generation + 1, "Foreign loader bumped generation +1");
  assert.equal(foreignTransition.session, originScope.sessionId, "Session remained identical");
  assert.equal(foreignTransition.mode, originScope.mode, "Mode remained identical");

  const staleNavigations = trace.filter(x => x.kind === "navigation");
  const staleCoachSyncs = trace.filter(x => x.kind === "coach-sync");

  assert.equal(staleNavigations.length, 0, "Stale init MUST produce 0 navigation calls");
  assert.equal(staleCoachSyncs.length, 0, "Stale init MUST produce 0 coach-sync calls");

  // Legitimate foreign selection B remains authoritative and confirmed
  assert.equal(app.beta.teamSeasonId, "TEAM_B", "TEAM_B must remain active in app.beta");
  assert.equal(app.contextCoordinator.getConfirmedContext().teamSeasonId, "TEAM_B", "TEAM_B must remain confirmed in coordinator");
  assert.equal(app.contextGeneration, 2, "Generation 2 must remain authoritative");
});

