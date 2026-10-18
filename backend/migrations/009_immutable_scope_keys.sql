-- RLS predicates must not be subverted by moving existing authorized rows to
-- another tenant. Relationships are immutable; lifecycle changes remain allowed.
CREATE FUNCTION public.app_immutable_scope_keys() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE field text;
BEGIN
  FOREACH field IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW)->field) IS DISTINCT FROM (to_jsonb(OLD)->field) THEN
      RAISE EXCEPTION 'Immutable scope/identity field' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.app_immutable_scope_keys() FROM PUBLIC;
CREATE TRIGGER immutable_teams BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','created_by_user_id');
CREATE TRIGGER immutable_seasons BEFORE UPDATE ON team_seasons FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','team_id','created_by_user_id');
CREATE TRIGGER immutable_memberships BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','team_season_id','user_id','role');
CREATE TRIGGER immutable_players BEFORE UPDATE ON players FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','team_id');
CREATE TRIGGER immutable_rosters BEFORE UPDATE ON roster_entries FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','team_season_id','player_id');
CREATE TRIGGER immutable_invitations BEFORE UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','team_season_id','player_id','token_hash','purpose','created_by_user_id');
CREATE TRIGGER immutable_link_requests BEFORE UPDATE ON guardian_link_requests FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','team_season_id','invitation_id','requester_user_id');
CREATE TRIGGER immutable_guardian_links BEFORE UPDATE ON guardian_links FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','guardian_user_id','player_id');
CREATE TRIGGER immutable_events BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','team_season_id','created_by_user_id');
CREATE TRIGGER immutable_responses BEFORE UPDATE ON availability_responses FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','event_id','player_id');
CREATE TRIGGER immutable_callups BEFORE UPDATE ON callups FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','event_id','team_season_id','created_by_user_id');
CREATE TRIGGER immutable_action_items BEFORE UPDATE ON action_items FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','team_season_id','event_id','player_id','type','payload');
CREATE TRIGGER immutable_outbox BEFORE UPDATE ON outbox_events FOR EACH ROW EXECUTE FUNCTION public.app_immutable_scope_keys('id','aggregate_type','aggregate_id','event_type','payload','team_season_id','actor_user_id','created_at');
