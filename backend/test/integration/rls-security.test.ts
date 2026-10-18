import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, requestPool, rawPool, inTransaction, withDbContext } from "../../src/db/pool.js";

// Independent hostile SQL tests: fixture administration is explicitly separated
// from queries made by the actual runtime LOGIN (SET LOCAL ROLE talde_api).
const keys = ["coachA","coachB","guardian","suspended","stranger","teamA","teamB","seasonA","seasonB","playerA","otherA","playerB","rosterA","rosterOther","rosterB","membershipA","membershipB","membershipG","membershipS","link","invitation","request","eventA","eventB","response","responseB","callup","action","outbox"] as const;
const f = Object.fromEntries(keys.map(key => [key, randomUUID()])) as Record<typeof keys[number], string>;
const q = (sql: string, values: unknown[] = []) => requestPool.query(sql, values);
const tenant = <T>(actorId: string, teamSeasonId: string, run: () => Promise<T>) => withDbContext({actorId,teamSeasonId,mode:"tenant"}, run);
const asA = <T>(run: () => Promise<T>) => tenant(f.coachA,f.seasonA,run);
const ids = (rows: {id:string}[]) => rows.map(row=>row.id).sort();
const expectDenied = async (run: () => Promise<unknown>, codes = ["42501","23514"]) => {
  let caught: unknown;
  try { await run(); } catch(error) { caught=error; }
  expect(caught, "hostile write must fail at the database boundary").toBeDefined();
  expect(codes).toContain((caught as {code:string}).code);
};

beforeAll(async()=>{
  const db=await rawPool.connect();
  try {
    await db.query("BEGIN");
    for(const key of ["coachA","coachB","guardian","suspended","stranger"] as const) await db.query("INSERT INTO users(id,auth_subject,email,display_name) VALUES($1,$2,$3,$4)",[f[key],`email:${f[key]}@example.test`,`${f[key]}@example.test`,key]);
    for(const [team,coach,season] of [[f.teamA,f.coachA,f.seasonA],[f.teamB,f.coachB,f.seasonB]]) {
      await db.query("INSERT INTO teams(id,name,sport,created_by_user_id) VALUES($1,'Security fixture','FOOTBALL',$2)",[team,coach]);
      await db.query("INSERT INTO team_seasons(id,team_id,season_label,category,display_label,status,created_by_user_id) VALUES($1,$2,'security','test','Security fixture','ACTIVE',$3)",[season,team,coach]);
    }
    for(const [id,user,season,role,status] of [[f.membershipA,f.coachA,f.seasonA,"COACH","ACTIVE"],[f.membershipB,f.coachB,f.seasonB,"COACH","ACTIVE"],[f.membershipG,f.guardian,f.seasonA,"GUARDIAN","ACTIVE"],[f.membershipS,f.suspended,f.seasonA,"COACH","SUSPENDED"]]) await db.query("INSERT INTO memberships(id,user_id,team_season_id,role,status) VALUES($1,$2,$3,$4,$5)",[id,user,season,role,status]);
    for(const [player,team,roster,season] of [[f.playerA,f.teamA,f.rosterA,f.seasonA],[f.otherA,f.teamA,f.rosterOther,f.seasonA],[f.playerB,f.teamB,f.rosterB,f.seasonB]]) {
      await db.query("INSERT INTO players(id,team_id,first_name,last_name) VALUES($1,$2,'Player','Private')",[player,team]);
      await db.query("INSERT INTO roster_entries(id,team_season_id,player_id) VALUES($1,$2,$3)",[roster,season,player]);
    }
    await db.query("INSERT INTO guardian_links(id,guardian_user_id,player_id) VALUES($1,$2,$3)",[f.link,f.guardian,f.playerA]);
    await db.query("INSERT INTO invitations(id,team_season_id,player_id,purpose,token_hash,expires_at,created_by_user_id) VALUES($1,$2,$3,'GUARDIAN_LINK',$4,now()+interval '1 hour',$5)",[f.invitation,f.seasonA,f.playerA,randomUUID().replaceAll("-","").padEnd(64,"0"),f.coachA]);
    await db.query("INSERT INTO guardian_link_requests(id,team_season_id,invitation_id,requester_user_id,player_id) VALUES($1,$2,$3,$4,$5)",[f.request,f.seasonA,f.invitation,f.guardian,f.playerA]);
    for(const [event,season,coach] of [[f.eventA,f.seasonA,f.coachA],[f.eventB,f.seasonB,f.coachB]]) await db.query("INSERT INTO events(id,team_season_id,title,type,starts_at,status,created_by_user_id) VALUES($1,$2,'Security fixture','TRAINING',now()+interval '1 day','ACTIVE',$3)",[event,season,coach]);
    await db.query("SELECT set_config('app.actor_id',$1,true),set_config('app.team_season_id',$2,true),set_config('app.mode','tenant',true)",[f.coachA,f.seasonA]);
    await db.query("INSERT INTO availability_responses(id,event_id,player_id,status,source,actor_user_id,version) VALUES($1,$2,$3,'CAN_ATTEND','STAFF_RECORDED',$4,1)",[f.response,f.eventA,f.playerA,f.coachA]);
    await db.query("SELECT set_config('app.actor_id',$1,true),set_config('app.team_season_id',$2,true)",[f.coachB,f.seasonB]);
    await db.query("INSERT INTO availability_responses(id,event_id,player_id,status,source,actor_user_id,version) VALUES($1,$2,$3,'CAN_ATTEND','STAFF_RECORDED',$4,1)",[f.responseB,f.eventB,f.playerB,f.coachB]);
    await db.query("SELECT set_config('app.actor_id',$1,true),set_config('app.team_season_id',$2,true)",[f.coachA,f.seasonA]);
    await db.query("INSERT INTO callups(id,event_id,team_season_id,created_by_user_id) VALUES($1,$2,$3,$4)",[f.callup,f.eventA,f.seasonA,f.coachA]);
    await db.query("INSERT INTO action_items(id,team_season_id,event_id,player_id,type) VALUES($1,$2,$3,$4,'CALLED_PLAYER_UNAVAILABLE')",[f.action,f.seasonA,f.eventA,f.playerA]);
    await db.query("INSERT INTO outbox_events(id,aggregate_type,aggregate_id,event_type,payload,team_season_id,actor_user_id) VALUES($1,'Event',$2,'SecurityFixture','{}',$3,$4)",[f.outbox,f.eventA,f.seasonA,f.coachA]);
    await db.query("COMMIT");
  }catch(error){await db.query("ROLLBACK");throw error;}finally{db.release();}
});
afterAll(async()=>{await pool.end();await rawPool.end();});

