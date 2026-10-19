import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../backend/dist/app.js";
import { ProductionAuthAdapter } from "../backend/dist/auth/production.js";
import { authPool, pool, rawPool } from "../backend/dist/db/pool.js";
import { ApiClient } from "../src/api/client.js";
import { AuthService } from "../src/api/auth.js";
import { TeamsService } from "../src/api/teams.js";
import { InvitationsService } from "../src/api/invitations.js";

const secret = "production-auth-test-secret-at-least-32-chars-long";
const deliveredMessages = [];
const delivery = {
  async sendMail(message) {
    const code = message.text.match(/\b\d{6}\b/)?.[0];
    deliveredMessages.push({ to: message.to, text: message.text, code });
    return {};
  }
};

const authAdapter = new ProductionAuthAdapter({
  pool: authPool,
  delivery,
  secret,
  from: "auth@taldehemendik.test"
});

let app;
let baseUrl;

test.before(async () => {
  // Ensure database schema and migrations are ready
  await rawPool.query("SELECT 1 FROM auth_challenges LIMIT 1");
  app = await buildApp({ authAdapter, enableDevReset: false });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  baseUrl = `${address}/v1`;
});

test.after(async () => {
  if (app) await app.close();
  await Promise.allSettled([authPool.end(), pool.end(), rawPool.end()]);
});

test("E2E Production Auth Lifecycle: Coach OTP -> Bootstrap -> Guardian OTP -> Join -> Approval -> Consolidation", async () => {
  const coachEmail = `coach-${randomUUID().slice(0, 8)}@example.test`;
  const coachDisplayName = "Entrenador Mikel Test";

  const coachClient = new ApiClient(baseUrl);
  const coachAuth = new AuthService(coachClient);
  const coachTeams = new TeamsService(coachClient);

  // 1. Coach requests OTP
  const coachReq = await coachAuth.requestOtp(coachEmail);
  assert.ok(coachReq.challengeId, "Must return challengeId");
  assert.equal(coachReq.developmentOtp, undefined, "Production backend must NEVER expose OTP in response");

  // Retrieve code from test mail delivery
  const coachMail = deliveredMessages.find(m => m.to === coachEmail);
  assert.ok(coachMail, "Message must be delivered to mail transport");
  assert.match(coachMail.code, /^\d{6}$/, "Code must be 6 digits");

  // Test double-submit / concurrent verification concurrency
  const parallelVerifications = await Promise.allSettled(
    Array.from({ length: 4 }, () => coachAuth.verifyOtp(coachEmail, coachReq.challengeId, coachMail.code, coachDisplayName))
  );
  const successes = parallelVerifications.filter(r => r.status === "fulfilled");
  assert.equal(successes.length, 1, "Exactly one verification must succeed (atomic consumption)");

  const coachAuthRes = successes[0].value;
  assert.ok(coachAuthRes.accessToken, "Must issue valid access token");
  assert.equal(coachAuthRes.user.email, coachEmail);
  coachClient.setToken(coachAuthRes.accessToken);

  // 2. Coach bootstraps a new team
  const bootstrapIdemKey = `idem-${randomUUID()}`;
  const teamRes = await coachTeams.bootstrap({
    team: { name: "C.D. Aurrera", sport: "FOOTBALL" },
    teamSeason: {
      seasonLabel: "2026/27",
      category: "Infantil",
      displayLabel: "Infantil A"
    },
    createGeneralJoinCode: true
  }, bootstrapIdemKey);

  assert.ok(teamRes.teamSeason.id);
  assert.ok(teamRes.joinCode, "Must create a general join code");
  const teamSeasonId = teamRes.teamSeason.id;
  const joinCode = teamRes.joinCode;

  // Coach adds a player to roster
  const playerIdemKey = `idem-player-${randomUUID()}`;
  const playerRes = await coachTeams.addPlayer(teamSeasonId, {
    firstName: "Markel",
    lastName: "Susaeta",
    shirtNumber: 14,
    position: "Extremo"
  }, playerIdemKey);

  assert.ok(playerRes.player.id);
  const playerId = playerRes.player.id;

  // 3. Guardian requests OTP
  const guardianEmail = `parent-${randomUUID().slice(0, 8)}@example.test`;
  const guardianDisplayName = "Amaia Tutora";

  const guardianClient = new ApiClient(baseUrl);
  const guardianAuth = new AuthService(guardianClient);
  const guardianInvitations = new InvitationsService(guardianClient);
  const guardianTeams = new TeamsService(guardianClient);

  const guardianReq = await guardianAuth.requestOtp(guardianEmail);
  assert.ok(guardianReq.challengeId);

  const guardianMail = deliveredMessages.find(m => m.to === guardianEmail);
  assert.ok(guardianMail);

  const guardianAuthRes = await guardianAuth.verifyOtp(
    guardianEmail,
    guardianReq.challengeId,
    guardianMail.code,
    guardianDisplayName
  );
  assert.ok(guardianAuthRes.accessToken);
  guardianClient.setToken(guardianAuthRes.accessToken);

  // 4. Guardian requests general join with claimed player name
  const joinReqRes = await guardianInvitations.requestGeneralLink(joinCode, {
    claimedPlayerName: "Markel Susaeta",
    claimedShirtNumber: 14
  });
  assert.ok(joinReqRes.id);
  const linkRequestId = joinReqRes.id;

  // 5. Coach approves link request
  const approveRes = await coachClient.post(
    `/guardian-link-requests/${linkRequestId}/approve`,
    { playerId }
  );
  assert.ok(approveRes.guardianLinkId);

  // 6. Guardian checks memberships -> active guardian with linked player
  const memRes = await guardianTeams.getMyMemberships();
  assert.ok(Array.isArray(memRes.items));
  const guardianMem = memRes.items.find(m => m.team_season_id === teamSeasonId && m.role === "GUARDIAN");
  assert.ok(guardianMem, "Guardian must now have active membership in team");
  assert.equal(guardianMem.status, "ACTIVE");
  assert.ok(guardianMem.guardian_players.length >= 1);
  assert.equal(guardianMem.guardian_players[0].playerId, playerId);
});

