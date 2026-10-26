import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import tls, { type TLSSocket } from "node:tls";
import type { AddressInfo } from "node:net";
import nodemailer, { type Transporter } from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProductionAuthAdapter } from "../../src/auth/production.js";
import { buildApp } from "../../src/app.js";
import { authPool, pool, rawPool } from "../../src/db/pool.js";

interface CapturedEmail {
  recipient: string;
  raw: string;
  encrypted: boolean;
}

let temporaryDirectory: string;
let server: tls.Server;
let transport: Transporter;
let port: number;
const sockets = new Set<TLSSocket>();
const capturedEmails: CapturedEmail[] = [];

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "talde-smtp-notif-"));
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout", join(temporaryDirectory, "key.pem"),
      "-out", join(temporaryDirectory, "cert.pem")
    ],
    { stdio: "ignore", timeout: 15000 }
  );

  const key = await readFile(join(temporaryDirectory, "key.pem"));
  const cert = await readFile(join(temporaryDirectory, "cert.pem"));

  server = tls.createServer({ key, cert, minVersion: "TLSv1.2" }, (socket) => {
    sockets.add(socket);
    socket.setTimeout(10000, () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});

    let pending = "";
    let inData = false;
    let recipient = "";
    let bodyLines: string[] = [];

    socket.setEncoding("utf8");
    socket.write("220 localhost Talde SMTP notification test ready\r\n");

    socket.on("data", (chunk) => {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\r\n")) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);

        if (inData) {
          if (line === ".") {
            capturedEmails.push({
              recipient,
              raw: bodyLines.join("\r\n"),
              encrypted: socket.encrypted
            });
            bodyLines = [];
            inData = false;
            socket.write("250 2.0.0 Notification message accepted\r\n");
          } else {
            bodyLines.push(line.startsWith("..") ? line.slice(1) : line);
          }
        } else if (/^EHLO\b|^HELO\b/i.test(line)) {
          socket.write("250-localhost\r\n250 SIZE 1000000\r\n");
        } else if (/^MAIL FROM:/i.test(line)) {
          socket.write("250 2.1.0 Sender accepted\r\n");
        } else if (/^RCPT TO:/i.test(line)) {
          recipient = line.slice(8).trim().replace(/^<|>$/g, "").toLowerCase();
          socket.write("250 2.1.5 Recipient accepted\r\n");
        } else if (/^DATA$/i.test(line)) {
          inData = true;
          socket.write("354 End with a dot\r\n");
        } else if (/^QUIT$/i.test(line)) {
          socket.end("221 2.0.0 Bye\r\n");
        } else if (/^RSET$|^NOOP$/i.test(line)) {
          socket.write("250 OK\r\n");
        } else {
          socket.write("502 Command not implemented\r\n");
        }
      }
    });
  });

  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  port = (server.address() as AddressInfo).port;
  transport = nodemailer.createTransport({
    host: "127.0.0.1",
    port,
    secure: true,
    requireTLS: true,
    tls: { ca: cert, servername: "localhost", rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000
  });
}, 20000);

