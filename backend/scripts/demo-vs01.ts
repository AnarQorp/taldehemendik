import { buildApp } from "../src/app.js";
import { DevelopmentAuthAdapter } from "../src/auth/development-adapter.js";
import { ids } from "../src/db/ids.js";
import { rawPool as pool } from "../src/db/pool.js";

const auth = new DevelopmentAuthAdapter(true);
const app = await buildApp({ authAdapter: auth });
const evidence: Array<Record<string, unknown>> = [];

async function login(email: string, displayName: string) {
  const challenge = (await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { email } })).json();
  const verified = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { email, displayName, challengeId: challenge.challengeId, otp: challenge.developmentOtp } });
  return verified.json().accessToken as string;
}
const headers = (token: string, key?: string) => ({ authorization: `Bearer ${token}`, ...(key ? { "idempotency-key": key } : {}) });

const coach = await login("mikel@example.test", "Mikel Zubeldia");
const invitation = await app.inject({ method: "POST", url: `/v1/team-seasons/${ids.season}/players/${ids.ibai}/invitations`, headers: headers(coach) });
const invitationBody = invitation.json();
const publicView = await app.inject({ method: "GET", url: `/v1/invitations/${invitationBody.token}` });
evidence.push({ step: "public invitation", status: publicView.statusCode, body: publicView.json(), playerPiiLeaked: /Ibai|Aranguren/.test(publicView.body) });

const guardian = await login("elena@example.test", "Elena Gómez");
const before = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.season}/players/${ids.ibai}`, headers: headers(guardian) });
evidence.push({ step: "auth is not authorization", status: before.statusCode, error: before.json().error.code });
const linkRequest = await app.inject({ method: "POST", url: `/v1/invitations/${invitationBody.token}/guardian-link-requests`, headers: headers(guardian) });
const requestId = linkRequest.json().id;
const pending = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.season}/players/${ids.ibai}`, headers: headers(guardian) });
evidence.push({ step: "pending is not authorization", status: pending.statusCode, error: pending.json().error.code });
const approval = await app.inject({ method: "POST", url: `/v1/guardian-link-requests/${requestId}/approve`, headers: headers(coach) });
evidence.push({ step: "coach approval", status: approval.statusCode, receipt: approval.json() });
const player = await app.inject({ method: "GET", url: `/v1/team-seasons/${ids.season}/players/${ids.ibai}`, headers: headers(guardian) });
evidence.push({ step: "authorized player", status: player.statusCode, player: player.json() });
const availability = await app.inject({ method: "PUT", url: `/v1/events/${ids.event}/players/${ids.ibai}/availability`, headers: headers(guardian, "demo-availability"), payload: { status: "CAN_ATTEND", expectedVersion: 0 } });
evidence.push({ step: "guardian availability", status: availability.statusCode, current: availability.json() });
const coachView = await app.inject({ method: "GET", url: `/v1/events/${ids.event}/availability`, headers: headers(coach) });
evidence.push({ step: "coach reads availability", status: coachView.statusCode, body: coachView.json() });
const counts = await pool.query(`SELECT (SELECT count(*) FROM outbox_events) outbox,(SELECT count(*) FROM audit_events) audit`);
evidence.push({ step: "transactional evidence", ...counts.rows[0] });

console.log(JSON.stringify({ result: "PASS", evidence }, null, 2));
await app.close();
await pool.end();
