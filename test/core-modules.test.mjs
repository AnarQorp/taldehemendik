import test from "node:test";
import assert from "node:assert/strict";

import {
  ConcurrencyTracker,
  SessionManager,
  ResourceStore,
  ContextCoordinator
} from "../src/core/index.js";

// ============================================================================
// 1. ConcurrencyTracker Tests
// ============================================================================
test("ConcurrencyTracker: Monotonic sequencing and intent invalidation", () => {
  const tracker = new ConcurrencyTracker();

  assert.equal(tracker.hasPendingIntent("event"), false);
  const t1 = tracker.startIntent("event", "event-1");
  assert.equal(t1.seq, 1);
  assert.equal(tracker.hasPendingIntent("event"), true);
  assert.equal(tracker.isCurrent(t1), true);

  // New intent invalidates t1
  const t2 = tracker.startIntent("event", "event-2");
  assert.equal(t2.seq, 2);
  assert.equal(tracker.isCurrent(t1), false);
  assert.equal(tracker.isCurrent(t2), true);

  // Completing t1 fails because t2 is current
  assert.equal(tracker.completeIntent(t1), false);
  assert.equal(tracker.hasPendingIntent("event"), true);

  // Completing t2 succeeds
  assert.equal(tracker.completeIntent(t2), true);
  assert.equal(tracker.hasPendingIntent("event"), false);
});

test("ConcurrencyTracker: Discarding intent clears pending without affecting completed", () => {
  const tracker = new ConcurrencyTracker();
  const t1 = tracker.startIntent("otp", "challenge-1");
  assert.equal(tracker.hasPendingIntent("otp"), true);

  tracker.discardIntent(t1);
  assert.equal(tracker.hasPendingIntent("otp"), false);
});

// ============================================================================
// 2. SessionManager Tests (M01 401 Classification)
// ============================================================================
test("SessionManager: 401 on active credential expires session", () => {
  const sm = new SessionManager();
  sm.setSession("sess-1", "jwt-token-1", "BETA_NORMAL");

  const activeScope = {
    sessionId: "sess-1",
    credentialEpoch: sm.getCredentialEpoch(),
    bearerToken: "jwt-token-1"
  };

  // 401 on active session/epoch expires
  const expired = sm.handleUnauthorized(activeScope, true);
  assert.equal(expired, true);
  assert.equal(sm.getCurrentSessionId(), null);
  assert.equal(sm.getToken(), null);
});

test("SessionManager: 401 from superseded session does NOT expire active session", () => {
  const sm = new SessionManager();
  sm.setSession("sess-1", "jwt-token-1", "BETA_NORMAL");
  const oldScope = {
    sessionId: "sess-1",
    credentialEpoch: sm.getCredentialEpoch(),
    bearerToken: "jwt-token-1"
  };

  // User re-authenticates to sess-2
  sm.setSession("sess-2", "jwt-token-2", "BETA_NORMAL");

  // Late 401 from oldScope arrives
  const expired = sm.handleUnauthorized(oldScope, true);
  assert.equal(expired, false);
  assert.equal(sm.getCurrentSessionId(), "sess-2");
  assert.equal(sm.getToken(), "jwt-token-2");
});

test("SessionManager: 401 from unauthenticated OTP failure does NOT expire active session", () => {
  const sm = new SessionManager();
  sm.setSession("sess-1", "jwt-token-1", "BETA_NORMAL");

  const expired = sm.handleUnauthorized(null, false);
  assert.equal(expired, false);
  assert.equal(sm.getCurrentSessionId(), "sess-1");
});

// ============================================================================
// 3. ResourceStore Tests (M06 Version Ordering and Downgrade Prevention)
// ============================================================================
test("ResourceStore: Strict version ordering and downgrade prohibition", () => {
  const store = new ResourceStore();
  const key = {
    teamSeasonId: "team-1",
    eventId: "event-1",
    callupId: "callup-1",
    namespace: "live"
  };

  // Initial insert: DRAFT v1
  const r1 = store.reconcileCallup(key, {
    id: "callup-1",
    event_id: "event-1",
    team_season_id: "team-1",
    status: "DRAFT",
    version: 1
  });
  assert.equal(r1.applied, true);
  assert.equal(store.getCallup(key).status, "DRAFT");
  assert.equal(store.getCallup(key).version, 1);

  // Update: PUBLISHED v2
  const r2 = store.reconcileCallup(key, {
    id: "callup-1",
    event_id: "event-1",
    team_season_id: "team-1",
    status: "PUBLISHED",
    version: 2
  });
  assert.equal(r2.applied, true);
  assert.equal(store.getCallup(key).status, "PUBLISHED");
  assert.equal(store.getCallup(key).version, 2);

  // Stale DRAFT v1 arrives later -> MUST NOT downgrade
  const r3 = store.reconcileCallup(key, {
    id: "callup-1",
    event_id: "event-1",
    team_season_id: "team-1",
    status: "DRAFT",
    version: 1
  });
  assert.equal(r3.applied, false);
  assert.equal(r3.reason, "downgrade_prohibited");
  assert.equal(store.getCallup(key).status, "PUBLISHED");

  // Out of order lower version v1 arrives with non-draft status -> stale_version
  const r4 = store.reconcileCallup(key, {
    id: "callup-1",
    event_id: "event-1",
    team_season_id: "team-1",
    status: "PUBLISHED",
    version: 1
  });
  assert.equal(r4.applied, false);
  assert.equal(r4.reason, "stale_version");
  assert.equal(store.getCallup(key).version, 2);

  // Equal version identical -> idempotent
  const r5 = store.reconcileCallup(key, {
    id: "callup-1",
    event_id: "event-1",
    team_season_id: "team-1",
    status: "PUBLISHED",
    version: 2
  });
  assert.equal(r5.applied, false);
  assert.equal(r5.reason, "idempotent");
});

