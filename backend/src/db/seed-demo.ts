import { pool } from "./pool.js";
import { ids } from "./ids.js";

export const elenaUserId = "00000000-0000-4000-8000-000000000003";

export const roster = [
  [ids.ibai, "Ibai", "Aranguren", 9],
  [ids.ane, "Ane", "Mintegi", 16],
  [ids.nahia, "Nahia", "Garcia", 12],
  [ids.irati, "Irati", "Fernandez", 15],
  ["30000000-0000-4000-8000-000000000005", "Gorka", "Elejalde", 1],
  ["30000000-0000-4000-8000-000000000006", "Eneko", "Zabala", 2],
  ["30000000-0000-4000-8000-000000000007", "Julen", "Ortiz", 3],
  ["30000000-0000-4000-8000-000000000008", "Jon", "Beltrán", 4],
  ["30000000-0000-4000-8000-000000000009", "Markel", "Saenz", 5],
  ["30000000-0000-4000-8000-000000000010", "Ander", "Lopez", 6],
  ["30000000-0000-4000-8000-000000000012", "Unai", "Martinez", 7],
  ["30000000-0000-4000-8000-000000000013", "Oier", "Gomez", 8],
  ["30000000-0000-4000-8000-000000000014", "Mikel", "Zabaleta", 10],
  ["30000000-0000-4000-8000-000000000015", "Aimar", "Ortiz", 11],
  // Cannot attend (2 players)
  ["30000000-0000-4000-8000-000000000016", "Asier", "Urkijo", 13],
  ["30000000-0000-4000-8000-000000000017", "Olatz", "Bengoa", 17],
  // No response (2 players)
  ["30000000-0000-4000-8000-000000000018", "Iker", "Baroja", 14],
  ["30000000-0000-4000-8000-000000000019", "Peio", "Gómez", 18]
] as const;

