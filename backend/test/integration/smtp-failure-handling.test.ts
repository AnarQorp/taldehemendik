import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { DevelopmentAuthAdapter } from "../../src/auth/development-adapter.js";
import { authPool, pool, rawPool } from "../../src/db/pool.js";
import type { MailDelivery } from "../../src/notifications/delivery.js";
import { NotificationService } from "../../src/notifications/service.js";

afterAll(async () => {
  await Promise.allSettled([authPool.end(), pool.end(), rawPool.end()]);
});

describe("SMTP Failure Handling & Resilience (naQor Verification)", () => {
  it("guarantees notice and direct message persistence and HTTP 201 when SMTP transport fails completely", async () => {
    // 1. Failing Mail Delivery (simulating SMTP down, connection refused, or DNS timeout)
    const failingDelivery: MailDelivery = {
      sendMail: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:2525"))
    };

    const app = await buildApp({
      authAdapter: new DevelopmentAuthAdapter(true),
      notificationDelivery: failingDelivery
    });

    try {
      const runId = randomUUID().slice(0, 8);
      const coachEmail = `coach-fail-${runId}@example.test`;
      const guardianEmail = `guardian-fail-${runId}@example.test`;

      // Helper to login dev user
      async function login(email: string, displayName: string) {
        const req = await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { email } });
        const c = req.json();
        const ver = await app.inject({
          method: "POST",
          url: "/v1/auth/otp/verify",
          payload: { email, challengeId: c.challengeId, otp: c.developmentOtp, displayName }
        });
        return { token: ver.json().accessToken, userId: ver.json().user.id };
      }

      const coach = await login(coachEmail, "Mister Prueba");
      const guardian = await login(guardianEmail, "Amaia Tutora");

      // Bootstrap team
      const bootRes = await app.inject({
        method: "POST",
        url: "/v1/teams/bootstrap",
        headers: { authorization: `Bearer ${coach.token}`, "idempotency-key": `boot-${runId}` },
        payload: {
          team: { name: `Club SMTP Resiliente ${runId}`, sport: "FOOTBALL" },
          teamSeason: { seasonLabel: "2026/27", category: "Infantil", displayLabel: "Infantil Resiliente" },
          createGeneralJoinCode: true
        }
      });
      expect(bootRes.statusCode).toBe(201);
      const teamSeasonId = bootRes.json().teamSeason.id;
      const joinCode = bootRes.json().joinCode;

      // Add player
      const pRes = await app.inject({
        method: "POST",
        url: `/v1/team-seasons/${teamSeasonId}/players`,
        headers: { authorization: `Bearer ${coach.token}`, "idempotency-key": `p-${runId}` },
        payload: { firstName: "Aitor", lastName: "Gomez", shortName: "Aitor", shirtNumber: 9, position: "DELANTERO" }
      });
      expect(pRes.statusCode).toBe(201);
      const playerId = pRes.json().player.id;

      // Link guardian
      const reqRes = await app.inject({
        method: "POST",
        url: `/v1/team-join/${joinCode}/guardian-link-requests`,
        headers: { authorization: `Bearer ${guardian.token}` },
        payload: { claimedPlayerName: "Aitor Gomez", relationship: "Madre", contactPhone: "+34 611 222 333" }
      });
      const requestId = reqRes.json().id;
      await app.inject({
        method: "POST",
        url: `/v1/guardian-link-requests/${requestId}/approve`,
        headers: { authorization: `Bearer ${coach.token}` },
        payload: { playerId }
      });

      // Spy on console.error to ensure errors are captured and do NOT leak minor PII
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // 2. Publish Notice with broken SMTP
      const noticeRes = await app.inject({
        method: "POST",
        url: `/v1/team-seasons/${teamSeasonId}/notices`,
        headers: { authorization: `Bearer ${coach.token}` },
        payload: {
          title: "Aviso en fallo SMTP",
          body: "El aviso se publica aunque el servidor SMTP esté caído.",
          category: "GENERAL",
          urgent: true
        }
      });

      // Observable Evidence: HTTP 201 must be returned to client!
      expect(noticeRes.statusCode).toBe(201);
      const noticeId = noticeRes.json().id;

      // Observable Evidence: Notice exists in Postgres database!
      const noticeInDb = await pool.query(`SELECT id, title, urgent FROM team_notices WHERE id = $1`, [noticeId]);
      expect(noticeInDb.rows).toHaveLength(1);
      expect(noticeInDb.rows[0].title).toBe("Aviso en fallo SMTP");

      // Observable Evidence: Outbox event was persisted for reliable recovery/re-delivery!
      const outboxNotice = await pool.query(
        `SELECT id, aggregate_id, event_type FROM outbox_events WHERE aggregate_id = $1`,
        [noticeId]
      );
      expect(outboxNotice.rows).toHaveLength(1);
      expect(outboxNotice.rows[0].event_type).toBe("NoticePublished");

      // 3. Send Player Direct Message with broken SMTP
      const msgRes = await app.inject({
        method: "POST",
        url: `/v1/team-seasons/${teamSeasonId}/players/${playerId}/messages`,
        headers: { authorization: `Bearer ${coach.token}` },
        payload: {
          message: "Mensaje privado confidencial: traer bota de recambio."
        }
      });

      // Observable Evidence: HTTP 201 returned to client!
      expect(msgRes.statusCode).toBe(201);
      const messageId = msgRes.json().id;

      // Observable Evidence: Direct message exists in Postgres database!
      const msgInDb = await pool.query(`SELECT id, message FROM player_direct_messages WHERE id = $1`, [messageId]);
      expect(msgInDb.rows).toHaveLength(1);
      expect(msgInDb.rows[0].message).toBe("Mensaje privado confidencial: traer bota de recambio.");

      // Observable Evidence: Outbox event was persisted!
      const outboxMsg = await pool.query(
        `SELECT id, aggregate_id, event_type FROM outbox_events WHERE aggregate_id = $1`,
        [messageId]
      );
      expect(outboxMsg.rows).toHaveLength(1);
      expect(outboxMsg.rows[0].event_type).toBe("DirectMessageCreated");

      // 4. Observable Evidence: console.error was called, but NEVER leaked minor PII
      expect(consoleErrorSpy).toHaveBeenCalled();
      for (const call of consoleErrorSpy.mock.calls) {
        const fullMessage = call.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
        expect(fullMessage).not.toContain("Aitor Gomez");
        expect(fullMessage).not.toContain("traer bota de recambio");
      }

      consoleErrorSpy.mockRestore();
    } finally {
      await app.close();
    }
  });

  it("handles partial SMTP failures across multiple recipients without interrupting delivery to other recipients", async () => {
    const deliveredRecipients: string[] = [];
    const failedRecipients: string[] = [];

    const partialDelivery: MailDelivery = {
      sendMail: vi.fn().mockImplementation(async (msg: { to: string; subject: string }) => {
        if (msg.to.includes("failing-guardian")) {
          failedRecipients.push(msg.to);
          throw new Error("550 5.1.1 User unknown: " + msg.to);
        }
        deliveredRecipients.push(msg.to);
        return { messageId: "mock-ok" };
      })
    };

    const service = new NotificationService(rawPool, partialDelivery);
    const runId = randomUUID().slice(0, 8);

    // Create a team with two active members
    const teamRes = await rawPool.query(
      `INSERT INTO teams(name, sport, created_by_user_id)
       VALUES('Team Partial ${runId}', 'FOOTBALL', (SELECT id FROM users LIMIT 1))
       RETURNING id`
    );
    const teamId = teamRes.rows[0].id;

    const seasonRes = await rawPool.query(
      `INSERT INTO team_seasons(team_id, season_label, category, display_label, status, created_by_user_id)
       VALUES($1, '2026/27', 'Infantil', 'Infantil Partial', 'ACTIVE', (SELECT id FROM users LIMIT 1))
       RETURNING id`,
      [teamId]
    );
    const teamSeasonId = seasonRes.rows[0].id;

    // Create user 1 (will succeed)
    const u1 = await rawPool.query(
      `INSERT INTO users(auth_subject, email, display_name) VALUES($1, $2, 'Good Guardian') RETURNING id`,
      [`sub-good-${runId}`, `good-guardian-${runId}@example.test`]
    );
    await rawPool.query(
      `INSERT INTO memberships(user_id, team_season_id, role, status) VALUES($1, $2, 'GUARDIAN', 'ACTIVE')`,
      [u1.rows[0].id, teamSeasonId]
    );

    // Create user 2 (will fail)
    const u2 = await rawPool.query(
      `INSERT INTO users(auth_subject, email, display_name) VALUES($1, $2, 'Bad Guardian') RETURNING id`,
      [`sub-bad-${runId}`, `failing-guardian-${runId}@example.test`]
    );
    await rawPool.query(
      `INSERT INTO memberships(user_id, team_season_id, role, status) VALUES($1, $2, 'GUARDIAN', 'ACTIVE')`,
      [u2.rows[0].id, teamSeasonId]
    );

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Dispatch notice
    const count = await service.notifyTeamNotice(teamSeasonId, randomUUID(), "Aviso parcial", false);

    // Exactly 1 succeeded, 1 failed, and service returned 1 without crashing
    expect(count).toBe(1);
    expect(deliveredRecipients).toHaveLength(1);
    expect(deliveredRecipients[0]).toBe(`good-guardian-${runId}@example.test`);
    expect(failedRecipients).toHaveLength(1);
    expect(failedRecipients[0]).toBe(`failing-guardian-${runId}@example.test`);

    consoleErrorSpy.mockRestore();
  });
});
