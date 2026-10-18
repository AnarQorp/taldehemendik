import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { DevelopmentAuthAdapter } from "../../src/auth/development-adapter.js";
import { ids } from "../../src/db/ids.js";
import { rawPool as pool } from "../../src/db/pool.js";

const auth = new DevelopmentAuthAdapter(true);
const app = await buildApp({ authAdapter: auth });

async function login(email: string, displayName: string) {
  const requested = await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { email } });
  expect(requested.statusCode).toBe(200);
  const challenge = requested.json();
  const verified = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { email, displayName, challengeId: challenge.challengeId, otp: challenge.developmentOtp } });
  expect(verified.statusCode).toBe(200);
  return { token: verified.json().accessToken as string, user: verified.json().user };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("Vertical Slice 01", () => {
  let coachToken: string;
  let staffToken: string;
  let guardianToken: string;
  let guardianId: string;
  let invitationToken: string;
  let requestId: string;

  beforeAll(async () => {
    coachToken = (await login("mikel@example.test", "Mikel Zubeldia")).token;
    staffToken = (await login("staff@example.test", "Ane Staff")).token;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("rejects invalid and expired invitations with stable codes", async () => {
    const invalid = await app.inject({ method: "GET", url: "/v1/invitations/invalid-token-long-enough" });
    expect(invalid.statusCode).toBe(404);
    expect(invalid.json().error.code).toBe("INVITATION_INVALID");
    await pool.query(`INSERT INTO invitations(team_season_id,player_id,purpose,token_hash,expires_at,created_by_user_id)
      VALUES($1,$2,'GUARDIAN_LINK',encode(digest('expired-token-long-enough','sha256'),'hex'),now()-interval '1 minute',$3)`, [ids.season,ids.ibai,ids.coach]);
    const expired = await app.inject({ method: "GET", url: "/v1/invitations/expired-token-long-enough" });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe("INVITATION_EXPIRED");
  });

  it("coach creates a hashed invitation whose public view has no player PII", async () => {
    const created = await app.inject({
      method: "POST", url: `/v1/team-seasons/${ids.season}/players/${ids.ibai}/invitations`, headers: bearer(coachToken)
    });
    expect(created.statusCode).toBe(201);
    invitationToken = created.json().token;
    const stored = await pool.query(`SELECT token_hash FROM invitations WHERE id=$1`, [created.json().id]);
    expect(stored.rows[0].token_hash).not.toBe(invitationToken);
    expect(stored.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    const resolved = await app.inject({ method: "GET", url: `/v1/invitations/${invitationToken}` });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toEqual({ team: { name: "S. D. Indautxu" }, teamSeason: { seasonLabel: "2026/27", displayLabel: "Infantil A" }, purpose: "GUARDIAN_LINK" });
    expect(resolved.body).not.toContain("Ibai");
    expect(resolved.body).not.toContain("Aranguren");
  });

  it("authentication and a pending request do not grant player access", async () => {
    const guardian = await login("elena@example.test", "Elena Gómez");
    guardianToken = guardian.token;
    guardianId = guardian.user.id;
    const before = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.season}/players/${ids.ibai}`, headers: bearer(guardianToken) });
    expect(before.statusCode).toBe(403);
    const requested = await app.inject({ method: "POST", url: `/v1/invitations/${invitationToken}/guardian-link-requests`, headers: bearer(guardianToken) });
    expect(requested.statusCode).toBe(201);
    expect(requested.json().status).toBe("PENDING");
    requestId = requested.json().id;
    const pending = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.season}/players/${ids.ibai}`, headers: bearer(guardianToken) });
    expect(pending.statusCode).toBe(403);
  });

  it("only coach lists and approves requests; approval is transactional and idempotent", async () => {
    const coachList = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.season}/guardian-link-requests`, headers: bearer(coachToken) });
    expect(coachList.statusCode).toBe(200);
    expect(coachList.json().items[0]).toMatchObject({ id: requestId, display_name: "Elena Gómez", first_name: "Ibai" });
    const staffList = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.season}/guardian-link-requests`, headers: bearer(staffToken) });
    expect(staffList.statusCode).toBe(403);
    const staffApprove = await app.inject({ method: "POST", url: `/v1/guardian-link-requests/${requestId}/approve`, headers: bearer(staffToken) });
    expect(staffApprove.statusCode).toBe(403);
    const guardianApprove = await app.inject({ method: "POST", url: `/v1/guardian-link-requests/${requestId}/approve`, headers: bearer(guardianToken) });
    expect(guardianApprove.statusCode).toBe(403);
    const approved = await app.inject({ method: "POST", url: `/v1/guardian-link-requests/${requestId}/approve`, headers: bearer(coachToken) });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().idempotentReplay).toBe(false);
    const replay = await app.inject({ method: "POST", url: `/v1/guardian-link-requests/${requestId}/approve`, headers: bearer(coachToken) });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().idempotentReplay).toBe(true);
    const counts = await pool.query(`SELECT
      (SELECT count(*) FROM memberships WHERE user_id=$1 AND team_season_id=$2 AND role='GUARDIAN') memberships,
      (SELECT count(*) FROM guardian_links WHERE guardian_user_id=$1 AND player_id=$3) links,
      (SELECT count(*) FROM audit_events WHERE entity_id=$4 AND action='GUARDIAN_LINK_REQUEST_APPROVED') approvals`, [guardianId,ids.season,ids.ibai,requestId]);
    expect(counts.rows[0]).toEqual({ memberships: "1", links: "1", approvals: "1" });
  });

  it("rolls back every approval write when guardian-link activation fails", async () => {
    const rollbackUser = "00000000-0000-4000-8000-000000000099";
    const rollbackInvitation = "50000000-0000-4000-8000-000000000099";
    const rollbackRequest = "60000000-0000-4000-8000-000000000099";
    await pool.query(`INSERT INTO users(id,auth_subject,email,display_name) VALUES($1,'dev-email:rollback@example.test','rollback@example.test','Rollback Tutor')`, [rollbackUser]);
    await pool.query(`INSERT INTO invitations(id,team_season_id,player_id,purpose,token_hash,expires_at,created_by_user_id)
      VALUES($1,$2,$3,'GUARDIAN_LINK',encode(digest('rollback-invitation-token','sha256'),'hex'),now()+interval '1 day',$4)`, [rollbackInvitation,ids.season,ids.ibai,ids.coach]);
    await pool.query(`INSERT INTO guardian_link_requests(id,invitation_id,requester_user_id,team_season_id,player_id)
      VALUES($1,$2,$3,$4,$5)`, [rollbackRequest,rollbackInvitation,rollbackUser,ids.season,ids.ibai]);
    await pool.query(`CREATE FUNCTION fail_rollback_guardian_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.guardian_user_id='${rollbackUser}'::uuid THEN RAISE EXCEPTION 'forced test failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER test_fail_guardian_link BEFORE INSERT ON guardian_links FOR EACH ROW EXECUTE FUNCTION fail_rollback_guardian_link()`);
    const failed = await app.inject({ method: "POST", url: `/v1/guardian-link-requests/${rollbackRequest}/approve`, headers: bearer(coachToken) });
    expect(failed.statusCode).toBe(500);
    await pool.query(`DROP TRIGGER test_fail_guardian_link ON guardian_links; DROP FUNCTION fail_rollback_guardian_link()`);
    const state = await pool.query(`SELECT
      (SELECT status FROM guardian_link_requests WHERE id=$1) request_status,
      (SELECT count(*) FROM memberships WHERE user_id=$2) memberships,
      (SELECT count(*) FROM guardian_links WHERE guardian_user_id=$2) links,
      (SELECT count(*) FROM audit_events WHERE entity_id=$1) audits`, [rollbackRequest,rollbackUser]);
    expect(state.rows[0]).toEqual({ request_status: "PENDING", memberships: "0", links: "0", audits: "0" });
  });

  it("requires membership + guardian link + active roster and blocks cross-team IDs", async () => {
    const own = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.season}/players/${ids.ibai}`, headers: bearer(guardianToken) });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ first_name: "Ibai", shirt_number: 9 });
    const other = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.otherSeason}/players/${ids.otherPlayer}`, headers: bearer(guardianToken) });
    expect(other.statusCode).toBe(403);
    const coachCross = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.otherSeason}/players/${ids.otherPlayer}`, headers: bearer(coachToken) });
    expect(coachCross.statusCode).toBe(403);
    await pool.query(`UPDATE memberships SET status='SUSPENDED' WHERE user_id=$1 AND team_season_id=$2 AND role='GUARDIAN'`, [guardianId,ids.season]);
    const linkOnly = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.season}/players/${ids.ibai}`, headers: bearer(guardianToken) });
    expect(linkOnly.statusCode).toBe(403);
    await pool.query(`UPDATE memberships SET status='ACTIVE' WHERE user_id=$1 AND team_season_id=$2 AND role='GUARDIAN'`, [guardianId,ids.season]);
    await pool.query(`UPDATE guardian_links SET status='REVOKED' WHERE guardian_user_id=$1 AND player_id=$2`, [guardianId,ids.ibai]);
    const membershipOnly = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.season}/players/${ids.ibai}`, headers: bearer(guardianToken) });
    expect(membershipOnly.statusCode).toBe(403);
    await pool.query(`UPDATE guardian_links SET status='ACTIVE' WHERE guardian_user_id=$1 AND player_id=$2`, [guardianId,ids.ibai]);
    const crossInvitation = await app.inject({ method: "POST", url: `/v1/team-seasons/${ids.season}/players/${ids.otherPlayer}/invitations`, headers: bearer(coachToken) });
    expect(crossInvitation.statusCode).toBe(422);
    const staffCrossMutation = await app.inject({ method: "PUT", url: `/v1/events/${ids.otherEvent}/players/${ids.otherPlayer}/availability/staff-recorded`, headers: bearer(staffToken), payload: { status: "CAN_ATTEND", expectedVersion: 0 } });
    expect(staffCrossMutation.statusCode).toBe(403);
  });

  it("enforces availability closure", async () => {
    await pool.query(`UPDATE events SET availability_closed_at=now() WHERE id=$1`, [ids.event]);
    const closed = await app.inject({ method: "PUT", url: `/v1/events/${ids.event}/players/${ids.ibai}/availability`, headers: { ...bearer(guardianToken), "idempotency-key": "closed-attempt" }, payload: { status: "UNSURE", expectedVersion: 3 } });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.code).toBe("AVAILABILITY_CLOSED");
    await pool.query(`UPDATE events SET availability_closed_at=NULL WHERE id=$1`, [ids.event]);
  });

  it("derives NO_RESPONSE, appends history, supports delegation and rejects stale versions", async () => {
    const empty = await app.inject({ method: "GET", url: `/v1/events/${ids.event}/players/${ids.ibai}/availability`, headers: bearer(guardianToken) });
    expect(empty.json().current).toMatchObject({ status: "NO_RESPONSE", version: 0 });
    const first = await app.inject({ method: "PUT", url: `/v1/events/${ids.event}/players/${ids.ibai}/availability`, headers: { ...bearer(guardianToken), "idempotency-key": "guardian-first" }, payload: { status: "CAN_ATTEND", expectedVersion: 0 } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: "CAN_ATTEND", version: 1, source: "GUARDIAN_RECORDED" });
    const replay = await app.inject({ method: "PUT", url: `/v1/events/${ids.event}/players/${ids.ibai}/availability`, headers: { ...bearer(guardianToken), "idempotency-key": "guardian-first" }, payload: { status: "CAN_ATTEND", expectedVersion: 0 } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().idempotentReplay).toBe(true);
    const delegated = await app.inject({ method: "PUT", url: `/v1/events/${ids.event}/players/${ids.ibai}/availability/staff-recorded`, headers: { ...bearer(staffToken), "idempotency-key": "staff-phone" }, payload: { status: "UNSURE", expectedVersion: 1, note: "Comunicado por teléfono" } });
    expect(delegated.statusCode).toBe(200);
    expect(delegated.json()).toMatchObject({ version: 2, source: "STAFF_RECORDED" });
    const guardianAfterStaff = await app.inject({ method: "PUT", url: `/v1/events/${ids.event}/players/${ids.ibai}/availability`, headers: { ...bearer(guardianToken), "idempotency-key": "guardian-after-staff" }, payload: { status: "CAN_ATTEND", expectedVersion: 2 } });
    expect(guardianAfterStaff.statusCode).toBe(200);
    const stale = await app.inject({ method: "PUT", url: `/v1/events/${ids.event}/players/${ids.ibai}/availability`, headers: { ...bearer(guardianToken), "idempotency-key": "stale-attempt" }, payload: { status: "UNSURE", expectedVersion: 2 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("AVAILABILITY_VERSION_CONFLICT");
    const detail = await app.inject({ method: "GET", url: `/v1/events/${ids.event}/players/${ids.ibai}/availability`, headers: bearer(guardianToken) });
    expect(detail.json().history).toHaveLength(3);
    expect(detail.json().history.map((x: { source: string }) => x.source)).toEqual(["GUARDIAN_RECORDED","STAFF_RECORDED","GUARDIAN_RECORDED"]);
    const coachView = await app.inject({ method: "GET", url: `/v1/events/${ids.event}/availability`, headers: bearer(coachToken) });
    expect(coachView.json().items.find((item: { player_id: string }) => item.player_id === ids.ibai)).toMatchObject({ first_name: "Ibai", status: "CAN_ATTEND", version: 3, source: "GUARDIAN_RECORDED", actor_user_id: guardianId });
  });

  it("writes outbox and audit without invitation tokens or OTPs", async () => {
    const events = await pool.query(`SELECT event_type,payload::text FROM outbox_events ORDER BY created_at`);
    expect(events.rows.map((x) => x.event_type)).toEqual(expect.arrayContaining(["GuardianLinkApproved","AvailabilityChanged"]));
    const audit = await pool.query(`SELECT action,metadata::text FROM audit_events ORDER BY created_at`);
    expect(audit.rows.map((x) => x.action)).toEqual(expect.arrayContaining(["INVITATION_CREATED","GUARDIAN_LINK_REQUEST_CREATED","GUARDIAN_LINK_REQUEST_APPROVED","GUARDIAN_LINK_ACTIVATED","AVAILABILITY_CHANGED","AVAILABILITY_DELEGATED"]));
    const serialized = JSON.stringify({ events: events.rows, audit: audit.rows });
    expect(serialized).not.toContain(invitationToken);
    expect(serialized).not.toMatch(/"otp"/i);
  });
});
