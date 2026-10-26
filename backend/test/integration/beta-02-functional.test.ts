import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { DevelopmentAuthAdapter } from "../../src/auth/development-adapter.js";
import { rawPool as pool } from "../../src/db/pool.js";
import { runBatch } from "../../src/outbox/worker.js";

const auth = new DevelopmentAuthAdapter(true);
const app = await buildApp({ authAdapter: auth });

async function login(email: string, displayName: string) {
  const requested = await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { email } });
  expect(requested.statusCode, requested.body).toBe(200);
  const c = requested.json();
  const verified = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { email, displayName, challengeId: c.challengeId, otp: c.developmentOtp }
  });
  expect(verified.statusCode, verified.body).toBe(200);
  return verified.json() as { accessToken: string; user: { id: string; email: string } };
}

const bearer = (token: string, key?: string) => ({
  authorization: `Bearer ${token}`,
  ...(key ? { "idempotency-key": key } : {})
});

describe("Beta 0.2 Functional & RLS Integration", () => {
  const runId = randomUUID().slice(0, 8);
  let coach: { accessToken: string; user: { id: string; email: string } };
  let otherCoach: { accessToken: string; user: { id: string; email: string } };
  let motherIbai: { accessToken: string; user: { id: string; email: string } };
  let fatherAne: { accessToken: string; user: { id: string; email: string } };

  let teamId: string;
  let seasonId: string;
  let ibaiPlayerId: string;
  let anePlayerId: string;
  let ibaiInviteToken: string;

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("sets up coach, team, season, players, and invitations", async () => {
    coach = await login(`coach-${runId}@example.test`, "Borja Entrenatzailea");
    otherCoach = await login(`other-${runId}@example.test`, "Beste Entrenatzailea");
    motherIbai = await login(`ama-${runId}@example.test`, "Amaia Tutorea");
    fatherAne = await login(`aita-${runId}@example.test`, "Aitor Tutorea");

    // Coach bootstraps team
    const bootstrap = await app.inject({
      method: "POST",
      url: "/v1/teams/bootstrap",
      headers: bearer(coach.accessToken, `bootstrap-${runId}`),
      payload: {
        team: { name: `S.D. Indautxu Beta02 ${runId}`, sport: "FOOTBALL" },
        teamSeason: { seasonLabel: "2026/27", category: "Infantil", displayLabel: "Infantil A" }
      }
    });
    expect(bootstrap.statusCode).toBe(201);
    teamId = bootstrap.json().team.id;
    seasonId = bootstrap.json().teamSeason.id;

    // Add player Ibai
    const p1 = await app.inject({
      method: "POST",
      url: `/v1/team-seasons/${seasonId}/players`,
      headers: bearer(coach.accessToken, `player-ibai-${runId}`),
      payload: { firstName: "Ibai", lastName: "Aranguren", shortName: "Ibai", shirtNumber: 9, position: "DELANTERO" }
    });
    expect(p1.statusCode).toBe(201);
    ibaiPlayerId = p1.json().player.id;

    // Add player Ane
    const p2 = await app.inject({
      method: "POST",
      url: `/v1/team-seasons/${seasonId}/players`,
      headers: bearer(coach.accessToken, `player-ane-${runId}`),
      payload: { firstName: "Ane", lastName: "Bilbao", shortName: "Ane", shirtNumber: 10, position: "CENTROCAMPISTA" }
    });
    expect(p2.statusCode).toBe(201);
    anePlayerId = p2.json().player.id;

    // Create individual invite for Ibai
    const inv = await app.inject({
      method: "POST",
      url: `/v1/team-seasons/${seasonId}/players/${ibaiPlayerId}/invitations`,
      headers: bearer(coach.accessToken)
    });
    expect(inv.statusCode).toBe(201);
    ibaiInviteToken = inv.json().token;
  });

  it("links guardian with relationship and phone, and exposes in coach dossier", async () => {
    // Mother requests link specifying relationship and phone
    const req = await app.inject({
      method: "POST",
      url: `/v1/invitations/${ibaiInviteToken}/guardian-link-requests`,
      headers: bearer(motherIbai.accessToken),
      payload: {
        relationship: "Madre",
        contactPhone: "+34 600 111 222"
      }
    });
    expect(req.statusCode).toBe(201);
    const requestId = req.json().id;

    // Coach approves request
    const approve = await app.inject({
      method: "POST",
      url: `/v1/guardian-link-requests/${requestId}/approve`,
      headers: bearer(coach.accessToken),
      payload: {}
    });
    expect(approve.statusCode).toBe(200);

    // Database verification: relationship and phone are preserved
    const linkDb = await pool.query(
      `SELECT relationship FROM guardian_links WHERE player_id = $1 AND guardian_user_id = $2`,
      [ibaiPlayerId, motherIbai.user.id]
    );
    expect(linkDb.rows[0].relationship).toBe("Madre");

    const userDb = await pool.query(
      `SELECT phone FROM users WHERE id = $1`,
      [motherIbai.user.id]
    );
    expect(userDb.rows[0].phone).toBe("+34 600 111 222");

    // Coach fetches player detail -> includes linked guardians with contact info
    const coachDossier = await app.inject({
      method: "GET",
      url: `/v1/team-seasons/${seasonId}/players/${ibaiPlayerId}`,
      headers: bearer(coach.accessToken)
    });
    expect(coachDossier.statusCode).toBe(200);
    const dossierBody = coachDossier.json();
    expect(dossierBody.id).toBe(ibaiPlayerId);
    expect(dossierBody.linked_guardians).toBeDefined();
    expect(dossierBody.linked_guardians[0]).toMatchObject({
      id: motherIbai.user.id,
      displayName: "Amaia Tutorea",
      email: motherIbai.user.email,
      phone: "+34 600 111 222",
      relationship: "Madre"
    });
  });

  it("publishes team notices, enforces RLS, and records outbox audit", async () => {
    // Non-coach cannot publish notice (403)
    const unauthorizedPublish = await app.inject({
      method: "POST",
      url: `/v1/team-seasons/${seasonId}/notices`,
      headers: bearer(motherIbai.accessToken),
      payload: {
        title: "Intruso",
        body: "No tengo permisos",
        category: "GENERAL",
        isUrgent: false
      }
    });
    expect(unauthorizedPublish.statusCode).toBe(403);

    // Coach publishes urgent match notice
    const publishRes = await app.inject({
      method: "POST",
      url: `/v1/team-seasons/${seasonId}/notices`,
      headers: bearer(coach.accessToken),
      payload: {
        title: "Convocatoria Partido Durango",
        body: "Llevar equipación azul y llegar 45 minutos antes del inicio.",
        category: "CALLUP_NOTICE",
        isUrgent: true
      }
    });
    expect(publishRes.statusCode).toBe(201);
    const notice = publishRes.json();
    expect(notice.title).toBe("Convocatoria Partido Durango");
    expect(notice.category).toBe("CALLUP_NOTICE");
    expect(notice.urgent).toBe(true);

    // Verify outbox entry
    const outbox = await pool.query(
      `SELECT aggregate_type, event_type, payload FROM outbox_events WHERE aggregate_id = $1`,
      [notice.id]
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].aggregate_type).toBe("TeamNotice");
    expect(outbox.rows[0].event_type).toBe("NoticePublished");
    expect(outbox.rows[0].payload.title).toBe("Convocatoria Partido Durango");

    // Coach reads notices
    const coachList = await app.inject({
      method: "GET",
      url: `/v1/team-seasons/${seasonId}/notices`,
      headers: bearer(coach.accessToken)
    });
    expect(coachList.statusCode).toBe(200);
    expect(coachList.json().items).toHaveLength(1);
    expect(coachList.json().items[0].id).toBe(notice.id);

    // Mother (active guardian member) reads notices
    const motherList = await app.inject({
      method: "GET",
      url: `/v1/team-seasons/${seasonId}/notices`,
      headers: bearer(motherIbai.accessToken)
    });
    expect(motherList.statusCode).toBe(200);
    expect(motherList.json().items).toHaveLength(1);
    expect(motherList.json().items[0].title).toBe("Convocatoria Partido Durango");

    // External coach from different team cannot read notices (403)
    const crossCoachList = await app.inject({
      method: "GET",
      url: `/v1/team-seasons/${seasonId}/notices`,
      headers: bearer(otherCoach.accessToken)
    });
    expect(crossCoachList.statusCode).toBe(403);
  });

  it("handles player direct messages with RLS isolation per child", async () => {
    // Non-coach cannot send coach direct message
    const unauthorizedMsg = await app.inject({
      method: "POST",
      url: `/v1/team-seasons/${seasonId}/players/${ibaiPlayerId}/messages`,
      headers: bearer(motherIbai.accessToken),
      payload: { message: "Hola mister" }
    });
    expect(unauthorizedMsg.statusCode).toBe(403);

    // Coach sends direct message for Ibai
    const msgRes = await app.inject({
      method: "POST",
      url: `/v1/team-seasons/${seasonId}/players/${ibaiPlayerId}/messages`,
      headers: bearer(coach.accessToken),
      payload: {
        message: "Ibai ha terminado el entrenamiento con una ligera molestia en el tobillo. Haced reposo esta tarde."
      }
    });
    expect(msgRes.statusCode).toBe(201);
    const directMessage = msgRes.json();
    expect(directMessage.player_id).toBe(ibaiPlayerId);
    expect(directMessage.message).toContain("molestia en el tobillo");

    // Verify outbox entry
    const outbox = await pool.query(
      `SELECT aggregate_type, event_type, payload FROM outbox_events WHERE aggregate_id = $1`,
      [directMessage.id]
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].aggregate_type).toBe("PlayerDirectMessage");
    expect(outbox.rows[0].event_type).toBe("DirectMessageCreated");

    // Coach reads messages for Ibai
    const coachRead = await app.inject({
      method: "GET",
      url: `/v1/team-seasons/${seasonId}/players/${ibaiPlayerId}/messages`,
      headers: bearer(coach.accessToken)
    });
    expect(coachRead.statusCode).toBe(200);
    expect(coachRead.json().items).toHaveLength(1);
    expect(coachRead.json().items[0].id).toBe(directMessage.id);

    // Ibai's mother reads messages for Ibai
    const motherRead = await app.inject({
      method: "GET",
      url: `/v1/team-seasons/${seasonId}/players/${ibaiPlayerId}/messages`,
      headers: bearer(motherIbai.accessToken)
    });
    expect(motherRead.statusCode).toBe(200);
    expect(motherRead.json().items).toHaveLength(1);
    expect(motherRead.json().items[0].message).toContain("molestia en el tobillo");

    // Ane's father (who is not a guardian of Ibai) reads messages for Ibai -> receives empty (RLS isolation)
    const unrelatedGuardianRead = await app.inject({
      method: "GET",
      url: `/v1/team-seasons/${seasonId}/players/${ibaiPlayerId}/messages`,
      headers: bearer(fatherAne.accessToken)
    });
    // fatherAne has no active membership in this team season or link to Ibai
    expect([200, 403]).toContain(unrelatedGuardianRead.statusCode);
    if (unrelatedGuardianRead.statusCode === 200) {
      expect(unrelatedGuardianRead.json().items).toHaveLength(0);
    }
  });

  it("supports multi-membership user switching between coach and guardian", async () => {
    // Mother of Ibai also bootstraps her own basketball team as coach
    const motherCoachBootstrap = await app.inject({
      method: "POST",
      url: "/v1/teams/bootstrap",
      headers: bearer(motherIbai.accessToken, `mother-bootstrap-${runId}`),
      payload: {
        team: { name: `Danok Bat Basket ${runId}`, sport: "BASKETBALL" },
        teamSeason: { seasonLabel: "2026/27", category: "Mini", displayLabel: "Mini Mixto" }
      }
    });
    expect(motherCoachBootstrap.statusCode).toBe(201);

    // GET /v1/me/memberships reflects both roles
    const memberships = await app.inject({
      method: "GET",
      url: "/v1/me/memberships",
      headers: bearer(motherIbai.accessToken)
    });
    expect(memberships.statusCode).toBe(200);
    const items = memberships.json().items;
    expect(items.length).toBeGreaterThanOrEqual(2);

    const guardianRole = items.find((m: any) => m.role === "GUARDIAN" && m.team_name.includes("Indautxu Beta02"));
    const coachRole = items.find((m: any) => m.role === "COACH" && m.team_name.includes("Danok Bat Basket"));

    expect(guardianRole).toBeDefined();
    expect(coachRole).toBeDefined();
  });

  it("processes NoticePublished and DirectMessageCreated through outbox consumer", async () => {
    // Both outbox events exist in outbox_events table for this test's season
    const pendingEvents = await pool.query(
      `SELECT id, aggregate_type, event_type FROM outbox_events WHERE team_season_id = $1 AND aggregate_type IN ('TeamNotice', 'PlayerDirectMessage')`,
      [seasonId]
    );
    expect(pendingEvents.rows.length).toBeGreaterThanOrEqual(2);

    // Run outbox consumer batch until our events are processed
    let allPublished = false;
    for (let i = 0; i < 5; i++) {
      await runBatch(pool, { batchSize: 50 });
      const check = await pool.query(
        `SELECT id, published_at FROM outbox_events WHERE team_season_id = $1 AND aggregate_type IN ('TeamNotice', 'PlayerDirectMessage')`,
        [seasonId]
      );
      if (check.rows.every(r => r.published_at !== null)) {
        allPublished = true;
        break;
      }
    }
    expect(allPublished).toBe(true);

    // Verify activity inbox received the materialized items
    const inbox = await pool.query(
      `SELECT aggregate_type, event_type FROM outbox_activity_inbox WHERE team_season_id = $1 AND aggregate_type IN ('TeamNotice', 'PlayerDirectMessage')`,
      [seasonId]
    );
    expect(inbox.rows.length).toBeGreaterThanOrEqual(2);
    expect(inbox.rows.some(r => r.event_type === "NoticePublished")).toBe(true);
    expect(inbox.rows.some(r => r.event_type === "DirectMessageCreated")).toBe(true);
  });
});