describe("PostgreSQL deny-by-default and team isolation",()=>{
  it("executes as the non-owner, non-bypass API role",async()=>{
    const row=(await q("SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    expect(row).toEqual({role:"talde_api",rolsuper:false,rolbypassrls:false});
    const owned=(await q("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner=current_user")).rows;
    expect(owned).toEqual([]);
  });
  it("enables AND forces RLS for every application table, including auth and worker",async()=>{
    const rows=(await rawPool.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'schema_migrations'")).rows;
    expect(rows.length).toBeGreaterThanOrEqual(22);
    expect(rows.filter(row=>!row.relrowsecurity||!row.relforcerowsecurity)).toEqual([]);
  });
  it.each([{}, {actorId:f.coachA}, {teamSeasonId:f.seasonA}, {actorId:f.stranger,teamSeasonId:f.seasonA}])("denies domain reads without a valid actor AND tenant: %j",async(context)=>{
    await withDbContext({...context,mode:"tenant"},async()=>{
      for(const table of ["teams","team_seasons","players","roster_entries","events","callups","guardian_links","availability_responses","action_items"]) expect((await q(`SELECT id FROM ${table} WHERE id=ANY($1::uuid[])`,[Object.values(f)])).rows,table).toEqual([]);
    });
  });
  it("isolates two coaches even with unfiltered SQL and forged tenant selection",async()=>{
    for(const [actor,season,team,players,event] of [[f.coachA,f.seasonA,f.teamA,[f.playerA,f.otherA],f.eventA],[f.coachB,f.seasonB,f.teamB,[f.playerB],f.eventB]] as const) await tenant(actor,season,async()=>{
      expect(ids((await q("SELECT id FROM teams")).rows)).toEqual([team]);
      expect(ids((await q("SELECT id FROM team_seasons")).rows)).toEqual([season]);
      expect(ids((await q("SELECT id FROM players")).rows)).toEqual([...players].sort());
      expect(ids((await q("SELECT id FROM events")).rows)).toEqual([event]);
    });
    await tenant(f.coachA,f.seasonB,async()=>{expect((await q("SELECT id FROM events")).rows).toEqual([]);expect((await q("SELECT id FROM players")).rows).toEqual([]);});
  });
  it("limits guardians to their linked child, not other children or unpublished callups",async()=>{
    await tenant(f.guardian,f.seasonA,async()=>{
      expect(ids((await q("SELECT id FROM players")).rows)).toEqual([f.playerA]);
      expect(ids((await q("SELECT id FROM roster_entries")).rows)).toEqual([f.rosterA]);
      expect(ids((await q("SELECT id FROM guardian_links")).rows)).toEqual([f.link]);
      expect((await q("SELECT id FROM callups")).rows).toEqual([]);
      expect(ids((await q("SELECT id FROM availability_responses")).rows)).toEqual([f.response]);
      await expectDenied(()=>q("INSERT INTO availability_responses(event_id,player_id,status,source,actor_user_id,version) VALUES($1,$2,'CAN_ATTEND','GUARDIAN_RECORDED',$3,1)",[f.eventA,f.otherA,f.guardian]));
    });
  });
  it("does not expose foreign tenant metadata through SECURITY DEFINER helpers",async()=>{
    for(const context of [{mode:"deny" as const},{actorId:f.coachA,teamSeasonId:f.seasonB,mode:"tenant" as const}]) await withDbContext(context,async()=>{
      const row=(await q("SELECT public.app_event_season($1) event_scope,public.app_callup_season($2) callup_scope",[f.eventB,f.callup])).rows[0];
      expect(row).toEqual({event_scope:null,callup_scope:null});
    });
  });
  it("revokes protected reads and writes for suspended membership",async()=>{
    await tenant(f.suspended,f.seasonA,async()=>{
      for(const table of ["events","players","roster_entries","guardian_links","availability_responses","callups"]) expect((await q(`SELECT id FROM ${table}`)).rows).toEqual([]);
      await expectDenied(()=>q("INSERT INTO events(team_season_id,title,type,starts_at,status,created_by_user_id) VALUES($1,'Hostile','TRAINING',now(),'ACTIVE',$2)",[f.seasonA,f.suspended]));
    });
  });
  it("denies foreign row modification without changing either team",async()=>{
    await asA(async()=>{expect((await q("UPDATE events SET title='Hostile' WHERE id=$1 RETURNING id",[f.eventB])).rows).toEqual([]);});
    expect((await rawPool.query("SELECT title FROM events WHERE id=$1",[f.eventB])).rows[0].title).toBe("Security fixture");
  });
});

describe("Database-enforced hostile writes and immutable ownership",()=>{
  it("rejects cross-team relationships independently of application validation",async()=>{
    await asA(async()=>{
      await expectDenied(()=>q("INSERT INTO roster_entries(team_season_id,player_id) VALUES($1,$2)",[f.seasonA,f.playerB]));
      await expectDenied(()=>q("INSERT INTO availability_responses(event_id,player_id,status,source,actor_user_id,version) VALUES($1,$2,'CAN_ATTEND','STAFF_RECORDED',$3,1)",[f.eventA,f.playerB,f.coachA]));
      await expectDenied(()=>q("INSERT INTO callups(event_id,team_season_id,created_by_user_id) VALUES($1,$2,$3)",[f.eventB,f.seasonA,f.coachA]));
      await expectDenied(()=>q("INSERT INTO action_items(team_season_id,event_id,player_id,type) VALUES($1,$2,$3,'CALLED_PLAYER_UNAVAILABLE')",[f.seasonA,f.eventB,f.playerB]));
      await expectDenied(()=>q("INSERT INTO callup_draft_selections(callup_id,player_id) VALUES($1,$2)",[f.callup,f.playerB]));
      await expectDenied(()=>q("INSERT INTO events(team_season_id,title,type,starts_at,status,created_by_user_id) VALUES($1,'Hostile','TRAINING',now(),'ACTIVE',$2)",[f.seasonB,f.coachA]));
    });
    expect((await rawPool.query("SELECT count(*)::int n FROM roster_entries WHERE team_season_id=$1 AND player_id=$2",[f.seasonA,f.playerB])).rows[0].n).toBe(0);
  });
  it("rejects history referencing another team's response despite local event/player claims",async()=>{
    await expectDenied(()=>asA(()=>q("INSERT INTO availability_history(response_id,event_id,player_id,status,source,actor_user_id,version) VALUES($1,$2,$3,'CAN_ATTEND','STAFF_RECORDED',$4,1)",[f.responseB,f.eventA,f.playerA,f.coachA])));
  });
  const changes:[string,string,string,string][]=[
    ["teams",f.teamA,"created_by_user_id",f.coachB],
    ["team_seasons",f.seasonA,"team_id",f.teamB],
    ["memberships",f.membershipA,"user_id",f.stranger],
    ["players",f.playerA,"team_id",f.teamB],
    ["roster_entries",f.rosterA,"player_id",f.otherA],
    ["invitations",f.invitation,"token_hash","a".repeat(64)],
    ["guardian_link_requests",f.request,"requester_user_id",f.stranger],
    ["guardian_links",f.link,"guardian_user_id",f.stranger],
    ["events",f.eventA,"created_by_user_id",f.coachB],
    ["availability_responses",f.response,"player_id",f.otherA],
    ["callups",f.callup,"event_id",f.eventB],
    ["action_items",f.action,"player_id",f.otherA]
  ];
  it.each(changes)("prevents mutating ownership %s.%s",async(table,id,column,replacement)=>{
    const before=(await rawPool.query(`SELECT ${column} AS value FROM ${table} WHERE id=$1`,[id])).rows[0].value;
    await expectDenied(()=>asA(()=>q(`UPDATE ${table} SET ${column}=$1 WHERE id=$2 RETURNING id`,[replacement,id])));
    expect((await rawPool.query(`SELECT ${column} AS value FROM ${table} WHERE id=$1`,[id])).rows[0].value).toBe(before);
  });
  it("denies auth storage, destructive privileges and worker-only capabilities",async()=>{
    await asA(async()=>{
      for(const sql of ["SELECT * FROM auth_challenges","DELETE FROM events","TRUNCATE events CASCADE","UPDATE outbox_events SET published_at=now()","SELECT * FROM outbox_consumer_receipts","SELECT * FROM outbox_activity_inbox","DELETE FROM auth_challenges","TRUNCATE auth_challenges"]) await expectDenied(()=>q(sql),["42501"]);
      await expectDenied(()=>q("SELECT * FROM public.resolve_auth_user($1,$2,$3)",["email:hostile@example.test","hostile@example.test","Hostile"]),["42501"]);
    });
  });
});

describe("Pooled transaction context lifecycle",()=>{
  it("clears actor/tenant after commit and rollback",async()=>{
    await asA(async()=>{expect(ids((await q("SELECT id FROM events")).rows)).toEqual([f.eventA]);});
    expect((await q("SELECT id FROM events")).rows).toEqual([]);
    await expect(asA(()=>inTransaction(async db=>{await db.query("SELECT id FROM events");throw new Error("intentional rollback");}))).rejects.toThrow("intentional rollback");
    expect((await q("SELECT id FROM events")).rows).toEqual([]);
    const client=await pool.connect();
    try {
      const row=(await client.query("SELECT current_user AS role,current_setting('app.actor_id',true) actor,current_setting('app.team_season_id',true) tenant")).rows[0];
      expect(row.role).not.toBe("talde_api");
      expect(row.actor??"").toBe("");expect(row.tenant??"").toBe("");
    }finally{client.release();}
  });
  it("keeps simultaneous actors and tenants independent across pooled connections",async()=>{
    await Promise.all(Array.from({length:32},async(_,index)=>{
      const a=index%2===0;const actor=a?f.coachA:f.coachB;const season=a?f.seasonA:f.seasonB;const event=a?f.eventA:f.eventB;
      await tenant(actor,season,()=>inTransaction(async db=>{
        await db.query("SELECT pg_sleep(0.005)");
        const row=(await db.query("SELECT current_setting('app.actor_id') actor,current_setting('app.team_season_id') tenant")).rows[0];
        expect(row).toEqual({actor,tenant:season});
        expect(ids((await q("SELECT id FROM events")).rows)).toEqual([event]);
      }));
    }));
    expect((await q("SELECT id FROM events")).rows).toEqual([]);
  });
});
