import test from "node:test";
import assert from "node:assert/strict";

import {
  AuthDomainController,
  TeamsDomainController,
  FamiliesDomainController,
  EventsDomainController
} from "../src/domains/index.js";
import {
  ConcurrencyTracker,
  SessionManager,
  ResourceStore,
  ContextCoordinator
} from "../src/core/index.js";

function createMockApp() {
  const tracker = new ConcurrencyTracker();
  const sessionManager = new SessionManager({ currentSessionId: "mock-sess-1", credentialEpoch: 1, accessToken: "token-1" });
  const store = new ResourceStore();
  const app = {
    appMode: "BETA_NORMAL",
    currentRole: "coach",
    currentSessionId: "mock-sess-1",
    contextGeneration: 1,
    tokens: { coach: "token-1", parent: null },
    beta: { teamSeasonId: "team-1", activeEventId: "event-1", players: [] },
    live: { callup: null },
    concurrencyTracker: tracker,
    sessionManager,
    resourceStore: store,
    contextCoordinator: null,
    showToast: () => {},
    goToScreen: async () => {},
    syncCurrentScreen: async () => {},
    ensureAuth: async () => {},
    createScope(extra = {}) {
      return {
        generation: this.contextGeneration,
        sessionId: this.currentSessionId,
        ...extra
      };
    },
    isScopeActive(scope) {
      return scope.generation === this.contextGeneration && scope.sessionId === this.currentSessionId;
    },
    applyContextTransition(t) {
      if (t.role) this.currentRole = t.role;
      if (t.teamSeasonId) this.beta.teamSeasonId = t.teamSeasonId;
      return true;
    }
  };
  app.contextCoordinator = new ContextCoordinator({
    sessionManager,
    concurrencyTracker: tracker,
    stateRef: app,
    initial: { teamSeasonId: "team-1", activeEventId: "event-1", contextGeneration: 1 }
  });
  return app;
}

test("Domain Controllers: Instantiation and delegation", () => {
  const app = createMockApp();
  const auth = new AuthDomainController(app);
  const teams = new TeamsDomainController(app);
  const families = new FamiliesDomainController(app);
  const events = new EventsDomainController(app);

  assert.ok(auth);
  assert.ok(teams);
  assert.ok(families);
  assert.ok(events);
  assert.equal(events.coordinator, app.contextCoordinator);
  assert.equal(events.tracker, app.concurrencyTracker);
  assert.equal(events.store, app.resourceStore);
});
