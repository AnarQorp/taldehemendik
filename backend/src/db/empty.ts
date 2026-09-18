import { pool } from "./pool.js";

await pool.query(`TRUNCATE audit_events, outbox_events, action_items, callup_selections, callup_revisions,
  callup_draft_selections, callups, availability_history, availability_responses, events,
  guardian_links, guardian_link_requests, invitations, roster_entries, players, memberships,
  team_seasons, teams, users CASCADE`);
await pool.end();
console.log(JSON.stringify({event:"database.emptied",scope:"application_data"}));
