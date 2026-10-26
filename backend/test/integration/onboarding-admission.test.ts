import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { ProductionAuthAdapter, type OtpDelivery } from "../../src/auth/production.js";
import { rawPool as pool, authPool } from "../../src/db/pool.js";

const secret = "test-secret-admission-gate-32-chars-long!!";
const delivered = new Map<string, string>();
const delivery: OtpDelivery = {
  async sendMail(message) {
    const match = message.text.match(/\b\d{6}\b/);
    if (match) delivered.set(message.to, match[0]);
    return {};
  }
};

const allowedEmails = ["coach@authorized.club", "staff@authorized.club"];
const policyRevision = "beta02-rev1";

let adapter = new ProductionAuthAdapter({
  pool: authPool,
  delivery,
  secret,
  allowedEmails,
  policyRevision,
  from: "auth@talde.test"
});

const app = await buildApp({ authAdapter: adapter });
const bearer = (token: string, key?: string) => ({
  authorization: `Bearer ${token}`,
  ...(key ? { "idempotency-key": key } : {})
});

describe("Autonomous Onboarding & Admission Security Gate", () => {
  let coachToken: string;
  let coachUserId: string;
  let seasonId: string;
  let joinCode: string;
  let playerId: string;
  let inviteToken: string;

  beforeAll(async () => {
    // Empty database tables for clean test
    await pool.query("TRUNCATE teams, team_seasons, players, roster_entries, invitations, guardian_link_requests, guardian_links, memberships, team_notices, player_direct_messages, auth_challenges CASCADE");
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await authPool.end();
  });

  it("1. Rejects unknown email requesting OTP without invitation token or team code", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { email: "unauthorized@outside.invalid" }
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTH_INVALID");
  });

  it("2. Rejects unknown email with invalid invitation token or invalid team code", async () => {
    const resInvite = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { email: "unauthorized@outside.invalid", invitationToken: "invalid-token-123" }
    });
    expect(resInvite.statusCode).toBe(401);

    const resCode = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { email: "unauthorized@outside.invalid", teamCode: "NOPE99" }
    });
    expect(resCode.statusCode).toBe(401);
  });

  it("3. Allows authorized coach email, verifies OTP, and bootstraps team", async () => {
    const reqRes = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { email: "coach@authorized.club" }
    });
    expect(reqRes.statusCode).toBe(200);
    const { challengeId } = reqRes.json();
    const code = delivered.get("coach@authorized.club")!;
    expect(code).toBeDefined();

    const verifyRes = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { email: "coach@authorized.club", challengeId, otp: code, displayName: "Mikel Arteta" }
    });
    expect(verifyRes.statusCode).toBe(200);
    coachToken = verifyRes.json().accessToken;
    coachUserId = verifyRes.json().user.id;
    expect(coachToken).toBeDefined();

    // Bootstrap team with joinCode
    const bootRes = await app.inject({
      method: "POST",
      url: "/v1/teams/bootstrap",
      headers: bearer(coachToken, "boot-adm-1"),
      payload: {
        team: { name: "Indautxu Juvenil", sport: "FOOTBALL" },
        teamSeason: { seasonLabel: "2026/27", category: "Juvenil", displayLabel: "Juvenil A" },
        createGeneralJoinCode: true
      }
    });
    expect(bootRes.statusCode).toBe(201);
    seasonId = bootRes.json().teamSeason.id;
    joinCode = bootRes.json().joinCode;
    expect(joinCode).toMatch(/^[A-F0-9]{8}$/);

    // Add player Unai Gómez
    const playerRes = await app.inject({
      method: "POST",
      url: `/v1/team-seasons/${seasonId}/players`,
      headers: bearer(coachToken, "player-unai-1"),
      payload: { firstName: "Unai", lastName: "Gómez", shirtNumber: 10 }
    });
    expect(playerRes.statusCode).toBe(201);
    playerId = playerRes.json().player.id;

    // Create individual invitation for Unai
    const inviteRes = await app.inject({
      method: "POST",
      url: `/v1/team-seasons/${seasonId}/players/${playerId}/invitations`,
      headers: bearer(coachToken),
      payload: {}
    });
    expect(inviteRes.statusCode).toBe(201);
    inviteToken = inviteRes.json().token;
    expect(inviteToken).toBeDefined();
  });

  it("4. Admits new family via player invitation token; OTP does NOT grant memberships", async () => {
    const familyEmail = "ama-unai@correo-familia.test";

    // Request OTP presenting valid invitationToken
    const reqRes = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { email: familyEmail, invitationToken: inviteToken }
    });
    expect(reqRes.statusCode).toBe(200);
    const { challengeId } = reqRes.json();
    const code = delivered.get(familyEmail)!;
    expect(code).toBeDefined();

    // Verify OTP
    const verifyRes = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { email: familyEmail, challengeId, otp: code, displayName: "Amaia Gómez" }
    });
    expect(verifyRes.statusCode).toBe(200);
    const familyToken = verifyRes.json().accessToken;

    // INVARIANT: OTP alone does NOT grant memberships or private access!
    const memRes = await app.inject({
      method: "GET",
      url: "/v1/me/memberships",
      headers: bearer(familyToken)
    });
    expect(memRes.statusCode).toBe(200);
    expect(memRes.json().items).toHaveLength(0);

    // Attempting to access notices or player directly is forbidden
    const noticeRes = await app.inject({
      method: "GET",
      url: `/v1/team-seasons/${seasonId}/notices`,
      headers: bearer(familyToken)
    });
    expect(noticeRes.statusCode).toBe(403);

    // Submit guardian link request
    const claimRes = await app.inject({
      method: "POST",
      url: `/v1/invitations/${inviteToken}/guardian-link-requests`,
      headers: bearer(familyToken),
      payload: { relationship: "Madre", contactPhone: "+34 600 11 22 33" }
    });
    expect(claimRes.statusCode).toBe(201);
    expect(claimRes.json().status).toBe("PENDING");
    const requestId = claimRes.json().id;

    // Coach views pending requests and approves
    const listReqs = await app.inject({
      method: "GET",
      url: `/v1/team-seasons/${seasonId}/guardian-link-requests`,
      headers: bearer(coachToken)
    });
    expect(listReqs.statusCode).toBe(200);
    expect(listReqs.json().items).toHaveLength(1);

    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/guardian-link-requests/${requestId}/approve`,
      headers: bearer(coachToken),
      payload: {}
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().status).toBe("APPROVED");

    // NOW family has active GUARDIAN membership and access to team
    const updatedMem = await app.inject({
      method: "GET",
      url: "/v1/me/memberships",
      headers: bearer(familyToken)
    });
    expect(updatedMem.statusCode).toBe(200);
    expect(updatedMem.json().items).toEqual([
      expect.objectContaining({ role: "GUARDIAN", status: "ACTIVE", team_season_id: seasonId })
    ]);
  });

  it("5. Admits new family via team join code; OTP does NOT grant memberships until approved", async () => {
    const aitaEmail = "aita-ander@correo-familia.test";

    // Request OTP presenting valid teamCode
    const reqRes = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { email: aitaEmail, teamCode: joinCode }
    });
    expect(reqRes.statusCode).toBe(200);
    const { challengeId } = reqRes.json();
    const code = delivered.get(aitaEmail)!;

    // Verify OTP
    const verifyRes = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { email: aitaEmail, challengeId, otp: code, displayName: "Aitor Herrera" }
    });
    expect(verifyRes.statusCode).toBe(200);
    const aitaToken = verifyRes.json().accessToken;

    // INVARIANT: 0 memberships immediately after OTP
    const memRes = await app.inject({
      method: "GET",
      url: "/v1/me/memberships",
      headers: bearer(aitaToken)
    });
    expect(memRes.statusCode).toBe(200);
    expect(memRes.json().items).toHaveLength(0);

    // Submit general link request with claimed child
    const claimRes = await app.inject({
      method: "POST",
      url: `/v1/team-join/${joinCode}/guardian-link-requests`,
      headers: bearer(aitaToken),
      payload: { claimedPlayerName: "Ander Herrera", relationship: "Padre", contactPhone: "+34 600 44 55 66" }
    });
    expect(claimRes.statusCode).toBe(201);
    expect(claimRes.json().status).toBe("PENDING");
  });

  it("6. Enforces policy revision and revokes old tokens when revision rotates", async () => {
    // Valid request using coachToken (issued under beta02-rev1)
    const validRes = await app.inject({
      method: "GET",
      url: "/v1/me/memberships",
      headers: bearer(coachToken)
    });
    expect(validRes.statusCode).toBe(200);

    // Replace adapter with rotated policy revision beta02-rev2
    const rotatedAdapter = new ProductionAuthAdapter({
      pool: authPool,
      delivery,
      secret,
      allowedEmails,
      policyRevision: "beta02-rev2",
      from: "auth@talde.test"
    });
    const rotatedApp = await buildApp({ authAdapter: rotatedAdapter });

    // Attempting request with coachToken (signed under beta02-rev1) is immediately rejected (401)!
    const revokedRes = await rotatedApp.inject({
      method: "GET",
      url: "/v1/me/memberships",
      headers: bearer(coachToken)
    });
    expect(revokedRes.statusCode).toBe(401);
    expect(revokedRes.json().error.code).toBe("AUTH_INVALID");

    await rotatedApp.close();
  });
});
