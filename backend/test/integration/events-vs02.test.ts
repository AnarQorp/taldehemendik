import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { DevelopmentAuthAdapter } from "../../src/auth/development-adapter.js";
import { ids } from "../../src/db/ids.js";
import { pool } from "../../src/db/pool.js";

const auth = new DevelopmentAuthAdapter(true);
const app = await buildApp({ authAdapter: auth });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
async function login(email: string) {
  const challenge = (await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { email } })).json();
  return (await app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { email, challengeId: challenge.challengeId, otp: challenge.developmentOtp } })).json() as { accessToken: string; user: { id: string } };
}

describe("VS02 events and agenda", () => {
  let coach: string;
  let staff: string;
  let guardian: string;
  beforeAll(async () => {
    coach = (await login("mikel@example.test")).accessToken;
    staff = (await login("staff@example.test")).accessToken;
    const guardianLogin = await login("elena@example.test");
    guardian = guardianLogin.accessToken;
    await pool.query(`INSERT INTO memberships(user_id,team_season_id,role) VALUES($1,$2,'GUARDIAN') ON CONFLICT DO NOTHING`,[guardianLogin.user.id,ids.season]);
  });
  afterAll(async () => { await app.close(); await pool.end(); });

  it("allows coach and staff to create events but rejects guardian and cross-team scope", async () => {
    const payload = { type: "TOURNAMENT", title: "Torneo API", startsAt: "2026-10-10T08:00:00.000Z", arrivalAt: "2026-10-10T07:30:00.000Z", location: "Polideportivo Municipal Indautxu", availabilityEnabled: true, availabilityDeadline: "2026-10-08T20:00:00.000Z", callupEnabled: true };
    const coachCreated = await app.inject({ method: "POST", url: `/v1/team-seasons/${ids.season}/events`, headers: bearer(coach), payload });
    expect(coachCreated.statusCode).toBe(201);
    expect(coachCreated.json()).toMatchObject({ type: "TOURNAMENT", title: "Torneo API", status: "ACTIVE", version: 1 });
    const staffCreated = await app.inject({ method: "POST", url: `/v1/team-seasons/${ids.season}/events`, headers: bearer(staff), payload: { ...payload, title: "Entrenamiento Staff", type: "TRAINING", callupEnabled: false } });
    expect(staffCreated.statusCode).toBe(201);
    const guardianCreated = await app.inject({ method: "POST", url: `/v1/team-seasons/${ids.season}/events`, headers: bearer(guardian), payload });
    expect(guardianCreated.statusCode).toBe(403);
    const crossTeam = await app.inject({ method: "POST", url: `/v1/team-seasons/${ids.otherSeason}/events`, headers: bearer(coach), payload });
    expect(crossTeam.statusCode).toBe(403);
    const agenda=await app.inject({method:"GET",url:`/v1/team-seasons/${ids.season}/events?from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z`,headers:bearer(guardian)});
    expect(agenda.statusCode).toBe(200);expect(agenda.json().items.some((e:{title:string})=>e.title==="Torneo API")).toBe(true);
    const crossRead=await app.inject({method:"GET",url:`/v1/events/${ids.otherEvent}`,headers:bearer(coach)});expect(crossRead.statusCode).toBe(403);
  });

  it("rejects availability when disabled and closes cancelled/completed events",async()=>{
    const payload={type:"MEETING",title:"Reunión",startsAt:"2026-10-12T18:00:00.000Z",availabilityEnabled:false,callupEnabled:false};
    const created=await app.inject({method:"POST",url:`/v1/team-seasons/${ids.season}/events`,headers:bearer(coach),payload});
    const eventId=created.json().id;
    const unavailable=await app.inject({method:"PUT",url:`/v1/events/${eventId}/players/${ids.ibai}/availability/staff-recorded`,headers:bearer(staff),payload:{status:"CAN_ATTEND",expectedVersion:0}});
    expect(unavailable.statusCode).toBe(409);expect(unavailable.json().error.code).toBe("AVAILABILITY_CLOSED");
    const cancelled=await app.inject({method:"POST",url:`/v1/events/${eventId}/cancel`,headers:bearer(staff)});expect(cancelled.json().status).toBe("CANCELLED");
    const editCancelled=await app.inject({method:"PATCH",url:`/v1/events/${eventId}`,headers:bearer(coach),payload:{title:"No",expectedVersion:2}});expect(editCancelled.statusCode).toBe(409);
    const second=await app.inject({method:"POST",url:`/v1/team-seasons/${ids.season}/events`,headers:bearer(staff),payload:{...payload,title:"Otra reunión"}});
    const completed=await app.inject({method:"POST",url:`/v1/events/${second.json().id}/complete`,headers:bearer(coach)});expect(completed.json().status).toBe("COMPLETED");
  });
});
