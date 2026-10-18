if (process.env.NODE_ENV === "production") throw new Error("Development dataset commands forbidden in production");
import { rawPool as pool } from "./pool.js";
import type pg from "pg";

export async function emptyDatabase(db: pg.PoolClient | pg.Pool = pool) {
  await db.query(`TRUNCATE audit_events, outbox_events, action_items, callup_selections, callup_revisions,
    callup_draft_selections, callups, availability_history, availability_responses, events,
    guardian_links, guardian_link_requests, invitations, roster_entries, players, memberships,
    team_seasons, teams, users CASCADE`);
  return { mode: "CLEAN_BETA", status: "EMPTIED", scope: "application_data" };
}

if (process.argv[1]?.endsWith("empty.ts") || process.argv[1]?.endsWith("empty.js")) {
  await emptyDatabase(pool);
  await pool.end();
  console.log(JSON.stringify({ event: "database.emptied", scope: "application_data" }));
}
