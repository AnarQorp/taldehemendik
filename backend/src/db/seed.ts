if (process.env.NODE_ENV === "production") throw new Error("Development dataset commands forbidden in production");
import { rawPool as pool } from "./pool.js";
import { ids } from "./ids.js";

const roster = [
  [ids.ibai,"Ibai","Aranguren",9], [ids.ane,"Ane","Agirre",4], [ids.nahia,"Nahia","Etxeberria",6], [ids.irati,"Irati","López",8],
  ["30000000-0000-4000-8000-000000000005","Unai","Martínez",1], ["30000000-0000-4000-8000-000000000006","June","Sanz",2],
  ["30000000-0000-4000-8000-000000000007","Oier","García",3], ["30000000-0000-4000-8000-000000000008","Maialen","Ruiz",5],
  ["30000000-0000-4000-8000-000000000009","Aimar","Fernández",7], ["30000000-0000-4000-8000-000000000010","Leire","Pérez",10],
  ["30000000-0000-4000-8000-000000000012","Markel","Ortiz",11], ["30000000-0000-4000-8000-000000000013","Nora","Díaz",12],
  ["30000000-0000-4000-8000-000000000014","Iker","Moreno",13], ["30000000-0000-4000-8000-000000000015","Uxue","Alonso",14],
  ["30000000-0000-4000-8000-000000000016","Jon","Navarro",15], ["30000000-0000-4000-8000-000000000017","Ainhoa","Gil",16],
  ["30000000-0000-4000-8000-000000000018","Asier","Vega",17], ["30000000-0000-4000-8000-000000000019","Maddi","Ramos",18]
] as const;

await pool.query("BEGIN");
try {
  await pool.query(`TRUNCATE audit_events, outbox_events, action_items, callup_selections, callup_revisions, callup_draft_selections, callups, availability_history, availability_responses, events,
    guardian_links, guardian_link_requests, invitations, roster_entries, players, memberships, team_seasons, teams, users CASCADE`);
  await pool.query(`INSERT INTO users (id, auth_subject, email, display_name) VALUES
    ($1, 'dev-email:mikel@example.test', 'mikel@example.test', 'Mikel Zubeldia'),
    ($2, 'dev-email:staff@example.test', 'staff@example.test', 'Ane Staff'),
    ($3, 'dev-email:coach-b@example.test', 'coach-b@example.test', 'Coach B')`, [ids.coach, ids.staff, ids.otherCoach]);
  await pool.query(`INSERT INTO teams (id, name, sport) VALUES ($1, 'S. D. Indautxu','FOOTBALL'), ($2, 'Equipo B','FOOTBALL')`, [ids.team, ids.otherTeam]);
  await pool.query(`INSERT INTO team_seasons (id, team_id, season_label, category, display_label, status, created_by_user_id) VALUES
    ($1, $2, '2026/27', 'Infantil', 'Infantil A', 'ACTIVE',$5),
    ($3, $4, '2026/27', 'Infantil', 'Infantil B', 'ACTIVE',$6)`, [ids.season, ids.team, ids.otherSeason, ids.otherTeam,ids.coach,ids.otherCoach]);
  await pool.query(`INSERT INTO memberships (user_id, team_season_id, role) VALUES
    ($1, $2, 'COACH'), ($3, $2, 'STAFF'), ($4, $5, 'COACH')`, [ids.coach, ids.season, ids.staff, ids.otherCoach, ids.otherSeason]);
  for (const [id,first,last,number] of roster) {
    await pool.query(`INSERT INTO players(id,team_id,first_name,last_name) VALUES($1,$2,$3,$4)`,[id,ids.team,first,last]);
    await pool.query(`INSERT INTO roster_entries(player_id,team_season_id,shirt_number) VALUES($1,$2,$3)`,[id,ids.season,number]);
  }
  await pool.query(`INSERT INTO players (id, team_id, first_name, last_name) VALUES ($1, $2, 'Otro', 'Jugador')`, [ids.otherPlayer, ids.otherTeam]);
  await pool.query(`INSERT INTO roster_entries (player_id, team_season_id, shirt_number) VALUES ($1, $2, 7)`, [ids.otherPlayer, ids.otherSeason]);
  await pool.query(`INSERT INTO events (id, team_season_id, title, type, starts_at, availability_enabled, availability_deadline, callup_enabled, status, created_by_user_id)
    VALUES ($1, $2, 'Torneo Indautxu', 'TOURNAMENT', now()+interval '7 days', true, now()+interval '5 days', true, 'ACTIVE', $3)`, [ids.event, ids.season, ids.coach]);
  await pool.query(`INSERT INTO events (id, team_season_id, title, type, starts_at, availability_enabled, availability_deadline, callup_enabled, status, created_by_user_id)
    VALUES ($1, $2, 'Evento Equipo B', 'TRAINING', now()+interval '7 days', true, now()+interval '5 days', false, 'ACTIVE', $3)`, [ids.otherEvent, ids.otherSeason, ids.otherCoach]);
  await pool.query(`INSERT INTO invitations(team_season_id,player_id,purpose,token_hash,expires_at,created_by_user_id)
    VALUES($1,$2,'GUARDIAN_LINK',encode(digest('public-token-seeded-for-local-tests','sha256'),'hex'),now()+interval '7 days',$3)`, [ids.season, ids.ibai, ids.coach]);
  await pool.query("COMMIT");
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
}
await pool.end();
console.log(JSON.stringify({ event: "database.seeded", dataset: "vs02" }));
