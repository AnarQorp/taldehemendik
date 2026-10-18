import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { DevelopmentAuthAdapter } from "../../src/auth/development-adapter.js";
import { ids } from "../../src/db/ids.js";
import { rawPool as pool } from "../../src/db/pool.js";

const auth=new DevelopmentAuthAdapter(true);
const app=await buildApp({authAdapter:auth});
const bearer=(token:string,key?:string)=>({authorization:`Bearer ${token}`,...(key?{"idempotency-key":key}:{})});
async function login(email:string){const c=(await app.inject({method:"POST",url:"/v1/auth/otp/request",payload:{email}})).json();return (await app.inject({method:"POST",url:"/v1/auth/otp/verify",payload:{email,challengeId:c.challengeId,otp:c.developmentOtp}})).json() as {accessToken:string,user:{id:string}};}

const canPlayers=[ids.ibai,ids.ane,ids.nahia,ids.irati,
  "30000000-0000-4000-8000-000000000005","30000000-0000-4000-8000-000000000006","30000000-0000-4000-8000-000000000007",
  "30000000-0000-4000-8000-000000000008","30000000-0000-4000-8000-000000000009","30000000-0000-4000-8000-000000000010",
  "30000000-0000-4000-8000-000000000012","30000000-0000-4000-8000-000000000013","30000000-0000-4000-8000-000000000014","30000000-0000-4000-8000-000000000015"];
const cannotPlayers=["30000000-0000-4000-8000-000000000016","30000000-0000-4000-8000-000000000017"];
const noResponsePlayers=["30000000-0000-4000-8000-000000000018","30000000-0000-4000-8000-000000000019"];

