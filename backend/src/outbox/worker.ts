import pg from "pg";
import type { Pool, PoolClient } from "pg";

export const CONSUMER = "mvp-activity-inbox-v1";
const aggregateForEvent: Record<string, string> = {
  TeamSeasonCreated: "TeamSeason", GuardianLinkApproved: "GuardianLink",
  AvailabilityChanged: "AvailabilityResponse", CalledPlayerBecameUnavailable: "ActionItem",
  ActionItemCreated: "ActionItem", ActionItemResolved: "ActionItem",
  EventCreated: "Event", EventUpdated: "Event", EventCancelled: "Event", EventCompleted: "Event",
  CallupPublished: "Callup", CallupRevised: "Callup", CallupCancelled: "Callup", CallupPlayerReplaced: "Callup"
};
export interface OutboxEvent {
  id: string; team_season_id: string | null; actor_user_id: string | null;
  aggregate_type: string; aggregate_id: string; event_type: string;
  payload: Record<string, unknown>; created_at: Date; attempts: number;
}
export type Handler = (db: PoolClient, event: OutboxEvent) => Promise<void>;
export interface WorkerOptions {
  batchSize?: number; maxAttempts?: number; retryBaseMs?: number; retryMaxMs?: number;
  statementTimeoutMs?: number; handler?: Handler;
}
export function createWorkerPool(connectionString = process.env.OUTBOX_DATABASE_URL): Pool {
  if (!connectionString) throw new Error("OUTBOX_DATABASE_URL is required; use a dedicated outbox-only login");
  return new pg.Pool({ connectionString, max: 2, application_name: "talde-outbox-worker" });
}
/** Reject maintenance credentials in the executable, even if SET ROLE would mask them. */
export async function verifyWorkerIdentity(pool: Pool): Promise<void> {
  const check = await pool.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,
    pg_has_role(session_user,'talde_worker','MEMBER') worker,
    pg_has_role(session_user,'talde_api','MEMBER') api,
    pg_has_role(session_user,'talde_auth','MEMBER') auth,
    pg_has_role(session_user,'talde_policy_owner','MEMBER') policy_owner,
    pg_has_role(session_user,'talde_auth_owner','MEMBER') auth_owner,
    EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND pg_has_role(session_user,c.relowner,'MEMBER')) owns
    FROM pg_roles r WHERE r.rolname=session_user`);
  const role = check.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.rolreplication ||
      !role.worker || role.api || role.auth || role.policy_owner || role.auth_owner || role.owns)
    throw new Error("Worker login must be non-owner/non-bypass and member only of talde_worker");
}
export async function materializeActivity(db: PoolClient, event: OutboxEvent): Promise<void> {
  if (!Object.hasOwn(aggregateForEvent, event.event_type) || aggregateForEvent[event.event_type] !== event.aggregate_type)
    throw new Error("Unsupported outbox event or aggregate");
  if (!event.payload || Array.isArray(event.payload) || typeof event.payload !== "object")
    throw new Error("Invalid outbox payload");
  if (!event.team_season_id) throw new Error("Missing outbox tenant");
  await db.query(`INSERT INTO outbox_activity_inbox
    (event_id,team_season_id,actor_user_id,aggregate_type,aggregate_id,event_type,payload,occurred_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [event.id,event.team_season_id,event.actor_user_id,
    event.aggregate_type,event.aggregate_id,event.event_type,JSON.stringify(event.payload),event.created_at]);
}
function integer(value: number, min: number, max: number, name: string) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
/** DB-only handlers: never perform nontransactional external effects inside this transaction. */
export async function runBatch(pool: Pool, options: WorkerOptions = {}) {
  const batchSize = integer(options.batchSize ?? 20,1,100,"batchSize");
  const maxAttempts = integer(options.maxAttempts ?? 5,1,20,"maxAttempts");
  const retryBaseMs = integer(options.retryBaseMs ?? 1000,1,3_600_000,"retryBaseMs");
  const retryMaxMs = integer(options.retryMaxMs ?? 300_000,1,86_400_000,"retryMaxMs");
  const timeout = integer(options.statementTimeoutMs ?? 10_000,100,60_000,"statementTimeoutMs");
  const result = { claimed: 0, processed: 0, failed: 0, deadLettered: 0 };
  const db = await pool.connect();
  let connectionBroken = false;
  const connectionError = () => { connectionBroken = true; };
  db.on("error",connectionError);
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL ROLE talde_worker");
    await db.query("SELECT set_config('statement_timeout',$1,true)",[String(timeout)]);
    await db.query("SELECT set_config('idle_in_transaction_session_timeout',$1,true)",[String(timeout)]);
    const events = await db.query<OutboxEvent>(`SELECT * FROM outbox_events
      WHERE published_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at <= now()
      ORDER BY next_attempt_at,created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED`,[batchSize]);
    result.claimed = events.rows.length;
    for (const event of events.rows) {
      await db.query("SAVEPOINT event_effect");
      try {
        const receipt = await db.query(`SELECT 1 FROM outbox_consumer_receipts WHERE consumer=$1 AND event_id=$2`,[CONSUMER,event.id]);
        if (!receipt.rowCount) {
          await (options.handler ?? materializeActivity)(db,event);
          await db.query(`INSERT INTO outbox_consumer_receipts(consumer,event_id) VALUES($1,$2)`,[CONSUMER,event.id]);
        }
        await db.query(`UPDATE outbox_events SET published_at=now(),last_error=NULL WHERE id=$1`,[event.id]);
        await db.query("RELEASE SAVEPOINT event_effect");
        result.processed++;
      } catch {
        // Do not persist SQL error messages: they may contain private payload/PII.
        await db.query("ROLLBACK TO SAVEPOINT event_effect");
        const attempts = event.attempts + 1;
        const terminal = attempts >= maxAttempts;
        const delay = Math.min(retryMaxMs,retryBaseMs * 2 ** (attempts-1));
        await db.query(`UPDATE outbox_events SET attempts=$2,last_error=$3,
          next_attempt_at=clock_timestamp()+($4::double precision * interval '1 millisecond'),
          dead_lettered_at=CASE WHEN $5 THEN clock_timestamp() ELSE NULL END WHERE id=$1`,
          [event.id,attempts,"HANDLER_FAILED: inspect event type and worker contract",delay,terminal]);
        await db.query("RELEASE SAVEPOINT event_effect");
        result.failed++;
        if (terminal) result.deadLettered++;
      }
    }
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { db.release(connectionBroken); db.removeListener("error",connectionError); }
}
