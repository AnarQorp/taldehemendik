ALTER TABLE teams ADD COLUMN sport text;
UPDATE teams SET sport='FOOTBALL' WHERE sport IS NULL;
ALTER TABLE teams ALTER COLUMN sport SET NOT NULL;

ALTER TABLE team_seasons ADD COLUMN created_by_user_id uuid REFERENCES users(id);
ALTER TABLE team_seasons ADD COLUMN bootstrap_idempotency_key text;
ALTER TABLE team_seasons ADD COLUMN join_code text UNIQUE;
UPDATE team_seasons ts SET created_by_user_id=(
  SELECT m.user_id FROM memberships m WHERE m.team_season_id=ts.id AND m.role='COACH' AND m.status='ACTIVE' ORDER BY m.created_at LIMIT 1
) WHERE created_by_user_id IS NULL;
ALTER TABLE team_seasons ALTER COLUMN created_by_user_id SET NOT NULL;
CREATE UNIQUE INDEX team_season_bootstrap_retry_idx ON team_seasons(created_by_user_id,bootstrap_idempotency_key) WHERE bootstrap_idempotency_key IS NOT NULL;

ALTER TABLE roster_entries ADD COLUMN creation_idempotency_key text;
CREATE UNIQUE INDEX roster_creation_retry_idx ON roster_entries(team_season_id,creation_idempotency_key) WHERE creation_idempotency_key IS NOT NULL;

ALTER TABLE guardian_link_requests ALTER COLUMN player_id DROP NOT NULL;
ALTER TABLE guardian_link_requests ADD COLUMN claimed_player_name text CHECK (char_length(claimed_player_name) <= 200);
ALTER TABLE guardian_link_requests ADD COLUMN claimed_shirt_number integer CHECK (claimed_shirt_number BETWEEN 0 AND 999);
ALTER TABLE guardian_link_requests DROP CONSTRAINT guardian_link_requests_requester_user_id_team_season_id_pla_key;
CREATE UNIQUE INDEX individual_link_request_retry_idx ON guardian_link_requests(requester_user_id,team_season_id,player_id) WHERE player_id IS NOT NULL;
CREATE UNIQUE INDEX general_link_request_retry_idx ON guardian_link_requests(requester_user_id,invitation_id) WHERE player_id IS NULL;

ALTER TABLE teams ADD CONSTRAINT team_name_not_blank CHECK (length(btrim(name)) > 0);
ALTER TABLE team_seasons ADD CONSTRAINT season_label_not_blank CHECK (length(btrim(season_label)) > 0);