test("Security & Resilience: Rate limit 429, Lockout after 5 failures, Expired token rejection", async () => {
  const email = `throttle-${randomUUID().slice(0, 8)}@example.test`;
  const client = new ApiClient(baseUrl);
  const auth = new AuthService(client);

  // First OTP request succeeds
  const req1 = await auth.requestOtp(email);
  assert.ok(req1.challengeId);

  // Immediate second request within 60s must fail with 429
  await assert.rejects(
    async () => { await auth.requestOtp(email); },
    (err) => {
      assert.equal(err.status, 429);
      return true;
    }
  );

  // Lockout test: 5 wrong attempts on a new challenge
  const email2 = `lockout-${randomUUID().slice(0, 8)}@example.test`;
  const req2 = await auth.requestOtp(email2);
  const mail2 = deliveredMessages.find(m => m.to === email2);
  assert.ok(mail2);

  for (let i = 0; i < 5; i++) {
    await assert.rejects(
      async () => { await auth.verifyOtp(email2, req2.challengeId, "999999"); },
      (err) => {
        assert.equal(err.status, 401);
        return true;
      }
    );
  }

  // 6th attempt with the CORRECT code must now be rejected (locked out)
  await assert.rejects(
    async () => { await auth.verifyOtp(email2, req2.challengeId, mail2.code); },
    (err) => {
      assert.equal(err.status, 401);
      return true;
    }
  );

  // Session expiry test: invalid / tampered token
  client.setToken("invalid.or.expired.jwt.token");
  await assert.rejects(
    async () => { await client.get("/me/memberships"); },
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.code, "AUTH_INVALID");
      return true;
    }
  );
});

test("Multi-membership user: Single identity holds both COACH and GUARDIAN roles", async () => {
  const userEmail = `multi-${randomUUID().slice(0, 8)}@example.test`;
  const client = new ApiClient(baseUrl);
  const auth = new AuthService(client);
  const teams = new TeamsService(client);
  const invitations = new InvitationsService(client);

  // 1. User logs in with production OTP
  const req = await auth.requestOtp(userEmail);
  const mail = deliveredMessages.find(m => m.to === userEmail);
  const authRes = await auth.verifyOtp(userEmail, req.challengeId, mail.code, "Usuario Multi-Rol");
  client.setToken(authRes.accessToken);

  // 2. User bootstraps Team 1 as COACH
  const team1Res = await teams.bootstrap({
    team: { name: "Club Deportivo 1", sport: "FOOTBALL" },
    teamSeason: { seasonLabel: "2026/27", category: "Infantil", displayLabel: "Infantil A" },
    createGeneralJoinCode: true
  }, `idem-multi-1-${randomUUID()}`);

  // 3. Another coach bootstraps Team 2 and adds player
  const coach2Email = `othercoach-${randomUUID().slice(0, 8)}@example.test`;
  const coach2Client = new ApiClient(baseUrl);
  const coach2Auth = new AuthService(coach2Client);
  const coach2Teams = new TeamsService(coach2Client);

  const c2Req = await coach2Auth.requestOtp(coach2Email);
  const c2Mail = deliveredMessages.find(m => m.to === coach2Email);
  const c2AuthRes = await coach2Auth.verifyOtp(coach2Email, c2Req.challengeId, c2Mail.code, "Entrenador 2");
  coach2Client.setToken(c2AuthRes.accessToken);

  const team2Res = await coach2Teams.bootstrap({
    team: { name: "Club Deportivo 2", sport: "FOOTBALL" },
    teamSeason: { seasonLabel: "2026/27", category: "Alevin", displayLabel: "Alevin B" },
    createGeneralJoinCode: true
  }, `idem-multi-2-${randomUUID()}`);

  const p2Res = await coach2Teams.addPlayer(team2Res.teamSeason.id, {
    firstName: "Jon",
    lastName: "Pérez",
    shirtNumber: 7
  }, `idem-p2-${randomUUID()}`);

  // 4. Multi-role user requests join on Team 2 as GUARDIAN
  const linkReq = await invitations.requestGeneralLink(team2Res.joinCode, {
    claimedPlayerName: "Jon Pérez",
    claimedShirtNumber: 7
  });

  // 5. Coach 2 approves request
  await coach2Client.post(`/guardian-link-requests/${linkReq.id}/approve`, {
    playerId: p2Res.player.id
  });

  // 6. Multi-role user queries memberships
  const membershipsRes = await teams.getMyMemberships();
  assert.equal(membershipsRes.items.length, 2, "User must hold both memberships under the single unified token");

  const coachRole = membershipsRes.items.find(m => m.role === "COACH");
  const guardianRole = membershipsRes.items.find(m => m.role === "GUARDIAN");

  assert.ok(coachRole, "User must have active COACH membership in Team 1");
  assert.ok(guardianRole, "User must have active GUARDIAN membership in Team 2");
  assert.equal(coachRole.team_id, team1Res.team.id);
  assert.equal(guardianRole.team_id, team2Res.team.id);
  assert.equal(guardianRole.guardian_players[0].playerId, p2Res.player.id);
});