describe("VS02 operational flow",()=>{
  let coach:string,staff:string,guardian:string,guardianId:string,callupId:string,actionId:string;
  const selected=[...canPlayers.filter(id=>![ids.ane,ids.nahia,ids.irati].includes(id as typeof ids.ane)),noResponsePlayers[0]!];
  beforeAll(async()=>{
    const c=await login("mikel@example.test"); coach=c.accessToken;
    const s=await login("staff@example.test"); staff=s.accessToken;
    const g=await login("elena@example.test"); guardian=g.accessToken; guardianId=g.user.id;
    await pool.query(`INSERT INTO memberships(user_id,team_season_id,role) VALUES($1,$2,'GUARDIAN') ON CONFLICT DO NOTHING`,[guardianId,ids.season]);
    await pool.query(`INSERT INTO guardian_links(guardian_user_id,player_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[guardianId,ids.ibai]);
  });
  afterAll(async()=>{await app.close();await pool.end();});

  it("summarizes 14 available, 2 unavailable and 2 without response",async()=>{
    for(const playerId of canPlayers){const r=await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${playerId}/availability/staff-recorded`,headers:bearer(staff,`can-${playerId}`),payload:{status:"CAN_ATTEND",expectedVersion:0}});expect(r.statusCode).toBe(200);}
    for(const playerId of cannotPlayers){const r=await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${playerId}/availability/staff-recorded`,headers:bearer(staff,`cannot-${playerId}`),payload:{status:"CANNOT_ATTEND",expectedVersion:0}});expect(r.statusCode).toBe(200);}
    const summary=await app.inject({method:"GET",url:`/v1/events/${ids.event}/availability`,headers:bearer(coach)});
    expect(summary.json().counts).toEqual({CAN_ATTEND:14,CANNOT_ATTEND:2,UNSURE:0,NO_RESPONSE:2});
  });

  it("blocks unavailable selection and publishes a warned draft idempotently",async()=>{
    const blocked=await app.inject({method:"POST",url:`/v1/events/${ids.event}/callup`,headers:bearer(coach),payload:{playerIds:[...selected.slice(0,11),cannotPlayers[0]]}});
    expect(blocked.statusCode).toBe(422);expect(blocked.json().error.code).toBe("PLAYER_CANNOT_ATTEND");
    await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${selected[1]}/availability/staff-recorded`,headers:bearer(staff,"temporary-unsure"),payload:{status:"UNSURE",expectedVersion:1}});
    const draft=await app.inject({method:"POST",url:`/v1/events/${ids.event}/callup`,headers:bearer(coach),payload:{playerIds:selected}});
    expect(draft.statusCode).toBe(201);callupId=draft.json().id;
    expect(draft.json().warnings.map((w:{code:string})=>w.code)).toEqual(expect.arrayContaining(["PLAYER_UNSURE","PLAYER_NO_RESPONSE"]));
    await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${selected[1]}/availability/staff-recorded`,headers:bearer(staff,"restore-from-unsure"),payload:{status:"CAN_ATTEND",expectedVersion:2}});
    const unconfirmed=await app.inject({method:"POST",url:`/v1/callups/${callupId}/publish`,headers:bearer(coach,"publish-callup"),payload:{expectedVersion:1,confirmWarnings:[]}});
    expect(unconfirmed.statusCode).toBe(422);expect(unconfirmed.json().error.code).toBe("CALLUP_WARNINGS_UNCONFIRMED");
    const published=await app.inject({method:"POST",url:`/v1/callups/${callupId}/publish`,headers:bearer(coach,"publish-callup"),payload:{expectedVersion:1,confirmWarnings:[`PLAYER_NO_RESPONSE:${noResponsePlayers[0]}`]}});
    expect(published.statusCode).toBe(200);expect(published.json()).toMatchObject({status:"PUBLISHED",current_revision_number:1,idempotentReplay:false});
    const replay=await app.inject({method:"POST",url:`/v1/callups/${callupId}/publish`,headers:bearer(coach,"publish-callup"),payload:{expectedVersion:1,confirmWarnings:[`PLAYER_NO_RESPONSE:${noResponsePlayers[0]}`]}});
    expect(replay.statusCode).toBe(200);expect(replay.json().idempotentReplay).toBe(true);
  });

  it("lets Elena see only Ibai callup status and denies team availability",async()=>{
    const own=await app.inject({method:"GET",url:`/v1/events/${ids.event}/players/${ids.ibai}/callup-status`,headers:bearer(guardian)});
    expect(own.statusCode).toBe(200);expect(own.json()).toMatchObject({called:true,revision:1});
    const other=await app.inject({method:"GET",url:`/v1/events/${ids.event}/players/${ids.ane}/callup-status`,headers:bearer(guardian)});
    expect(other.statusCode).toBe(403);
    const roster=await app.inject({method:"GET",url:`/v1/events/${ids.event}/availability`,headers:bearer(guardian)});
    expect(roster.statusCode).toBe(403);
  });

  it("creates one action item when called Ibai becomes unavailable and auto-resolves on restoration",async()=>{
    const revised=await app.inject({method:"POST",url:`/v1/callups/${callupId}/revisions`,headers:bearer(staff),payload:{playerIds:selected,expectedRevision:1,confirmWarnings:[`PLAYER_NO_RESPONSE:${noResponsePlayers[0]}`]}});
    expect(revised.statusCode).toBe(200);expect(revised.json().revisionNumber).toBe(2);
    const unavailable=await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${ids.ibai}/availability`,headers:bearer(guardian,"ibai-unavailable-1"),payload:{status:"CANNOT_ATTEND",expectedVersion:1}});
    expect(unavailable.statusCode).toBe(200);
    let pending=await app.inject({method:"GET",url:`/v1/team-seasons/${ids.season}/pending`,headers:bearer(coach)});
    expect(pending.json().actionItems).toHaveLength(1);actionId=pending.json().actionItems[0].id;
    const duplicate=await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${ids.ibai}/availability`,headers:bearer(guardian,"ibai-unavailable-2"),payload:{status:"CANNOT_ATTEND",expectedVersion:2}});
    expect(duplicate.statusCode).toBe(200);
    expect((await app.inject({method:"GET",url:`/v1/team-seasons/${ids.season}/pending`,headers:bearer(coach)})).json().actionItems).toHaveLength(1);
    const restored=await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${ids.ibai}/availability`,headers:bearer(guardian,"ibai-restored"),payload:{status:"CAN_ATTEND",expectedVersion:3}});
    expect(restored.statusCode).toBe(200);
    pending=await app.inject({method:"GET",url:`/v1/team-seasons/${ids.season}/pending`,headers:bearer(coach)});expect(pending.json().actionItems).toHaveLength(0);
    const unavailableAgain=await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${ids.ibai}/availability`,headers:bearer(guardian,"ibai-unavailable-3"),payload:{status:"CANNOT_ATTEND",expectedVersion:4}});
    expect(unavailableAgain.statusCode).toBe(200);
    pending=await app.inject({method:"GET",url:`/v1/team-seasons/${ids.season}/pending`,headers:bearer(coach)});actionId=pending.json().actionItems[0].id;
    const nonCalled=await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${ids.ane}/availability/staff-recorded`,headers:bearer(staff,"ane-temporary-out"),payload:{status:"CANNOT_ATTEND",expectedVersion:1}});expect(nonCalled.statusCode).toBe(200);
    expect((await app.inject({method:"GET",url:`/v1/team-seasons/${ids.season}/pending`,headers:bearer(coach)})).json().actionItems).toHaveLength(1);
    await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${ids.ane}/availability/staff-recorded`,headers:bearer(staff,"ane-restored"),payload:{status:"CAN_ATTEND",expectedVersion:2}});
  });

  it("returns only same-season available non-called candidates and revalidates eligibility",async()=>{
    const candidates=await app.inject({method:"GET",url:`/v1/action-items/${actionId}/replacement-candidates`,headers:bearer(coach)});
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().items.map((p:{id:string})=>p.id).sort()).toEqual([ids.ane,ids.nahia,ids.irati].sort());
    await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${ids.nahia}/availability/staff-recorded`,headers:bearer(staff,"nahia-now-out"),payload:{status:"CANNOT_ATTEND",expectedVersion:1}});
    const staleCandidate=await app.inject({method:"POST",url:`/v1/action-items/${actionId}/replace`,headers:bearer(coach),payload:{substitutePlayerId:ids.nahia,expectedCallupRevision:2}});
    expect(staleCandidate.statusCode).toBe(409);expect(staleCandidate.json().error.code).toBe("SUBSTITUTE_NO_LONGER_ELIGIBLE");
  });

  it("detects stale callup revision and replaces Ibai with Ane in one transaction",async()=>{
    const stale=await app.inject({method:"POST",url:`/v1/action-items/${actionId}/replace`,headers:bearer(coach),payload:{substitutePlayerId:ids.ane,expectedCallupRevision:1}});
    expect(stale.statusCode).toBe(409);expect(stale.json().error.code).toBe("CALLUP_VERSION_CONFLICT");
    const replaced=await app.inject({method:"POST",url:`/v1/action-items/${actionId}/replace`,headers:bearer(coach),payload:{substitutePlayerId:ids.ane,expectedCallupRevision:2}});
    expect(replaced.statusCode).toBe(200);expect(replaced.json()).toMatchObject({revisionNumber:3,removedPlayerId:ids.ibai,addedPlayerId:ids.ane,status:"RESOLVED"});
    const current=await app.inject({method:"GET",url:`/v1/callups/${callupId}`,headers:bearer(coach)});
    const latest=current.json().revisions.at(-1).player_ids;
    expect(latest).not.toContain(ids.ibai);expect(latest).toContain(ids.ane);expect(latest).toHaveLength(12);
    const guardianView=await app.inject({method:"GET",url:`/v1/events/${ids.event}/players/${ids.ibai}/callup-status`,headers:bearer(guardian)});
    expect(guardianView.json()).toMatchObject({called:false,revision:3});
  });

  it("keeps audit, outbox and immutable revisions for the complete sequence",async()=>{
    const revisions=await pool.query(`SELECT count(*) count FROM callup_revisions WHERE callup_id=$1`,[callupId]);expect(revisions.rows[0].count).toBe("3");
    const audits=await pool.query(`SELECT action FROM audit_events WHERE team_season_id=$1`,[ids.season]);
    expect(audits.rows.map(r=>r.action)).toEqual(expect.arrayContaining(["CALLUP_PUBLISHED","ACTION_ITEM_CREATED","ACTION_ITEM_AUTO_RESOLVED","CALLUP_REVISED","CALLUP_PLAYER_REPLACED","ACTION_ITEM_RESOLVED"]));
    const outbox=await pool.query(`SELECT event_type FROM outbox_events`);
    expect(outbox.rows.map(r=>r.event_type)).toEqual(expect.arrayContaining(["CallupPublished","CalledPlayerBecameUnavailable","ActionItemCreated","CallupRevised","CallupPlayerReplaced","ActionItemResolved"]));
  });

  it("rolls replacement back completely when revision persistence fails",async()=>{
    const affected=selected[1]!;
    const changed=await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${affected}/availability/staff-recorded`,headers:bearer(staff,"second-called-out"),payload:{status:"CANNOT_ATTEND",expectedVersion:3}});expect(changed.statusCode).toBe(200);
    const pending=(await app.inject({method:"GET",url:`/v1/team-seasons/${ids.season}/pending`,headers:bearer(coach)})).json();
    const secondAction=pending.actionItems.find((x:{player_id:string})=>x.player_id===affected).id;
    await pool.query(`CREATE FUNCTION fail_replacement_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.origin='REPLACEMENT' THEN RAISE EXCEPTION 'forced replacement failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER test_fail_replacement BEFORE INSERT ON callup_revisions FOR EACH ROW EXECUTE FUNCTION fail_replacement_revision()`);
    const failed=await app.inject({method:"POST",url:`/v1/action-items/${secondAction}/replace`,headers:bearer(coach),payload:{substitutePlayerId:ids.irati,expectedCallupRevision:3}});
    expect(failed.statusCode).toBe(500);
    await pool.query(`DROP TRIGGER test_fail_replacement ON callup_revisions; DROP FUNCTION fail_replacement_revision()`);
    const state=await pool.query(`SELECT (SELECT current_revision_number FROM callups WHERE id=$1) revision,(SELECT status FROM action_items WHERE id=$2) action_status`,[callupId,secondAction]);
    expect(state.rows[0]).toEqual({revision:3,action_status:"OPEN"});
    const cancelled=await app.inject({method:"POST",url:`/v1/events/${ids.event}/cancel`,headers:bearer(coach)});expect(cancelled.json().status).toBe("CANCELLED");
    const action=await pool.query(`SELECT status FROM action_items WHERE id=$1`,[secondAction]);expect(action.rows[0].status).toBe("CANCELLED");
    const postCancel=await app.inject({method:"PUT",url:`/v1/events/${ids.event}/players/${ids.irati}/availability/staff-recorded`,headers:bearer(staff),payload:{status:"UNSURE",expectedVersion:1}});expect(postCancel.statusCode).toBe(409);
  });
});
