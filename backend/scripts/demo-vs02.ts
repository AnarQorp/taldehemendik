import { buildApp } from "../src/app.js";
import { DevelopmentAuthAdapter } from "../src/auth/development-adapter.js";
import { ids } from "../src/db/ids.js";
import { pool } from "../src/db/pool.js";

const auth=new DevelopmentAuthAdapter(true); const app=await buildApp({authAdapter:auth});
const evidence:Array<Record<string,unknown>>=[];
const bearer=(token:string,key?:string)=>({authorization:`Bearer ${token}`,...(key?{"idempotency-key":key}:{})});
async function expectStatus(response:Awaited<ReturnType<typeof app.inject>>,expected:number,step:string){if(response.statusCode!==expected)throw new Error(`${step}: ${response.statusCode} ${response.body}`);return response.json();}
async function login(email:string,displayName:string){const c=await expectStatus(await app.inject({method:"POST",url:"/v1/auth/otp/request",payload:{email}}),200,"OTP request");return expectStatus(await app.inject({method:"POST",url:"/v1/auth/otp/verify",payload:{email,displayName,challengeId:c.challengeId,otp:c.developmentOtp}}),200,"OTP verify");}

const coach=await login("mikel@example.test","Mikel Zubeldia");
const staff=await login("staff@example.test","Ane Staff");
const guardian=await login("elena@example.test","Elena Gómez");

// Reproduce the approved VS01 authorization precondition through public APIs.
const invitation=await expectStatus(await app.inject({method:"POST",url:`/v1/team-seasons/${ids.season}/players/${ids.ibai}/invitations`,headers:bearer(coach.accessToken)}),201,"Invitation");
const linkRequest=await expectStatus(await app.inject({method:"POST",url:`/v1/invitations/${invitation.token}/guardian-link-requests`,headers:bearer(guardian.accessToken)}),201,"Link request");
await expectStatus(await app.inject({method:"POST",url:`/v1/guardian-link-requests/${linkRequest.id}/approve`,headers:bearer(coach.accessToken)}),200,"Link approval");

const event=await expectStatus(await app.inject({method:"POST",url:`/v1/team-seasons/${ids.season}/events`,headers:bearer(coach.accessToken),payload:{type:"TOURNAMENT",title:"Torneo Indautxu · Demo VS02",startsAt:"2026-10-10T08:00:00.000Z",arrivalAt:"2026-10-10T07:30:00.000Z",location:"Polideportivo Municipal Indautxu",availabilityEnabled:true,availabilityDeadline:"2026-10-08T20:00:00.000Z",callupEnabled:true}}),201,"Event creation");
evidence.push({step:"event-created",eventId:event.id,status:event.status});

const available=[ids.ibai,ids.ane,ids.nahia,ids.irati,"30000000-0000-4000-8000-000000000005","30000000-0000-4000-8000-000000000006","30000000-0000-4000-8000-000000000007","30000000-0000-4000-8000-000000000008","30000000-0000-4000-8000-000000000009","30000000-0000-4000-8000-000000000010","30000000-0000-4000-8000-000000000012","30000000-0000-4000-8000-000000000013","30000000-0000-4000-8000-000000000014","30000000-0000-4000-8000-000000000015"];
const unavailable=["30000000-0000-4000-8000-000000000016","30000000-0000-4000-8000-000000000017"];
const unanswered=["30000000-0000-4000-8000-000000000018","30000000-0000-4000-8000-000000000019"];
for(const playerId of available) await expectStatus(await app.inject({method:"PUT",url:`/v1/events/${event.id}/players/${playerId}/availability/staff-recorded`,headers:bearer(staff.accessToken,`demo-can-${playerId}`),payload:{status:"CAN_ATTEND",expectedVersion:0}}),200,"Availability CAN");
for(const playerId of unavailable) await expectStatus(await app.inject({method:"PUT",url:`/v1/events/${event.id}/players/${playerId}/availability/staff-recorded`,headers:bearer(staff.accessToken,`demo-cannot-${playerId}`),payload:{status:"CANNOT_ATTEND",expectedVersion:0}}),200,"Availability CANNOT");
const summary=await expectStatus(await app.inject({method:"GET",url:`/v1/events/${event.id}/availability`,headers:bearer(coach.accessToken)}),200,"Availability summary");
evidence.push({step:"availability-summary",counts:summary.counts});

// 11 available (including Ibai) + 1 NO_RESPONSE leaves Ane, Nahia and Irati eligible.
const selected=[...available.filter(id=>![ids.ane,ids.nahia,ids.irati].includes(id as typeof ids.ane)),unanswered[0]];
const draft=await expectStatus(await app.inject({method:"POST",url:`/v1/events/${event.id}/callup`,headers:bearer(coach.accessToken),payload:{playerIds:selected}}),201,"Callup draft");
const warningKeys=draft.warnings.map((warning:{key:string})=>warning.key);
const published=await expectStatus(await app.inject({method:"POST",url:`/v1/callups/${draft.id}/publish`,headers:bearer(coach.accessToken,"demo-publish"),payload:{expectedVersion:1,confirmWarnings:warningKeys}}),200,"Callup publish");
evidence.push({step:"callup-published",revision:published.current_revision_number,players:published.playerIds.length,warnings:published.warnings});
const initialGuardian=await expectStatus(await app.inject({method:"GET",url:`/v1/events/${event.id}/players/${ids.ibai}/callup-status`,headers:bearer(guardian.accessToken)}),200,"Guardian callup view");
evidence.push({step:"ibai-before",called:initialGuardian.called});

await expectStatus(await app.inject({method:"PUT",url:`/v1/events/${event.id}/players/${ids.ibai}/availability`,headers:bearer(guardian.accessToken,"demo-ibai-out"),payload:{status:"CANNOT_ATTEND",expectedVersion:1}}),200,"Ibai unavailable");
const pending=await expectStatus(await app.inject({method:"GET",url:`/v1/team-seasons/${ids.season}/pending`,headers:bearer(coach.accessToken)}),200,"Pending actions");
const action=pending.actionItems.find((item:{player_id:string})=>item.player_id===ids.ibai);
const candidates=await expectStatus(await app.inject({method:"GET",url:`/v1/action-items/${action.id}/replacement-candidates`,headers:bearer(coach.accessToken)}),200,"Replacement candidates");
evidence.push({step:"called-player-unavailable",actionId:action.id,candidates:candidates.items.map((p:{first_name:string})=>p.first_name)});
const replacement=await expectStatus(await app.inject({method:"POST",url:`/v1/action-items/${action.id}/replace`,headers:bearer(coach.accessToken),payload:{substitutePlayerId:ids.ane,expectedCallupRevision:1}}),200,"Replacement");
const finalGuardian=await expectStatus(await app.inject({method:"GET",url:`/v1/events/${event.id}/players/${ids.ibai}/callup-status`,headers:bearer(guardian.accessToken)}),200,"Final guardian view");
evidence.push({step:"replacement-complete",revision:replacement.revisionNumber,removed:"Ibai",added:"Ane",actionStatus:replacement.status,ibaiCalled:finalGuardian.called});
const trace=await pool.query(`SELECT (SELECT count(*) FROM audit_events WHERE entity_id IN ($1,$2)) audit,(SELECT count(*) FROM outbox_events WHERE aggregate_id IN ($1,$2)) outbox,(SELECT count(*) FROM callup_revisions WHERE callup_id=$3) revisions`,[event.id,action.id,draft.id]);
evidence.push({step:"trace",...trace.rows[0]});

console.log(JSON.stringify({result:"PASS",evidence},null,2));
await app.close();await pool.end();
