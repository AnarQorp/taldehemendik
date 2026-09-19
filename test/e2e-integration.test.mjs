import test from "node:test";
import assert from "node:assert/strict";
import { createApi, DEMO_CONFIG, API_BASE_URL } from "../src/api/index.js";

const api = createApi(API_BASE_URL);

test("Complete Operational Flow E2E: Mikel + Elena + Torneo Indautxu + Replacement", async () => {
  // 1. Reset database to clean initial state
  const resetRes = await api.dev.resetDataset();
  assert.equal(resetRes.status, "ok");
  assert.equal(resetRes.dataset, "vs02_full");

  // 2. Mikel logs in
  const coachAuth = await api.auth.loginDev(DEMO_CONFIG.COACH_EMAIL, "Mikel Zubeldia");
  assert.ok(coachAuth.accessToken);
  assert.equal(coachAuth.user.id, "00000000-0000-4000-8000-000000000001");

  // 3. Mikel queries availability for Torneo Indautxu
  api.client.setToken(coachAuth.accessToken);
  const avail = await api.availability.getEventAvailability(DEMO_CONFIG.EVENT_INDAUTXU_ID);
  assert.deepEqual(avail.counts, {
    CAN_ATTEND: 14,
    CANNOT_ATTEND: 2,
    UNSURE: 0,
    NO_RESPONSE: 2
  });

  // 4. Mikel selects 12 players (11 available + 1 unresponded, leaving Ane, Irati, Nahia as reserves)
  const reserveIds = [DEMO_CONFIG.ANE_PLAYER_ID, "30000000-0000-4000-8000-000000000004", "30000000-0000-4000-8000-000000000003"];
  const canAttendCalled = avail.items.filter((p) => p.status === "CAN_ATTEND" && !reserveIds.includes(p.player_id)).map((p) => p.player_id);
  const noResponse = avail.items.filter((p) => p.status === "NO_RESPONSE").map((p) => p.player_id);
  const selected12 = canAttendCalled.concat(noResponse.slice(0, 1));

  assert.equal(selected12.length, 12);
  assert.ok(selected12.includes(DEMO_CONFIG.IBAI_PLAYER_ID), "Ibai must be selected");

  const draft = await api.callup.createDraft(DEMO_CONFIG.EVENT_INDAUTXU_ID, selected12);
  assert.ok(draft.id);
  assert.equal(draft.status, "DRAFT");

  // 5. Attempt publish without confirmed warnings -> expect CALLUP_WARNINGS_UNCONFIRMED
  const publishIdemKey = api.idempotency.getOrCreateKey(`publish-${draft.id}`);

  await assert.rejects(
    async () => {
      await api.callup.publishCallup(draft.id, { expectedVersion: draft.version, confirmWarnings: [] }, publishIdemKey);
    },
    (err) => {
      assert.equal(err.code, "CALLUP_WARNINGS_UNCONFIRMED");
      return true;
    }
  );

  // 6. Retry publish confirming warnings with the EXACT same Idempotency-Key
  const warnings = [`PLAYER_NO_RESPONSE:${noResponse[0]}`];
  const published = await api.callup.publishCallup(
    draft.id,
    { expectedVersion: draft.version, confirmWarnings: warnings },
    publishIdemKey
  );
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.current_revision_number, 1);
  api.idempotency.clearKey(`publish-${draft.id}`);

  // 7. Elena logs in
  const parentAuth = await api.auth.loginDev(DEMO_CONFIG.GUARDIAN_EMAIL, "Elena Gómez");
  assert.ok(parentAuth.accessToken);
  assert.equal(parentAuth.user.id, "00000000-0000-4000-8000-000000000003");

  // 8. Elena queries Ibai's callup status -> should be called: true, revision: 1
  api.client.setToken(parentAuth.accessToken);
  const status1 = await api.callup.getPlayerCallupStatus(DEMO_CONFIG.EVENT_INDAUTXU_ID, DEMO_CONFIG.IBAI_PLAYER_ID);
  assert.equal(status1.called, true);
  assert.equal(status1.revision, 1);

  // 9. Elena changes Ibai's availability to CANNOT_ATTEND
  const ibaiAvail = await api.availability.getPlayerAvailability(DEMO_CONFIG.EVENT_INDAUTXU_ID, DEMO_CONFIG.IBAI_PLAYER_ID);
  const rsvpIdemKey = api.idempotency.getOrCreateKey("elena-rsvp-indautxu");

  const updateRes = await api.availability.setGuardianAvailability(
    DEMO_CONFIG.EVENT_INDAUTXU_ID,
    DEMO_CONFIG.IBAI_PLAYER_ID,
    { status: "CANNOT_ATTEND", expectedVersion: ibaiAvail.current.version },
    rsvpIdemKey
  );
  assert.equal(updateRes.status, "CANNOT_ATTEND");
  api.idempotency.clearKey("elena-rsvp-indautxu");

  // 10. Mikel switches back and checks pending action items
  api.client.setToken(coachAuth.accessToken);
  const pending = await api.pending.getPending(DEMO_CONFIG.TEAM_SEASON_ID);
  const injuryActionItem = pending.actionItems.find(
    (item) => item.type === "CALLED_PLAYER_UNAVAILABLE" && item.status === "OPEN" && item.player_id === DEMO_CONFIG.IBAI_PLAYER_ID
  );
  assert.ok(injuryActionItem, "CALLED_PLAYER_UNAVAILABLE ActionItem must be OPEN");

  // 11. Mikel queries replacement candidates
  const candidatesRes = await api.pending.getReplacementCandidates(injuryActionItem.id);
  assert.equal(candidatesRes.items.length, 3);
  const candidateNames = candidatesRes.items.map((p) => p.first_name);
  assert.deepEqual(candidateNames, ["Ane", "Irati", "Nahia"]);

  // 12. Mikel replaces Ibai with Ane Mintegi
  const replaceIdemKey = api.idempotency.getOrCreateKey(`replace-${injuryActionItem.id}`);
  const replaceRes = await api.pending.replacePlayer(
    injuryActionItem.id,
    {
      substitutePlayerId: DEMO_CONFIG.ANE_PLAYER_ID,
      expectedCallupRevision: 1
    },
    replaceIdemKey
  );
  assert.equal(replaceRes.status, "RESOLVED");
  assert.equal(replaceRes.revisionNumber, 2);
  assert.equal(replaceRes.removedPlayerId, DEMO_CONFIG.IBAI_PLAYER_ID);
  assert.equal(replaceRes.addedPlayerId, DEMO_CONFIG.ANE_PLAYER_ID);
  api.idempotency.clearKey(`replace-${injuryActionItem.id}`);

  // 13. Elena checks Ibai status again -> called must now be false, revision 2
  api.client.setToken(parentAuth.accessToken);
  const status2 = await api.callup.getPlayerCallupStatus(DEMO_CONFIG.EVENT_INDAUTXU_ID, DEMO_CONFIG.IBAI_PLAYER_ID);
  assert.equal(status2.called, false);
  assert.equal(status2.revision, 2);

  // 14. Test Conflict 1: CALLUP_VERSION_CONFLICT
  api.client.setToken(coachAuth.accessToken);
  await assert.rejects(
    async () => {
      await api.callup.reviseCallup(published.id, {
        playerIds: selected12,
        expectedRevision: 999,
        confirmWarnings: []
      });
    },
    (err) => {
      assert.equal(err.code, "CALLUP_VERSION_CONFLICT");
      assert.equal(err.status, 409);
      return true;
    }
  );

  // 15. Test Conflict 2: SUBSTITUTE_NO_LONGER_ELIGIBLE
  // Try to replace on an already resolved action item -> ACTION_ITEM_NOT_OPEN
  await assert.rejects(
    async () => {
      await api.pending.replacePlayer(injuryActionItem.id, {
        substitutePlayerId: DEMO_CONFIG.ANE_PLAYER_ID,
        expectedCallupRevision: 2
      });
    },
    (err) => {
      assert.equal(err.code, "ACTION_ITEM_NOT_OPEN");
      return true;
    }
  );
});
