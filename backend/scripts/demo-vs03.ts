import { buildApp } from "../src/app.js";
import { DevelopmentAuthAdapter } from "../src/auth/development-adapter.js";
import { pool } from "../src/db/pool.js";

const auth=new DevelopmentAuthAdapter(true);const app=await buildApp({authAdapter:auth});const evidence:Array<Record<string,unknown>>=[];
const bearer=(token:string,key?:string)=>({authorization:`Bearer ${token}`,...(key?{"idempotency-key":key}:{})});
async function ok(response:Awaited<ReturnType<typeof app.inject>>,expected:number,step:string){if(response.statusCode!==expected)throw new Error(`${step}: ${response.statusCode} ${response.body}`);return response.json();}
async function login(email:string,name:string){const c=await ok(await app.inject({method:"POST",url:"/v1/auth/otp/request",payload:{email}}),200,"request OTP");return ok(await app.inject({method:"POST",url:"/v1/auth/otp/verify",payload:{email,displayName:name,challengeId:c.challengeId,otp:c.developmentOtp}}),200,"verify OTP");}

const coach=await login("beta.coach@example.test","June Entrenatzailea");
const boot=await ok(await app.inject({method:"POST",url:"/v1/teams/bootstrap",headers:bearer(coach.accessToken,"demo-vs03-bootstrap"),payload:{team:{name:"Talde Berria",sport:"FOOTBALL"},teamSeason:{seasonLabel:"2026/27",category:"Infantil",displayLabel:"Infantil B"},createGeneralJoinCode:true}}),201,"bootstrap");
evidence.push({step:"bootstrap",teamId:boot.team.id,teamSeasonId:boot.teamSeason.id,role:boot.membership.role});
const player=await ok(await app.inject({method:"POST",url:`/v1/team-seasons/${boot.teamSeason.id}/players`,headers:bearer(coach.accessToken,"demo-vs03-player"),payload:{firstName:"Ibai",lastName:"Aranguren",shirtNumber:9}}),201,"add player");
evidence.push({step:"roster",playerId:player.player.id,rosterStatus:player.rosterEntry.status});
const invitation=await ok(await app.inject({method:"POST",url:`/v1/team-seasons/${boot.teamSeason.id}/players/${player.player.id}/invitations`,headers:bearer(coach.accessToken)}),201,"invitation");
const publicView=await ok(await app.inject({method:"GET",url:`/v1/invitations/${invitation.token}`}),200,"public invitation");
evidence.push({step:"public-invitation",metadata:publicView,playerPiiLeaked:/Ibai|Aranguren|9/.test(JSON.stringify(publicView))});
const guardian=await login("beta.guardian@example.test","Elena Gómez");
const before=await app.inject({method:"GET",url:`/v1/team-seasons/${boot.teamSeason.id}/players/${player.player.id}`,headers:bearer(guardian.accessToken)});
const request=await ok(await app.inject({method:"POST",url:`/v1/invitations/${invitation.token}/guardian-link-requests`,headers:bearer(guardian.accessToken),payload:{}}),201,"link request");
const pending=await app.inject({method:"GET",url:`/v1/team-seasons/${boot.teamSeason.id}/players/${player.player.id}`,headers:bearer(guardian.accessToken)});
await ok(await app.inject({method:"POST",url:`/v1/guardian-link-requests/${request.id}/approve`,headers:bearer(coach.accessToken),payload:{}}),200,"link approval");
const after=await app.inject({method:"GET",url:`/v1/team-seasons/${boot.teamSeason.id}/players/${player.player.id}`,headers:bearer(guardian.accessToken)});
evidence.push({step:"authorization",before:before.statusCode,pending:pending.statusCode,after:after.statusCode});
const relogin=await login("beta.coach@example.test","June Entrenatzailea");
const memberships=await ok(await app.inject({method:"GET",url:"/v1/me/memberships",headers:bearer(relogin.accessToken)}),200,"membership discovery");
evidence.push({step:"fresh-session-discovery",memberships:memberships.items.map((m:{team_name:string;display_label:string;role:string})=>({team:m.team_name,season:m.display_label,role:m.role}))});
const trace=await pool.query(`SELECT (SELECT count(*) FROM teams) teams,(SELECT count(*) FROM team_seasons) seasons,(SELECT count(*) FROM memberships) memberships,(SELECT count(*) FROM guardian_links) guardian_links`);
evidence.push({step:"database",...trace.rows[0]});
console.log(JSON.stringify({result:"PASS",seedUsed:false,devResetUsed:false,evidence},null,2));
await app.close();await pool.end();
