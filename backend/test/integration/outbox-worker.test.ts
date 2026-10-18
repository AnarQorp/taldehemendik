import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONSUMER, createWorkerPool, materializeActivity, runBatch, verifyWorkerIdentity } from "../../src/outbox/worker.js";

// Owner is used only for fixtures, fault injection and postconditions.
const owner = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL });
const worker = createWorkerPool(process.env.OUTBOX_DATABASE_URL ?? process.env.DATABASE_URL);
worker.on("error",()=>{});
const userId=randomUUID(), teamId=randomUUID(), seasonId=randomUUID();
const eventIds:string[]=[];
async function enqueue(eventType="TeamSeasonCreated") {
  const id=randomUUID(); eventIds.push(id);
  await owner.query(`INSERT INTO outbox_events(id,aggregate_type,aggregate_id,event_type,payload,team_season_id,actor_user_id,created_at,next_attempt_at)
    VALUES($1,'TeamSeason',$2,$3,'{"source":"outbox-test"}',$2,$4,'2000-01-01','2000-01-01')`,[id,seasonId,eventType,userId]);
  return id;
}
async function event(id:string) { return (await owner.query("SELECT * FROM outbox_events WHERE id=$1",[id])).rows[0]; }
async function effectCount(id:string) {
  return Number((await owner.query("SELECT count(*) FROM outbox_activity_inbox WHERE event_id=$1",[id])).rows[0].count);
}
describe("outbox executable transactional consumer",()=>{
  beforeAll(async()=>{
    await owner.query(`INSERT INTO users(id,auth_subject,email,display_name) VALUES($1,$2,$3,'Worker fixture')`,[userId,`worker-${userId}`,`${userId}@example.test`]);
    await owner.query(`INSERT INTO teams(id,name,sport) VALUES($1,'Outbox tests','FOOTBALL')`,[teamId]);
    await owner.query(`INSERT INTO team_seasons(id,team_id,season_label,category,display_label,status,created_by_user_id)
      VALUES($1,$2,'2026','TEST','Outbox tests','ACTIVE',$3)`,[seasonId,teamId,userId]);
  });
  afterAll(async()=>{
    await owner.query("DELETE FROM outbox_events WHERE id=ANY($1::uuid[])",[eventIds]);
    await owner.query("DELETE FROM team_seasons WHERE id=$1",[seasonId]);
    await owner.query("DELETE FROM teams WHERE id=$1",[teamId]);
    await owner.query("DELETE FROM users WHERE id=$1",[userId]);
    await worker.end(); await owner.end();
  });
  it("accepts an actual dedicated worker login and rejects privileged memberships/ownership",async()=>{
    const login = `outbox_test_${randomUUID().replaceAll("-", "")}`;
    const password = randomUUID();
    const url = new URL((process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL)!); url.username=login; url.password=password;
    await owner.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    await owner.query(`GRANT talde_worker TO ${login}`);
    const actual=createWorkerPool(url.toString());
    try {
      await expect(verifyWorkerIdentity(actual)).resolves.toBeUndefined();
      await expect(verifyWorkerIdentity(owner)).rejects.toThrow();
      for(const role of ["talde_api","talde_auth","talde_policy_owner","talde_auth_owner"]) {
        await owner.query(`GRANT ${role} TO ${login}`);
        await expect(verifyWorkerIdentity(actual)).rejects.toThrow();
        await owner.query(`REVOKE ${role} FROM ${login}`);
      }
      await owner.query(`CREATE TABLE ${login}(id integer)`);
      await owner.query(`GRANT CREATE ON SCHEMA public TO ${login}`);
      await owner.query(`ALTER TABLE ${login} OWNER TO ${login}`);
      await owner.query(`REVOKE CREATE ON SCHEMA public FROM ${login}`);
      await expect(verifyWorkerIdentity(actual)).rejects.toThrow();
      await owner.query(`DROP TABLE ${login}`);
      await expect(verifyWorkerIdentity(actual)).resolves.toBeUndefined();
      const id=await enqueue();
      await runBatch(actual); expect(await effectCount(id)).toBe(1);
    } finally {
      await actual.end();
      await owner.query(`DROP TABLE IF EXISTS ${login}`);
      await owner.query(`DROP ROLE ${login}`);
    }
  });
  it("commits durable inbox, receipt and acknowledgement, and deduplicates replay",async()=>{
    const id=await enqueue(); await runBatch(worker);
    expect((await event(id)).published_at).not.toBeNull();
    expect(await effectCount(id)).toBe(1);
    expect((await owner.query("SELECT 1 FROM outbox_consumer_receipts WHERE consumer=$1 AND event_id=$2",[CONSUMER,id])).rowCount).toBe(1);
    await owner.query("UPDATE outbox_events SET published_at=NULL WHERE id=$1",[id]);
    await runBatch(worker);
    expect(await effectCount(id)).toBe(1);
    expect((await event(id)).published_at).not.toBeNull();
  });
  it("processes concurrent consumers without duplicate effects",async()=>{
    const ids=await Promise.all(Array.from({length:8},()=>enqueue()));
    await Promise.all([runBatch(worker,{batchSize:4}),runBatch(worker,{batchSize:4})]);
    for(const id of ids) {expect((await event(id)).published_at).not.toBeNull(); expect(await effectCount(id)).toBe(1);}
  });
  it("delays retries, bounds attempts, retains unknown events and permits operator recovery",async()=>{
    const id=await enqueue("FutureUnknownEvent");
    await runBatch(worker,{maxAttempts:2,retryBaseMs:60_000});
    expect(await event(id)).toMatchObject({attempts:1,published_at:null,dead_lettered_at:null});
    expect(await effectCount(id)).toBe(0);
    await runBatch(worker,{maxAttempts:2}); expect((await event(id)).attempts).toBe(1);
    await owner.query("UPDATE outbox_events SET next_attempt_at='2000-01-01' WHERE id=$1",[id]);
    await runBatch(worker,{maxAttempts:2}); expect((await event(id)).dead_lettered_at).not.toBeNull();
    await runBatch(worker,{maxAttempts:2}); expect((await event(id)).attempts).toBe(2);
    await owner.query(`UPDATE outbox_events SET attempts=0,dead_lettered_at=NULL,next_attempt_at='2000-01-01' WHERE id=$1`,[id]);
    // Simulate a reviewed handler upgrade supporting this previously unknown event;
    // recovery must preserve source identity and payload (009 makes them immutable).
    await runBatch(worker,{handler:async(db,e)=>{
      await db.query(`INSERT INTO outbox_activity_inbox(event_id,team_season_id,actor_user_id,aggregate_type,aggregate_id,event_type,payload,occurred_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[e.id,e.team_season_id,e.actor_user_id,e.aggregate_type,e.aggregate_id,e.event_type,JSON.stringify(e.payload),e.created_at]);
    }});
    expect((await event(id)).published_at).not.toBeNull(); expect(await effectCount(id)).toBe(1);
  });
  it("rolls back partial handler writes and recovers on retry",async()=>{
    const id=await enqueue();
    await runBatch(worker,{handler:async(db,e)=>{await materializeActivity(db,e);throw new Error("failure after effect");}});
    expect(await effectCount(id)).toBe(0); expect((await event(id)).published_at).toBeNull();
    await owner.query("UPDATE outbox_events SET next_attempt_at='2000-01-01' WHERE id=$1",[id]);
    await runBatch(worker); expect(await effectCount(id)).toBe(1);
  });
  it("recovers after a real connection death before acknowledgement",async()=>{
    const id=await enqueue();
    await expect(runBatch(worker,{handler:async(db,e)=>{
      await materializeActivity(db,e);
      const pid=(await db.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      expect(await effectCount(id)).toBe(0);
      await owner.query("SELECT pg_terminate_backend($1)",[pid]);
      await db.query("SELECT 1");
    }})).rejects.toThrow();
    expect(await effectCount(id)).toBe(0);
    expect(await event(id)).toMatchObject({published_at:null,attempts:0});
    await runBatch(worker); expect(await effectCount(id)).toBe(1);
  });
  it("worker cannot read business data, rewrite payloads or delete receipts/inbox",async()=>{
    const db=await worker.connect();
    try {
      for(const sql of ["SELECT * FROM players","UPDATE outbox_events SET payload='{}'","DELETE FROM outbox_consumer_receipts","DELETE FROM outbox_activity_inbox"]){
        await db.query("BEGIN"); await db.query("SET LOCAL ROLE talde_worker");
        await expect(db.query(sql)).rejects.toMatchObject({code:"42501"}); await db.query("ROLLBACK");
      }
    } finally {db.release();}
  });
  it("API role cannot read internal inbox or receipts",async()=>{
    const db=await owner.connect();
    try {
      for(const table of ["outbox_activity_inbox","outbox_consumer_receipts"]){
        await db.query("BEGIN"); await db.query("SET LOCAL ROLE talde_api");
        await expect(db.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({code:"42501"}); await db.query("ROLLBACK");
      }
    } finally {db.release();}
  });
});
