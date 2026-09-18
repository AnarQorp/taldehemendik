import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { DevelopmentAuthAdapter } from "../../src/auth/development-adapter.js";
import { pool } from "../../src/db/pool.js";

const auth=new DevelopmentAuthAdapter(true);
const app=await buildApp({authAdapter:auth});
async function login(email:string,displayName:string){const requested=await app.inject({method:"POST",url:"/v1/auth/otp/request",payload:{email}});expect(requested.statusCode,requested.body).toBe(200);const c=requested.json();const verified=await app.inject({method:"POST",url:"/v1/auth/otp/verify",payload:{email,displayName,challengeId:c.challengeId,otp:c.developmentOtp}});expect(verified.statusCode,verified.body).toBe(200);return verified.json() as {accessToken:string,user:{id:string}};}
const bearer=(token:string,key?:string)=>({authorization:`Bearer ${token}`,...(key?{"idempotency-key":key}:{})});

describe("VS03 clean BETA bootstrap",()=>{
  let coach:{accessToken:string;user:{id:string}};
  let teamId:string;
  let seasonId:string;
  let joinCode:string;
  let playerId:string;
  let tutor:{accessToken:string;user:{id:string}};
  afterAll(async()=>{await app.close();await pool.end();});
  it("creates Team, TeamSeason and ACTIVE COACH membership atomically",async()=>{
    coach=await login("new-coach@example.test","June Entrenatzailea");
    const response=await app.inject({method:"POST",url:"/v1/teams/bootstrap",headers:bearer(coach.accessToken,"bootstrap-june-1"),payload:{team:{name:"Talde Berria",sport:"FOOTBALL"},teamSeason:{seasonLabel:"2026/27",category:"Infantil",displayLabel:"Infantil B"},createGeneralJoinCode:true}});
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({team:{name:"Talde Berria",sport:"FOOTBALL"},teamSeason:{season_label:"2026/27",category:"Infantil",display_label:"Infantil B"},membership:{role:"COACH",status:"ACTIVE"},idempotentReplay:false});
    teamId=response.json().team.id;seasonId=response.json().teamSeason.id;joinCode=response.json().joinCode;
    expect(joinCode).toMatch(/^[A-F0-9]{8}$/);
    const replay=await app.inject({method:"POST",url:"/v1/teams/bootstrap",headers:bearer(coach.accessToken,"bootstrap-june-1"),payload:{team:{name:"Talde Berria",sport:"FOOTBALL"},teamSeason:{seasonLabel:"2026/27",category:"Infantil",displayLabel:"Infantil B"},createGeneralJoinCode:true}});
    expect(replay.statusCode).toBe(200);expect(replay.json()).toMatchObject({idempotentReplay:true,joinCode});
    const counts=await pool.query(`SELECT (SELECT count(*) FROM teams) teams,(SELECT count(*) FROM team_seasons) seasons,(SELECT count(*) FROM memberships WHERE role='COACH') coaches`);
    expect(counts.rows[0]).toEqual({teams:"1",seasons:"1",coaches:"1"});
  });

  it("recovers memberships after a fresh login without known IDs",async()=>{
    const relogin=await login("new-coach@example.test","June Entrenatzailea");
    const memberships=await app.inject({method:"GET",url:"/v1/me/memberships",headers:bearer(relogin.accessToken)});
    expect(memberships.statusCode).toBe(200);
    expect(memberships.json().items).toEqual([expect.objectContaining({role:"COACH",status:"ACTIVE",team_id:teamId,team_season_id:seasonId,team_name:"Talde Berria",season_label:"2026/27"})]);
  });

  it("rolls bootstrap back completely on a database failure",async()=>{
    const other=await login("rollback-coach@example.test","Rollback Coach");
    await pool.query(`CREATE FUNCTION fail_bootstrap_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${other.user.id}'::uuid THEN RAISE EXCEPTION 'forced bootstrap failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER test_fail_bootstrap BEFORE INSERT ON memberships FOR EACH ROW EXECUTE FUNCTION fail_bootstrap_membership()`);
    const failed=await app.inject({method:"POST",url:"/v1/teams/bootstrap",headers:bearer(other.accessToken,"bootstrap-rollback"),payload:{team:{name:"Should Roll Back",sport:"FOOTBALL"},teamSeason:{seasonLabel:"2026/27",category:"Cadete",displayLabel:"Cadete A"}}});
    expect(failed.statusCode).toBe(500);
    await pool.query(`DROP TRIGGER test_fail_bootstrap ON memberships; DROP FUNCTION fail_bootstrap_membership()`);
    const state=await pool.query(`SELECT (SELECT count(*) FROM teams WHERE name='Should Roll Back') teams,(SELECT count(*) FROM team_seasons WHERE created_by_user_id=$1) seasons,(SELECT count(*) FROM memberships WHERE user_id=$1) memberships`,[other.user.id]);
    expect(state.rows[0]).toEqual({teams:"0",seasons:"0",memberships:"0"});
  });

  it("adds Player and RosterEntry idempotently without birth date",async()=>{
    const payload={firstName:"Ibai",lastName:"Aranguren",shortName:"Ibai",shirtNumber:9,position:"DELANTERO"};
    const created=await app.inject({method:"POST",url:`/v1/team-seasons/${seasonId}/players`,headers:bearer(coach.accessToken,"player-ibai-1"),payload});
    expect(created.statusCode).toBe(201);playerId=created.json().player.id;
    expect(created.json()).toMatchObject({player:{first_name:"Ibai",last_name:"Aranguren"},rosterEntry:{shirt_number:9,status:"ACTIVE"},idempotentReplay:false});
    expect(created.body).not.toContain("birth");
    const replay=await app.inject({method:"POST",url:`/v1/team-seasons/${seasonId}/players`,headers:bearer(coach.accessToken,"player-ibai-1"),payload});
    expect(replay.statusCode).toBe(200);expect(replay.json()).toMatchObject({idempotentReplay:true,player:{id:playerId}});
    const count=await pool.query(`SELECT count(*) count FROM roster_entries WHERE team_season_id=$1`,[seasonId]);expect(count.rows[0].count).toBe("1");
  });

  it("keeps individual invitation private until coach approval",async()=>{
    const invitation=await app.inject({method:"POST",url:`/v1/team-seasons/${seasonId}/players/${playerId}/invitations`,headers:bearer(coach.accessToken)});
    expect(invitation.statusCode).toBe(201);
    const stored=await pool.query(`SELECT token_hash FROM invitations WHERE id=$1`,[invitation.json().id]);expect(stored.rows[0].token_hash).not.toBe(invitation.json().token);
    const publicView=await app.inject({method:"GET",url:`/v1/invitations/${invitation.json().token}`});expect(publicView.statusCode).toBe(200);expect(publicView.body).not.toMatch(/Ibai|Aranguren|9/);
    tutor=await login("tutor@example.test","Elena Tutor");
    const before=await app.inject({method:"GET",url:`/v1/team-seasons/${seasonId}/players/${playerId}`,headers:bearer(tutor.accessToken)});expect(before.statusCode).toBe(403);
    const request=await app.inject({method:"POST",url:`/v1/invitations/${invitation.json().token}/guardian-link-requests`,headers:bearer(tutor.accessToken),payload:{}});expect(request.statusCode).toBe(201);
    const pending=await app.inject({method:"GET",url:`/v1/team-seasons/${seasonId}/players/${playerId}`,headers:bearer(tutor.accessToken)});expect(pending.statusCode).toBe(403);
    const approval=await app.inject({method:"POST",url:`/v1/guardian-link-requests/${request.json().id}/approve`,headers:bearer(coach.accessToken),payload:{}});expect(approval.statusCode).toBe(200);
    const after=await app.inject({method:"GET",url:`/v1/team-seasons/${seasonId}/players/${playerId}`,headers:bearer(tutor.accessToken)});expect(after.statusCode).toBe(200);expect(after.json()).toMatchObject({id:playerId,first_name:"Ibai"});
  });

  it("uses the general code only for a non-enumerating pending claim",async()=>{
    const publicView=await app.inject({method:"GET",url:`/v1/team-join/${joinCode.toLowerCase()}`});
    expect(publicView.statusCode).toBe(200);expect(publicView.json()).toEqual({team:{name:"Talde Berria",sport:"FOOTBALL"},teamSeason:{seasonLabel:"2026/27",displayLabel:"Infantil B"},purpose:"GUARDIAN_LINK_REQUEST"});expect(publicView.body).not.toMatch(/Ibai|Aranguren|9/);
    const fallbackTutor=await login("fallback@example.test","Fallback Tutor");
    const missingClaim=await app.inject({method:"POST",url:`/v1/team-join/${joinCode}/guardian-link-requests`,headers:bearer(fallbackTutor.accessToken),payload:{}});expect(missingClaim.statusCode).toBe(422);expect(missingClaim.json().error.code).toBe("PLAYER_CLAIM_REQUIRED");
    const claim=await app.inject({method:"POST",url:`/v1/team-join/${joinCode}/guardian-link-requests`,headers:bearer(fallbackTutor.accessToken),payload:{claimedPlayerName:"Ibai Aranguren",claimedShirtNumber:9}});
    expect(claim.statusCode).toBe(201);expect(claim.json()).toMatchObject({status:"PENDING",player_id:null,claimed_player_name:"Ibai Aranguren",claimed_shirt_number:9});expect(claim.body).not.toContain(playerId);
    const noSelection=await app.inject({method:"POST",url:`/v1/guardian-link-requests/${claim.json().id}/approve`,headers:bearer(coach.accessToken),payload:{}});expect(noSelection.statusCode).toBe(422);
    const approved=await app.inject({method:"POST",url:`/v1/guardian-link-requests/${claim.json().id}/approve`,headers:bearer(coach.accessToken),payload:{playerId}});expect(approved.statusCode).toBe(200);
    const secondChildClaim=await app.inject({method:"POST",url:`/v1/team-join/${joinCode}/guardian-link-requests`,headers:bearer(fallbackTutor.accessToken),payload:{claimedPlayerName:"Beste Haurra",claimedShirtNumber:10}});expect(secondChildClaim.statusCode).toBe(201);expect(secondChildClaim.json()).toMatchObject({status:"PENDING",claimed_player_name:"Beste Haurra"});
  });

  it("blocks STAFF, GUARDIAN and known cross-team UUIDs",async()=>{
    const staff=await login("staff-new@example.test","Staff New");await pool.query(`INSERT INTO memberships(user_id,team_season_id,role) VALUES($1,$2,'STAFF')`,[staff.user.id,seasonId]);
    const staffPlayer=await app.inject({method:"POST",url:`/v1/team-seasons/${seasonId}/players`,headers:bearer(staff.accessToken,"staff-player"),payload:{firstName:"No",lastName:"Permitido"}});expect(staffPlayer.statusCode).toBe(403);
    const guardianPlayer=await app.inject({method:"POST",url:`/v1/team-seasons/${seasonId}/players`,headers:bearer(tutor.accessToken,"guardian-player"),payload:{firstName:"No",lastName:"Permitido"}});expect(guardianPlayer.statusCode).toBe(403);
    const otherCoach=await login("other-team@example.test","Other Coach");
    const otherBootstrap=await app.inject({method:"POST",url:"/v1/teams/bootstrap",headers:bearer(otherCoach.accessToken,"bootstrap-other"),payload:{team:{name:"Beste Taldea",sport:"BASKETBALL"},teamSeason:{seasonLabel:"2026/27",category:"Infantil",displayLabel:"Infantil A"}}});
    const otherSeason=otherBootstrap.json().teamSeason.id;
    const crossAdd=await app.inject({method:"POST",url:`/v1/team-seasons/${otherSeason}/players`,headers:bearer(coach.accessToken,"cross-player"),payload:{firstName:"Cross",lastName:"Denied"}});expect(crossAdd.statusCode).toBe(403);
    const crossRead=await app.inject({method:"GET",url:`/v1/team-seasons/${seasonId}/players/${playerId}`,headers:bearer(otherCoach.accessToken)});expect(crossRead.statusCode).toBe(403);
    const staffRequests=await app.inject({method:"GET",url:`/v1/team-seasons/${seasonId}/guardian-link-requests`,headers:bearer(staff.accessToken)});expect(staffRequests.statusCode).toBe(403);
  });

  it("keeps dev reset disabled by default and resets an independent Indautxu DEMO only when explicitly enabled",async()=>{
    const disabled=await app.inject({method:"POST",url:"/v1/dev/reset"});expect(disabled.statusCode).toBe(404);
    const demoApp=await buildApp({authAdapter:new DevelopmentAuthAdapter(true),enableDevReset:true});
    const reset=await demoApp.inject({method:"POST",url:"/v1/dev/reset"});expect(reset.statusCode).toBe(200);expect(reset.json()).toEqual({mode:"DEMO",team:{id:"71000000-0000-4000-8000-000000000001",name:"C.D. Indautxu"},teamSeason:{id:"72000000-0000-4000-8000-000000000001",displayLabel:"Infantil A",seasonLabel:"2026/27"},players:18,joinCode:"INDA16"});
    const count=await pool.query(`SELECT count(*) count FROM teams WHERE name='C.D. Indautxu'`);expect(count.rows[0].count).toBe("1");
    await demoApp.close();
  });
});
