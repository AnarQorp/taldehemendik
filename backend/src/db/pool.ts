import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config.js";

export type DbContext = { actorId?: string; teamSeasonId?: string; invitationHash?: string;
  mode?: "tenant" | "discovery" | "bootstrap" | "invite" | "resolve" | "deny"; maintenance?: boolean };
const storage = new AsyncLocalStorage<{ context: DbContext; client?: pg.PoolClient }>();
const options = { max: 10, allowExitOnIdle: true, connectionTimeoutMillis: 5000 };
export const pool = new pg.Pool({ ...options, connectionString: config.databaseUrl });
// Maintenance credentials must NEVER be present in a deployed API/worker container.
export const rawPool = new pg.Pool({ ...options, connectionString: config.migrationDatabaseUrl ?? config.databaseUrl });
export const authPool = new pg.Pool({ ...options, connectionString: config.authDatabaseUrl ?? config.databaseUrl });

export function withDbContext<T>(context: DbContext, fn: () => Promise<T>): Promise<T> {
  return storage.run({ context }, fn);
}

export async function inTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const current = storage.getStore();
  if (current?.client) return fn(current.client);
  const context = current?.context ?? { mode: "deny" as const };
  if (context.maintenance && config.isProduction) throw new Error("Maintenance is forbidden in production API");
  const client = await (context.maintenance ? rawPool : pool).connect();
  let began = false; let discarded = false;
  try {
    await client.query("BEGIN"); began = true;
    if (!context.maintenance) {
      await client.query("SET LOCAL ROLE talde_api");
      await client.query(`SELECT set_config('app.actor_id',$1,true),set_config('app.team_season_id',$2,true),
        set_config('app.invitation_hash',$3,true),set_config('app.mode',$4,true),
        set_config('statement_timeout','15000',true),set_config('lock_timeout','5000',true)`,
      [context.actorId ?? "", context.teamSeasonId ?? "", context.invitationHash ?? "", context.mode ?? "deny"]);
    }
    const result = await storage.run({ context, client }, () => fn(client));
    await client.query("COMMIT"); began = false;
    return result;
  } catch (error) {
    if (began) { try { await client.query("ROLLBACK"); } catch { client.release(true); discarded = true; throw error; } }
    throw error;
  } finally {
    if (!discarded) client.release();
  }
}

// Existing API reads use the same transaction boundary as writes. No query can
// escape with a stale session GUC. A default/no-context query runs deny-by-default.
export const requestPool: pg.Pool = new Proxy(pool, {
  get(target, property) {
    if (property === "query") return (...args: unknown[]) => inTransaction((client) => {
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<pg.QueryResult>;
      return query(...args);
    });
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

export async function resolveAuthUser(subject: string, email: string, displayName: string) {
  const client = await authPool.connect();
  try {
    await client.query("BEGIN"); await client.query("SET LOCAL ROLE talde_auth");
    const result = await client.query(`SELECT * FROM public.resolve_auth_user($1,$2,$3)`, [subject,email,displayName]);
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function verifyRuntimeDatabase() {
  const client = await pool.connect();
  try {
    const identity = (await client.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,
      pg_has_role(session_user,'talde_api','member') api,
      pg_has_role(session_user,'talde_auth','member') auth,
      pg_has_role(session_user,'talde_worker','member') worker,
      pg_has_role(session_user,'talde_policy_owner','member') policy_owner,
      pg_has_role(session_user,'talde_auth_owner','member') auth_owner,
      EXISTS(SELECT FROM pg_tables WHERE schemaname='public' AND pg_has_role(session_user,tableowner,'member')) owns
      FROM pg_roles r WHERE r.rolname=session_user`)).rows[0];
    if (config.isProduction && (identity.rolsuper || identity.rolbypassrls || identity.rolcreaterole || identity.rolcreatedb || identity.rolreplication || !identity.api || identity.auth || identity.worker || identity.policy_owner || identity.auth_owner || identity.owns)) {
      throw new Error("API database login must be non-owner/non-bypass and member ONLY of talde_api");
    }
    await client.query("BEGIN");await client.query("SET LOCAL ROLE talde_api");
    const result = await client.query(`SELECT count(*)::int missing FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT IN ('schema_migrations')
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`);
    await client.query("ROLLBACK");
    if (result.rows[0].missing) throw new Error("Runtime schema requires ENABLE and FORCE RLS on every application table");
  } finally { client.release(); }
}

export async function verifyAuthDatabase() {
  if (!config.isProduction) return;
  const client = await authPool.connect();
  try {
    const r = (await client.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,
      pg_has_role(session_user,'talde_auth','member') auth,
      pg_has_role(session_user,'talde_api','member') api,
      pg_has_role(session_user,'talde_worker','member') worker,
      pg_has_role(session_user,'talde_policy_owner','member') policy_owner,
      pg_has_role(session_user,'talde_auth_owner','member') auth_owner,
      EXISTS(SELECT FROM pg_tables WHERE schemaname='public' AND pg_has_role(session_user,tableowner,'member')) owns
      FROM pg_roles r WHERE r.rolname=session_user`)).rows[0];
    if (!r || r.rolsuper || r.rolbypassrls || r.rolcreaterole || r.rolcreatedb || r.rolreplication || !r.auth || r.api || r.worker || r.policy_owner || r.auth_owner || r.owns) {
      throw new Error("Auth login must be non-owner/non-bypass and member ONLY of talde_auth");
    }
  } finally { client.release(); }
}