test("ResourceStore: Purging namespace and team", () => {
  const store = new ResourceStore();
  store.reconcileCallup({ teamSeasonId: "t1", eventId: "e1" }, { id: "c1", version: 1, status: "DRAFT" });
  store.reconcileCallup({ teamSeasonId: "t2", eventId: "e2" }, { id: "c2", version: 1, status: "DRAFT" });

  assert.ok(store.getCallup({ teamSeasonId: "t1", eventId: "e1" }));
  store.clearTeamSeason("t1");
  assert.equal(store.getCallup({ teamSeasonId: "t1", eventId: "e1" }), null);
  assert.ok(store.getCallup({ teamSeasonId: "t2", eventId: "e2" }));
});

// ============================================================================
// 4. ContextCoordinator Tests (M02, M03, M05, M07)
// ============================================================================
test("ContextCoordinator: TargetScope commit validates intent and generation", () => {
  const sm = new SessionManager();
  sm.setSession("sess-1", "token-1");
  const tracker = new ConcurrencyTracker();
  const coord = new ContextCoordinator({ sessionManager: sm, concurrencyTracker: tracker });

  const tokenB = tracker.startIntent("event", "event-B");
  const targetScopeB = coord.createTargetScope("event-B", tokenB);

  // User starts intent C before B resolves
  const tokenC = tracker.startIntent("event", "event-C");
  const targetScopeC = coord.createTargetScope("event-C", tokenC);

  // C commits first
  const cCommitted = coord.commitSelection(targetScopeC);
  assert.equal(cCommitted, true);
  assert.equal(coord.getConfirmedContext().activeEventId, "event-C");
  assert.equal(coord.getConfirmedContext().eventEpoch, 1);

  // Late B attempts commit -> MUST FAIL (tokenB no longer current)
  const bCommitted = coord.commitSelection(targetScopeB);
  assert.equal(bCommitted, false);
  assert.equal(coord.getConfirmedContext().activeEventId, "event-C");
  assert.equal(coord.getConfirmedContext().eventEpoch, 1);
});

test("ContextCoordinator: Identity transition bumps generation and resets event context", () => {
  const sm = new SessionManager();
  const tracker = new ConcurrencyTracker();
  const coord = new ContextCoordinator({
    sessionManager: sm,
    concurrencyTracker: tracker,
    initial: { teamSeasonId: "team-A", activeEventId: "event-A", eventEpoch: 2 }
  });

  const prevGen = coord.getConfirmedContext().contextGeneration;

  // Switching team resets event context and bumps generation
  coord.applyIdentityTransition({ teamSeasonId: "team-B" });

  const ctx = coord.getConfirmedContext();
  assert.equal(ctx.contextGeneration, prevGen + 1);
  assert.equal(ctx.teamSeasonId, "team-B");
  assert.equal(ctx.activeEventId, null);
  assert.equal(ctx.eventEpoch, 0);
});

test("ContextCoordinator: ViewScope validation rejects mismatched event or epoch", () => {
  const sm = new SessionManager();
  const tracker = new ConcurrencyTracker();
  const coord = new ContextCoordinator({
    sessionManager: sm,
    concurrencyTracker: tracker,
    initial: { activeEventId: "event-A", eventEpoch: 1, viewEpoch: 1 }
  });

  const scopeA = coord.createViewScope("squad_prep");
  assert.equal(coord.isViewScopeActive(scopeA), true);

  // Switch to event B (bumps eventEpoch)
  const tokenB = tracker.startIntent("event", "event-B");
  coord.commitSelection(coord.createTargetScope("event-B", tokenB));

  // Previous scopeA is no longer active
  assert.equal(coord.isViewScopeActive(scopeA), false);
});
