DROP INDEX general_link_request_retry_idx;
CREATE UNIQUE INDEX general_link_request_retry_idx
  ON guardian_link_requests(requester_user_id,invitation_id,lower(claimed_player_name),COALESCE(claimed_shirt_number,-1))
  WHERE player_id IS NULL;
