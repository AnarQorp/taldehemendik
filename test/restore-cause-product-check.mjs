import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.argv[2] || process.cwd();
const sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.ok(typeof sha === "string" && sha.length === 40, "Valid git commit SHA required");
execFileSync("git", ["-C", root, "diff", "--quiet", "HEAD", "--"]);

globalThis.localStorage = {
  m: new Map(),
  getItem(k) { return this.m.get(k) ?? null; },
  setItem(k, v) { this.m.set(k, String(v)); },
  removeItem(k) { this.m.delete(k); },
  clear() { this.m.clear(); }
};
globalThis.window = {
  location: { search: "", hash: "", href: "http://isolated.invalid/" },
  history: { replaceState() {} },
  addEventListener() {},
  localStorage
};
globalThis.document = {
  getElementById() { return null; },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  addEventListener() {},
  visibilityState: "visible"
};
globalThis.fetch = async () => {
  throw new Error("No network allowed in structural proof");
};

const { TeamAppState } = await import(pathToFileURL(root + "/app.js"));
const { api } = await import(pathToFileURL(root + "/src/api/index.js"));

const results = [];
for (const spec of [
  { name: "coach-persisted-team", mode: "BETA_NORMAL", role: "coach", token: true, persistTeam: true, memberRole: "COACH" },
  { name: "coach-no-persisted-team-control", mode: "BETA_NORMAL", role: "coach", token: true, persistTeam: false, memberRole: "COACH" },
  { name: "parent-with-child-control", mode: "BETA_NORMAL", role: "parent", token: true, persistTeam: true, memberRole: "GUARDIAN" },
  { name: "demo-selected-no-session", mode: "DEMO", role: "coach", token: false, persistTeam: false },
  { name: "beta-selected-no-session", mode: "BETA_NORMAL", role: "onboard", token: false, persistTeam: false },
  { name: "fresh-unselected-control", mode: null, role: "onboard", token: false, persistTeam: false }
]) {
  localStorage.m.clear();
  api.client.setToken(null);
  api.client.setSessionContext(null);

  if (spec.mode) localStorage.setItem("talde_app_mode", spec.mode);
  localStorage.setItem("talde_active_role", spec.role);
  if (spec.token) localStorage.setItem("talde_session_token", "SYNTHETIC_NO_REAL_CREDENTIAL");
  if (spec.persistTeam) localStorage.setItem("talde_team_season_id", "TEAM_A");

  const app = new TeamAppState();
  app.syncCoachHome = async () => {};
  app.syncParentHome = async () => {};

  const phases = [], commits = [];
  const snap = (phase) => phases.push({
    phase,
    appRole: app.currentRole,
    appMode: app.appMode,
    screen: app.currentScreen,
    confirmed: app.contextCoordinator.getConfirmedContext(),
    generation: app.contextGeneration,
    epoch: app.sessionManager.getCredentialEpoch()
  });

  const original = app.contextCoordinator.applyIdentityTransition.bind(app.contextCoordinator);
  app.contextCoordinator.applyIdentityTransition = (p) => {
    commits.push({ role: p.role, team: p.teamSeasonId, mode: p.appMode });
    return original(p);
  };

  let resolveMembers, started;
  const called = new Promise(r => started = r);
  api.teams.getMyMemberships = () => {
    snap("membership-await-entered");
    started();
    return new Promise(r => resolveMembers = r);
  };

  snap("constructor");
  const init = app.init();
  if (spec.token) {
    await called;
    resolveMembers({
      items: [{
        role: spec.memberRole,
        status: "ACTIVE",
        team_season_id: "TEAM_A",
        team_id: "TEAM",
        team_name: "Synthetic",
        guardian_players: spec.memberRole === "GUARDIAN" ? [{ id: "CHILD_A", first_name: "Synthetic" }] : []
      }]
    });
  }

  await init;
  snap("init-promise-resolved");
  await app.goToScreen(app.currentScreen);
  await new Promise(r => setImmediate(r));
  snap("navigation-and-event-loop-settled");

  const final = phases.at(-1);

  if (spec.name === "coach-persisted-team") {
    assert.equal(final.appRole, "coach");
    assert.equal(final.confirmed.currentRole, "coach", "Coach role must be confirmed");
    assert.equal(final.confirmed.teamSeasonId, "TEAM_A", "TeamSeasonId must be confirmed");
    assert.equal(commits.length, 1, "Exactly 1 identity commit expected");
    assert.equal(final.generation, 1, "Generation must advance to 1");
  }
  if (spec.name === "coach-no-persisted-team-control" || spec.name === "parent-with-child-control") {
    assert.equal(final.confirmed.currentRole, spec.role);
    assert.equal(final.confirmed.teamSeasonId, "TEAM_A");
    assert.equal(commits.length, 1);
  }
  if (spec.name.endsWith("selected-no-session")) {
    assert.equal(final.appMode, spec.mode);
    assert.equal(final.confirmed.appMode, spec.mode, "Confirmed mode must match selected mode");
  }
  if (spec.name === "fresh-unselected-control") {
    assert.equal(final.appMode, null);
    assert.equal(final.confirmed.appMode, null);
  }

  results.push({
    name: spec.name,
    phases,
    identityCommits: commits,
    characterization: "VERIFIED_PRODUCT_PASS_RESTORE_AUTHORITY_CONFIRMED"
  });
}

execFileSync("git", ["-C", root, "diff", "--quiet", "HEAD", "--"]);
console.log(JSON.stringify({
  commit_sha: sha,
  kind: "controlled-structural-proof-verified-pass",
  network: "disabled",
  results
}, null, 2));