export async function resetDemoDataset(db = pool) {
  await db.query("BEGIN");
  try {
    await db.query(`TRUNCATE audit_events, outbox_events, action_items, callup_selections, callup_revisions, callup_draft_selections, callups, availability_history, availability_responses, events,
      guardian_links, guardian_link_requests, invitations, roster_entries, players, memberships, team_seasons, teams, users CASCADE`);

    // Users
    await db.query(`INSERT INTO users (id, auth_subject, email, display_name) VALUES
      ($1, 'dev-email:mikel@example.test', 'mikel@example.test', 'Mikel Zubeldia'),
      ($2, 'dev-email:staff@example.test', 'staff@example.test', 'Ane Staff'),
      ($3, 'dev-email:coach-b@example.test', 'coach-b@example.test', 'Coach B'),
      ($4, 'dev-email:elena@example.test', 'elena@example.test', 'Elena Gómez')`,
      [ids.coach, ids.staff, ids.otherCoach, elenaUserId]);

    // Teams & Seasons
    await db.query(`INSERT INTO teams (id, name) VALUES ($1, 'C.D. Indautxu'), ($2, 'Equipo B')`, [ids.team, ids.otherTeam]);
    await db.query(`INSERT INTO team_seasons (id, team_id, season_label, category, display_label, status) VALUES
      ($1, $2, '2026/27', 'Infantil', 'Infantil A', 'ACTIVE'),
      ($3, $4, '2026/27', 'Infantil', 'Infantil B', 'ACTIVE')`, [ids.season, ids.team, ids.otherSeason, ids.otherTeam]);

    // Memberships
    await db.query(`INSERT INTO memberships (user_id, team_season_id, role) VALUES
      ($1, $2, 'COACH'),
      ($3, $2, 'STAFF'),
      ($4, $5, 'COACH'),
      ($6, $2, 'GUARDIAN')`,
      [ids.coach, ids.season, ids.staff, ids.otherCoach, ids.otherSeason, elenaUserId]);

    // Players & Roster
    for (const [id, first, last, number] of roster) {
      await db.query(`INSERT INTO players(id, team_id, first_name, last_name) VALUES($1, $2, $3, $4)`, [id, ids.team, first, last]);
      await db.query(`INSERT INTO roster_entries(player_id, team_season_id, shirt_number) VALUES($1, $2, $3)`, [id, ids.season, number]);
    }

    // Link Elena to Ibai
    await db.query(`INSERT INTO guardian_links(guardian_user_id, player_id) VALUES($1, $2)`, [elenaUserId, ids.ibai]);

    // Other team player
    await db.query(`INSERT INTO players (id, team_id, first_name, last_name) VALUES ($1, $2, 'Otro', 'Jugador')`, [ids.otherPlayer, ids.otherTeam]);
    await db.query(`INSERT INTO roster_entries (player_id, team_season_id, shirt_number) VALUES ($1, $2, 7)`, [ids.otherPlayer, ids.otherSeason]);

    // Main Event: Torneo Indautxu (Active, callup enabled, starts Oct 10 2026)
    await db.query(`INSERT INTO events (id, team_season_id, title, type, starts_at, arrival_at, location, availability_enabled, availability_deadline, callup_enabled, status, created_by_user_id)
      VALUES ($1, $2, 'Torneo Indautxu', 'TOURNAMENT', '2026-10-10T08:00:00Z', '2026-10-10T07:30:00Z', 'Polideportivo Municipal Indautxu', true, '2026-10-08T20:00:00Z', true, 'ACTIVE', $3)`,
      [ids.event, ids.season, ids.coach]);

    // Additional event: Entrenamiento semanal (Active)
    await db.query(`INSERT INTO events (id, team_season_id, title, type, starts_at, arrival_at, location, availability_enabled, availability_deadline, callup_enabled, status, created_by_user_id)
      VALUES ('40000000-0000-4000-8000-000000000002', $1, 'Entrenamiento semanal', 'TRAINING', '2026-10-08T17:30:00Z', '2026-10-08T17:15:00Z', 'Campo Municipal', true, '2026-10-07T20:00:00Z', false, 'ACTIVE', $2)`,
      [ids.season, ids.coach]);

    // Secondary team event
    await db.query(`INSERT INTO events (id, team_season_id, title, type, starts_at, availability_enabled, availability_deadline, callup_enabled, status, created_by_user_id)
      VALUES ($1, $2, 'Evento Equipo B', 'TRAINING', '2026-10-10T08:00:00Z', true, '2026-10-08T20:00:00Z', false, 'ACTIVE', $3)`,
      [ids.otherEvent, ids.otherSeason, ids.otherCoach]);

    // Initial Availability for Torneo Indautxu:
    // 14 CAN_ATTEND: Ibai, Ane, Nahia, Irati, Gorka, Eneko, Julen, Jon, Markel, Ander, Unai, Oier, Mikel, Aimar
    const canPlayerIds = roster.slice(0, 14).map(r => r[0]);
    for (const pid of canPlayerIds) {
      await db.query(
        `INSERT INTO availability_responses(event_id, player_id, status, source, actor_user_id, version, updated_at)
         VALUES($1, $2, 'CAN_ATTEND', 'STAFF_RECORDED', $3, 1, now())`,
        [ids.event, pid, ids.staff]
      );
    }

    // 2 CANNOT_ATTEND: Asier, Olatz
    const cannotPlayerIds = [roster[14][0], roster[15][0]];
    for (const pid of cannotPlayerIds) {
      await db.query(
        `INSERT INTO availability_responses(event_id, player_id, status, source, actor_user_id, version, updated_at)
         VALUES($1, $2, 'CANNOT_ATTEND', 'STAFF_RECORDED', $3, 1, now())`,
        [ids.event, pid, ids.staff]
      );
    }

    // 2 NO_RESPONSE (Iker Baroja, Peio Gómez): not inserted in availability_responses, so backend derives NO_RESPONSE!
    // Resulting counts: 14 CAN_ATTEND, 2 CANNOT_ATTEND, 0 UNSURE, 2 NO_RESPONSE.

    await db.query("COMMIT");
    console.log(JSON.stringify({ event: "demo_database.seeded", dataset: "vs02_full" }));
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