afterAll(async () => {
  transport?.close();
  for (const socket of sockets) socket.destroy();
  if (server?.listening) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
  await Promise.allSettled([authPool.end(), pool.end(), rawPool.end()]);
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("Beta 0.2 Autonomous Registration & Real SMTP Notifications", () => {
  const secret = "smtp-notif-secret-key-32chars-min-length-ok";

  it("verifies autonomous OTP onboarding for brand new emails without allowlist, fail-closed isolation, and real SMTP notification delivery", async () => {
    const adapter = new ProductionAuthAdapter({
      delivery: transport,
      secret,
      from: "avisos@taldehemendik.test"
    });

    const app = await buildApp({
      authAdapter: adapter,
      notificationDelivery: transport
    });

    try {
      const runId = randomUUID().slice(0, 8);

      // --- 1. Helper to autonomously register a completely new email via SMTPS OTP ---
      async function registerAutonomousUser(email: string, displayName: string): Promise<{ token: string; userId: string }> {
        const reqRes = await app.inject({
          method: "POST",
          url: "/v1/auth/otp/request",
          payload: { email }
        });
        expect(reqRes.statusCode).toBe(200);
        const { challengeId } = reqRes.json();

        // Email arrived on SMTPS sink
        const emailMsg = capturedEmails.find((m) => m.recipient === email.toLowerCase());
        expect(emailMsg).toBeDefined();
        expect(emailMsg!.encrypted).toBe(true);

        const otp = emailMsg!.raw.match(/\b\d{6}\b/)?.[0];
        expect(otp).toBeDefined();

        const verRes = await app.inject({
          method: "POST",
          url: "/v1/auth/otp/verify",
          payload: { email, challengeId, otp, displayName }
        });
        expect(verRes.statusCode).toBe(200);
        const data = verRes.json();
        return { token: data.accessToken, userId: data.user.id };
      }

      // --- 2. Coach registers autonomously and bootstraps Team ---
      const coachEmail = `coach-smtp-${runId}@example.test`;
      const coach = await registerAutonomousUser(coachEmail, "Entrenador Iker");

      const bootstrapRes = await app.inject({
        method: "POST",
        url: "/v1/teams/bootstrap",
        headers: {
          authorization: `Bearer ${coach.token}`,
          "idempotency-key": `bootstrap-${runId}`
        },
        payload: {
          team: { name: `Club SMTPS ${runId}`, sport: "FOOTBALL" },
          teamSeason: { seasonLabel: "2026/27", category: "Infantil", displayLabel: "Infantil Gorria" },
          createGeneralJoinCode: true
        }
      });
      expect(bootstrapRes.statusCode).toBe(201);
      const teamSeasonId = bootstrapRes.json().teamSeason.id;
      const teamJoinCode = bootstrapRes.json().joinCode;
      expect(teamJoinCode).toBeDefined();

      // Add two players
      const p1Res = await app.inject({
        method: "POST",
        url: `/v1/team-seasons/${teamSeasonId}/players`,
        headers: {
          authorization: `Bearer ${coach.token}`,
          "idempotency-key": `player1-${runId}`
        },
        payload: { firstName: "Mikel", lastName: "Arrieta", shortName: "Mikel", shirtNumber: 7, position: "CENTROCAMPISTA" }
      });
      expect(p1Res.statusCode).toBe(201);
      const player1Id = p1Res.json().player.id;

      const p2Res = await app.inject({
        method: "POST",
        url: `/v1/team-seasons/${teamSeasonId}/players`,
        headers: {
          authorization: `Bearer ${coach.token}`,
          "idempotency-key": `player2-${runId}`
        },
        payload: { firstName: "Jon", lastName: "Etxebarria", shortName: "Jon", shirtNumber: 10, position: "DELANTERO" }
      });
      expect(p2Res.statusCode).toBe(201);
      const player2Id = p2Res.json().player.id;

      // --- 3. Check 1: Autonomous Registration & Fail-Closed Isolation ---
      // Family 1 (Ama) uses arbitrary brand new email NEVER seen before
      const motherEmail = `ama-smtp-${runId}@example.test`;
      const mother = await registerAutonomousUser(motherEmail, "Nekane Ama");

      // FAIL-CLOSED CHECK: Authenticated with OTP, but has NO membership yet.
      // Accessing team players or notices MUST be strictly denied (403)!
      const unauthPlayers = await app.inject({
        method: "GET",
        url: `/v1/team-seasons/${teamSeasonId}/players`,
        headers: { authorization: `Bearer ${mother.token}` }
      });
      expect(unauthPlayers.statusCode).toBe(403);

      const unauthNotices = await app.inject({
        method: "GET",
        url: `/v1/team-seasons/${teamSeasonId}/notices`,
        headers: { authorization: `Bearer ${mother.token}` }
      });
      expect(unauthNotices.statusCode).toBe(403);

      // Onboarding Journey A: Team Join Code
      const codeInfo = await app.inject({
        method: "GET",
        url: `/v1/team-join/${teamJoinCode}`
      });
      expect(codeInfo.statusCode).toBe(200);

      const joinReqRes = await app.inject({
        method: "POST",
        url: `/v1/team-join/${teamJoinCode}/guardian-link-requests`,
        headers: { authorization: `Bearer ${mother.token}` },
        payload: {
          claimedPlayerName: "Mikel Arrieta",
          relationship: "Madre",
          contactPhone: "+34 600 111 222"
        }
      });
      expect(joinReqRes.statusCode).toBe(201);
      const requestId = joinReqRes.json().id;

      // Coach approves request
      const approveRes = await app.inject({
        method: "POST",
        url: `/v1/guardian-link-requests/${requestId}/approve`,
        headers: { authorization: `Bearer ${coach.token}` },
        payload: { playerId: player1Id }
      });
      expect(approveRes.statusCode).toBe(200);

      // Onboarding Journey B: Player Invitation Token
      // Family 2 (Aita) registers with brand new email via direct player invitation token
      const inviteTokenRes = await app.inject({
        method: "POST",
        url: `/v1/team-seasons/${teamSeasonId}/players/${player2Id}/invitations`,
        headers: { authorization: `Bearer ${coach.token}` }
      });
      expect(inviteTokenRes.statusCode).toBe(201);
      const { token: inviteToken } = inviteTokenRes.json();

      const fatherEmail = `aita-smtp-${runId}@example.test`;
      const father = await registerAutonomousUser(fatherEmail, "Gorka Aita");

      // Father inspects token and requests guardian link
      const inspectRes = await app.inject({
        method: "GET",
        url: `/v1/invitations/${inviteToken}`
      });
      expect(inspectRes.statusCode).toBe(200);

      const fatherReqRes = await app.inject({
        method: "POST",
        url: `/v1/invitations/${inviteToken}/guardian-link-requests`,
        headers: { authorization: `Bearer ${father.token}` },
        payload: {
          relationship: "Padre",
          contactPhone: "+34 600 333 444"
        }
      });
      expect(fatherReqRes.statusCode).toBe(201);
      const fatherRequestId = fatherReqRes.json().id;

      // Coach approves father's request
      const approveFatherRes = await app.inject({
        method: "POST",
        url: `/v1/guardian-link-requests/${fatherRequestId}/approve`,
        headers: { authorization: `Bearer ${coach.token}` },
        payload: {}
      });
      expect(approveFatherRes.statusCode).toBe(200);

      // Verify Coach Player Dossier displays guardian contact info & relationship
      const dossierRes = await app.inject({
        method: "GET",
        url: `/v1/team-seasons/${teamSeasonId}/players/${player1Id}`,
        headers: { authorization: `Bearer ${coach.token}` }
      });
      expect(dossierRes.statusCode).toBe(200);
      const dossier = dossierRes.json();
      expect(dossier.guardians.length).toBe(1);
      expect(dossier.guardians[0].relationship).toBe("Madre");
      expect(dossier.guardians[0].phone).toBe("+34 600 111 222");

      // --- 4. Check 2: Real SMTP Notifications ---
      // Clear capturedEmails before triggering notification tests
      capturedEmails.length = 0;

      // A) Broadcast Team Notice: Coach publishes urgent team notice
      const noticeRes = await app.inject({
        method: "POST",
        url: `/v1/team-seasons/${teamSeasonId}/notices`,
        headers: { authorization: `Bearer ${coach.token}` },
        payload: {
          category: "SCHEDULE_CHANGE",
          title: "Cambio de hora: entrenamiento de mañana a las 18:00",
          body: "Por motivo de las obras en el polideportivo principal, el entrenamiento se adelanta a las 18:00.",
          urgent: true
        }
      });
      expect(noticeRes.statusCode).toBe(201);

      // Verify that BOTH active guardians received the notice notification email over TLS SMTPS
      const motherNoticeEmail = capturedEmails.find((m) => m.recipient === motherEmail.toLowerCase());
      const fatherNoticeEmail = capturedEmails.find((m) => m.recipient === fatherEmail.toLowerCase());

      expect(motherNoticeEmail).toBeDefined();
      expect(motherNoticeEmail!.encrypted).toBe(true);
      // RFC 2047 encodes '[' as '=5B' and ']' as '=5D' in MIME subject headers
      expect(motherNoticeEmail!.raw).toMatch(/(=5BURGENTE=5D|\[URGENTE\])/);
      expect(motherNoticeEmail!.raw).toContain("Cambio de hora: entrenamiento");

      expect(fatherNoticeEmail).toBeDefined();
      expect(fatherNoticeEmail!.encrypted).toBe(true);
      expect(fatherNoticeEmail!.raw).toMatch(/(=5BURGENTE=5D|\[URGENTE\])/);

      // Privacy Check: Team notice email contains NO minor medical or sensitive private child data
      expect(motherNoticeEmail!.raw).not.toContain("Mikel Arrieta");
      expect(motherNoticeEmail!.raw).not.toContain("Jon Etxebarria");

      // B) Player Direct Message: Coach sends private message strictly for Player 1 (Mikel)
      capturedEmails.length = 0;

      const directMsgRes = await app.inject({
        method: "POST",
        url: `/v1/team-seasons/${teamSeasonId}/players/${player1Id}/messages`,
        headers: { authorization: `Bearer ${coach.token}` },
        payload: {
          message: "Recordad traer la autorización firmada del torneo de Gipuzkoa antes del viernes."
        }
      });
      expect(directMsgRes.statusCode).toBe(201);

      // Verification: ONLY Mother (guardian of Player 1) receives the direct notification email
      const motherDirectEmail = capturedEmails.find((m) => m.recipient === motherEmail.toLowerCase());
      const fatherDirectEmail = capturedEmails.find((m) => m.recipient === fatherEmail.toLowerCase());

      expect(motherDirectEmail).toBeDefined();
      expect(motherDirectEmail!.encrypted).toBe(true);
      expect(motherDirectEmail!.raw).toContain("registrado una nueva comunicaci");
      // Privacy Check: unencrypted message body and child name are NOT leaked into SMTP transport
      expect(motherDirectEmail!.raw).not.toContain("autorización firmada del torneo de Gipuzkoa");
      expect(motherDirectEmail!.raw).not.toContain("Mikel Arrieta");

      // STRICT ISOLATION: Father of Player 2 receives ZERO emails for Player 1's direct message
      expect(fatherDirectEmail).toBeUndefined();

      // Mother can log in and read the direct message confidentially in-app
      const readDirectRes = await app.inject({
        method: "GET",
        url: `/v1/team-seasons/${teamSeasonId}/players/${player1Id}/messages`,
        headers: { authorization: `Bearer ${mother.token}` }
      });
      expect(readDirectRes.statusCode).toBe(200);
      const messages = readDirectRes.json().items;
      expect(messages.length).toBe(1);
      expect(messages[0].message).toBe("Recordad traer la autorización firmada del torneo de Gipuzkoa antes del viernes.");
      expect(messages[0].author_name).toBe("Entrenador Iker");

      // Father of Player 2 is FORBIDDEN from reading Player 1's direct messages (403)
      const fatherLeakAttempt = await app.inject({
        method: "GET",
        url: `/v1/team-seasons/${teamSeasonId}/players/${player1Id}/messages`,
        headers: { authorization: `Bearer ${father.token}` }
      });
      expect(fatherLeakAttempt.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  }, 35000);
});
