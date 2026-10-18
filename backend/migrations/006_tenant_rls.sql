-- Runtime identities cannot own tables, create schema objects, or bypass RLS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='talde_api') THEN CREATE ROLE talde_api NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='talde_worker') THEN CREATE ROLE talde_worker NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='talde_auth') THEN CREATE ROLE talde_auth NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='talde_policy_owner') THEN CREATE ROLE talde_policy_owner NOLOGIN NOSUPERUSER BYPASSRLS; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO talde_api,talde_worker,talde_auth,talde_policy_owner;
ALTER TABLE teams ADD COLUMN created_by_user_id uuid REFERENCES users(id);
UPDATE teams t SET created_by_user_id=(SELECT created_by_user_id FROM team_seasons ts WHERE ts.team_id=t.id ORDER BY ts.id LIMIT 1);
ALTER TABLE outbox_events ADD COLUMN team_season_id uuid REFERENCES team_seasons(id);
ALTER TABLE outbox_events ADD COLUMN actor_user_id uuid REFERENCES users(id);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO talde_policy_owner;

CREATE FUNCTION public.app_actor() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT nullif(current_setting('app.actor_id',true),'')::uuid
$f$;
ALTER FUNCTION public.app_actor() OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_actor() TO talde_api;

CREATE FUNCTION public.app_tenant() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT nullif(current_setting('app.team_season_id',true),'')::uuid
$f$;
ALTER FUNCTION public.app_tenant() OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_tenant() TO talde_api;

CREATE FUNCTION public.app_scope(ts uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT public.app_actor() IS NOT NULL AND (ts=public.app_tenant() OR (public.app_tenant() IS NULL AND current_setting('app.mode',true) IN ('discovery','bootstrap')))
$f$;
ALTER FUNCTION public.app_scope(ts uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_scope(ts uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_scope(ts uuid) TO talde_api;

CREATE FUNCTION public.app_role(ts uuid, roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT public.app_scope(ts) AND EXISTS(SELECT FROM public.memberships m WHERE m.user_id=public.app_actor() AND m.team_season_id=ts AND m.status='ACTIVE' AND m.role::text=ANY(roles))
$f$;
ALTER FUNCTION public.app_role(ts uuid, roles text[]) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_role(ts uuid, roles text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_role(ts uuid, roles text[]) TO talde_api;

CREATE FUNCTION public.app_member(ts uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT public.app_role(ts,ARRAY['COACH','STAFF','GUARDIAN'])
$f$;
ALTER FUNCTION public.app_member(ts uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_member(ts uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_member(ts uuid) TO talde_api;

CREATE FUNCTION public.app_staff(ts uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT public.app_role(ts,ARRAY['COACH','STAFF'])
$f$;
ALTER FUNCTION public.app_staff(ts uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_staff(ts uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_staff(ts uuid) TO talde_api;

CREATE FUNCTION public.app_coach(ts uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT public.app_role(ts,ARRAY['COACH'])
$f$;
ALTER FUNCTION public.app_coach(ts uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_coach(ts uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_coach(ts uuid) TO talde_api;

CREATE FUNCTION public.app_cap_season() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT i.team_season_id FROM public.invitations i WHERE i.token_hash=nullif(current_setting('app.invitation_hash',true),'') AND current_setting('app.mode',true)='invite' LIMIT 1
$f$;
ALTER FUNCTION public.app_cap_season() OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_cap_season() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_cap_season() TO talde_api;

CREATE FUNCTION public.app_bootstrap_team(tid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
SELECT public.app_actor() IS NOT NULL AND current_setting('app.mode',true)='bootstrap'
 AND EXISTS(SELECT FROM public.teams t WHERE t.id=tid AND t.created_by_user_id=public.app_actor())
$$;
ALTER FUNCTION public.app_bootstrap_team(uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_bootstrap_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_bootstrap_team(uuid) TO talde_api;

CREATE FUNCTION public.app_bootstrap_season(ts uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT public.app_actor() IS NOT NULL AND current_setting('app.mode',true)='bootstrap' AND EXISTS(SELECT FROM public.team_seasons s JOIN public.teams t ON t.id=s.team_id WHERE s.id=ts AND s.created_by_user_id=public.app_actor() AND t.created_by_user_id=public.app_actor())
$f$;
ALTER FUNCTION public.app_bootstrap_season(ts uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_bootstrap_season(ts uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_bootstrap_season(ts uuid) TO talde_api;

CREATE FUNCTION public.app_coach_team(tid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT EXISTS(SELECT FROM public.team_seasons s WHERE s.team_id=tid AND public.app_coach(s.id))
$f$;
ALTER FUNCTION public.app_coach_team(tid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_coach_team(tid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_coach_team(tid uuid) TO talde_api;

CREATE FUNCTION public.app_guardian(ts uuid, pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT public.app_role(ts,ARRAY['GUARDIAN']) AND EXISTS(SELECT FROM public.guardian_links g JOIN public.roster_entries r ON r.player_id=g.player_id WHERE g.guardian_user_id=public.app_actor() AND g.player_id=pid AND g.status='ACTIVE' AND r.team_season_id=ts AND r.status='ACTIVE')
$f$;
ALTER FUNCTION public.app_guardian(ts uuid, pid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_guardian(ts uuid, pid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_guardian(ts uuid, pid uuid) TO talde_api;

CREATE FUNCTION public.app_player(ts uuid, pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT (public.app_staff(ts) OR public.app_guardian(ts,pid)) AND EXISTS(SELECT FROM public.roster_entries r WHERE r.team_season_id=ts AND r.player_id=pid)
$f$;
ALTER FUNCTION public.app_player(ts uuid, pid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_player(ts uuid, pid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_player(ts uuid, pid uuid) TO talde_api;

CREATE FUNCTION public.app_player_any(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT EXISTS(SELECT FROM public.roster_entries r WHERE r.player_id=pid AND public.app_player(r.team_season_id,pid))
$f$;
ALTER FUNCTION public.app_player_any(pid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_player_any(pid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_player_any(pid uuid) TO talde_api;

CREATE FUNCTION public.app_player_coach(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT EXISTS(SELECT FROM public.players p WHERE p.id=pid AND public.app_coach_team(p.team_id))
$f$;
ALTER FUNCTION public.app_player_coach(pid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_player_coach(pid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_player_coach(pid uuid) TO talde_api;

CREATE FUNCTION public.app_event_season(eid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT team_season_id FROM public.events WHERE id=eid AND public.app_member(team_season_id)
$f$;
ALTER FUNCTION public.app_event_season(eid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_event_season(eid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_event_season(eid uuid) TO talde_api;

CREATE FUNCTION public.app_callup_season(cid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT team_season_id FROM public.callups WHERE id=cid AND public.app_member(team_season_id)
$f$;
ALTER FUNCTION public.app_callup_season(cid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_callup_season(cid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_callup_season(cid uuid) TO talde_api;

CREATE FUNCTION public.app_revision_season(rid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT c.team_season_id FROM public.callup_revisions r JOIN public.callups c ON c.id=r.callup_id WHERE r.id=rid AND public.app_member(c.team_season_id)
$f$;
ALTER FUNCTION public.app_revision_season(rid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_revision_season(rid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_revision_season(rid uuid) TO talde_api;

CREATE FUNCTION public.app_valid_claim(iid uuid, ts uuid, pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT public.app_actor() IS NOT NULL AND ts=public.app_cap_season() AND EXISTS(
SELECT FROM public.invitations i WHERE i.id=iid AND i.team_season_id=ts AND i.token_hash=current_setting('app.invitation_hash',true) AND i.status='ACTIVE' AND i.expires_at>now() AND i.player_id IS NOT DISTINCT FROM pid)
$f$;
ALTER FUNCTION public.app_valid_claim(iid uuid, ts uuid, pid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_valid_claim(iid uuid, ts uuid, pid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_valid_claim(iid uuid, ts uuid, pid uuid) TO talde_api;

CREATE FUNCTION public.app_claim_audit(ts uuid, eid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT EXISTS(SELECT FROM public.guardian_link_requests r WHERE r.id=eid AND r.team_season_id=ts AND r.requester_user_id=public.app_actor())
$f$;
ALTER FUNCTION public.app_claim_audit(ts uuid, eid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_claim_audit(ts uuid, eid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_claim_audit(ts uuid, eid uuid) TO talde_api;

CREATE FUNCTION public.app_resolve_tenant(kind text, eid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT ts FROM (
 SELECT team_season_id ts FROM public.events WHERE kind='event' AND id=eid
 UNION ALL SELECT team_season_id FROM public.callups WHERE kind='callup' AND id=eid
 UNION ALL SELECT team_season_id FROM public.action_items WHERE kind='action' AND id=eid
 UNION ALL SELECT team_season_id FROM public.guardian_link_requests WHERE kind='request' AND id=eid
) target WHERE EXISTS(SELECT FROM public.memberships m WHERE m.team_season_id=ts AND m.user_id=public.app_actor() AND m.status='ACTIVE') LIMIT 1
$f$;
ALTER FUNCTION public.app_resolve_tenant(kind text, eid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_resolve_tenant(kind text, eid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_resolve_tenant(kind text, eid uuid) TO talde_api;

CREATE FUNCTION public.app_outbox_season(kind text, aid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT CASE kind
 WHEN 'TeamSeason' THEN (SELECT id FROM public.team_seasons WHERE id=aid)
 WHEN 'GuardianLink' THEN (SELECT min(r.team_season_id::text)::uuid FROM public.guardian_links g JOIN public.roster_entries r ON r.player_id=g.player_id WHERE g.id=aid AND (r.team_season_id=public.app_tenant() OR public.app_tenant() IS NULL) GROUP BY g.id HAVING count(DISTINCT r.team_season_id)=1)
 WHEN 'AvailabilityResponse' THEN (SELECT e.team_season_id FROM public.availability_responses a JOIN public.events e ON e.id=a.event_id WHERE a.id=aid)
 WHEN 'ActionItem' THEN (SELECT team_season_id FROM public.action_items WHERE id=aid)
 WHEN 'Event' THEN (SELECT team_season_id FROM public.events WHERE id=aid)
 WHEN 'Callup' THEN (SELECT team_season_id FROM public.callups WHERE id=aid)
 END
$f$;
ALTER FUNCTION public.app_outbox_season(kind text, aid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_outbox_season(kind text, aid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_outbox_season(kind text, aid uuid) TO talde_api;

UPDATE outbox_events o SET team_season_id=CASE
 WHEN o.aggregate_type='GuardianLink' AND coalesce(o.payload->>'teamSeasonId','') ~ '^[0-9a-fA-F-]{36}$' THEN
  (SELECT r.team_season_id FROM guardian_links g JOIN roster_entries r ON r.player_id=g.player_id
   WHERE g.id=o.aggregate_id AND r.team_season_id=(o.payload->>'teamSeasonId')::uuid LIMIT 1)
 ELSE public.app_outbox_season(o.aggregate_type,o.aggregate_id) END;
DO $$ BEGIN IF EXISTS(SELECT FROM outbox_events WHERE team_season_id IS NULL) THEN
 RAISE EXCEPTION 'Outbox tenant backfill unresolved: repair/quarantine orphaned aggregates before migration'; END IF; END $$;
ALTER TABLE outbox_events ALTER COLUMN team_season_id SET NOT NULL;
CREATE FUNCTION public.app_stamp_outbox() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_id uuid;
BEGIN
 scope_id:=public.app_outbox_season(NEW.aggregate_type,NEW.aggregate_id);
 IF scope_id IS NULL OR (NEW.team_season_id IS NOT NULL AND NEW.team_season_id<>scope_id) THEN RAISE EXCEPTION 'Outbox aggregate/tenant mismatch' USING ERRCODE='23514'; END IF;
 NEW.team_season_id:=scope_id;
 IF public.app_actor() IS NOT NULL THEN
  IF NEW.actor_user_id IS NOT NULL AND NEW.actor_user_id<>public.app_actor() THEN RAISE EXCEPTION 'Outbox actor mismatch' USING ERRCODE='42501'; END IF;
  NEW.actor_user_id:=public.app_actor();
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION public.app_stamp_outbox() OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_stamp_outbox() FROM PUBLIC;
CREATE TRIGGER stamp_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION public.app_stamp_outbox();
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
REVOKE ALL ON users FROM PUBLIC;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams FORCE ROW LEVEL SECURITY;
REVOKE ALL ON teams FROM PUBLIC;
ALTER TABLE team_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_seasons FORCE ROW LEVEL SECURITY;
REVOKE ALL ON team_seasons FROM PUBLIC;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
REVOKE ALL ON memberships FROM PUBLIC;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE players FORCE ROW LEVEL SECURITY;
REVOKE ALL ON players FROM PUBLIC;
ALTER TABLE roster_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON roster_entries FROM PUBLIC;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON invitations FROM PUBLIC;
ALTER TABLE guardian_link_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_link_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON guardian_link_requests FROM PUBLIC;
ALTER TABLE guardian_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON guardian_links FROM PUBLIC;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON events FROM PUBLIC;
ALTER TABLE availability_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_responses FORCE ROW LEVEL SECURITY;
REVOKE ALL ON availability_responses FROM PUBLIC;
ALTER TABLE availability_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON availability_history FROM PUBLIC;
ALTER TABLE callups ENABLE ROW LEVEL SECURITY;
ALTER TABLE callups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON callups FROM PUBLIC;
ALTER TABLE callup_draft_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE callup_draft_selections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON callup_draft_selections FROM PUBLIC;
ALTER TABLE callup_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE callup_revisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON callup_revisions FROM PUBLIC;
ALTER TABLE callup_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE callup_selections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON callup_selections FROM PUBLIC;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON action_items FROM PUBLIC;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON audit_events FROM PUBLIC;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON outbox_events FROM PUBLIC;
GRANT SELECT(id,email,display_name,created_at) ON users TO talde_api;
GRANT SELECT,INSERT,UPDATE ON teams TO talde_api;
GRANT SELECT,INSERT,UPDATE ON team_seasons TO talde_api;
GRANT SELECT,INSERT,UPDATE ON memberships TO talde_api;
GRANT SELECT,INSERT,UPDATE ON players TO talde_api;
GRANT SELECT,INSERT,UPDATE ON roster_entries TO talde_api;
GRANT SELECT,INSERT,UPDATE ON invitations TO talde_api;
GRANT SELECT,INSERT,UPDATE ON guardian_link_requests TO talde_api;
GRANT SELECT,INSERT,UPDATE ON guardian_links TO talde_api;
GRANT SELECT,INSERT,UPDATE ON events TO talde_api;
GRANT SELECT,INSERT,UPDATE ON availability_responses TO talde_api;
GRANT SELECT,INSERT ON availability_history TO talde_api;
GRANT SELECT,INSERT,UPDATE ON callups TO talde_api;
GRANT SELECT,INSERT,UPDATE ON callup_draft_selections TO talde_api;
GRANT SELECT,INSERT,UPDATE ON callup_revisions TO talde_api;
GRANT SELECT,INSERT,UPDATE ON callup_selections TO talde_api;
GRANT SELECT,INSERT,UPDATE ON action_items TO talde_api;
GRANT SELECT,INSERT ON audit_events TO talde_api;
GRANT SELECT,INSERT ON outbox_events TO talde_api;
GRANT DELETE ON callup_draft_selections TO talde_api;
CREATE POLICY users_select ON users FOR SELECT TO talde_api USING (id=public.app_actor() OR EXISTS(SELECT FROM public.guardian_link_requests r WHERE r.requester_user_id=users.id AND public.app_coach(r.team_season_id))) ;
CREATE POLICY teams_select ON teams FOR SELECT TO talde_api USING (EXISTS(SELECT FROM public.team_seasons ts WHERE ts.team_id=teams.id AND (public.app_member(ts.id) OR public.app_cap_season()=ts.id)) OR (created_by_user_id=public.app_actor() AND current_setting('app.mode',true)='bootstrap')) ;
CREATE POLICY teams_insert ON teams FOR INSERT TO talde_api WITH CHECK (public.app_actor() IS NOT NULL AND created_by_user_id=public.app_actor() AND current_setting('app.mode',true)='bootstrap');
CREATE POLICY teams_update ON teams FOR UPDATE TO talde_api USING (public.app_coach_team(id)) WITH CHECK (public.app_coach_team(id));
CREATE POLICY team_seasons_select ON team_seasons FOR SELECT TO talde_api USING (public.app_member(id) OR public.app_cap_season()=id OR (created_by_user_id=public.app_actor() AND current_setting('app.mode',true)='bootstrap' AND public.app_bootstrap_team(team_id))) ;
CREATE POLICY team_seasons_insert ON team_seasons FOR INSERT TO talde_api WITH CHECK (created_by_user_id=public.app_actor() AND current_setting('app.mode',true)='bootstrap' AND public.app_bootstrap_team(team_id));
CREATE POLICY team_seasons_update ON team_seasons FOR UPDATE TO talde_api USING (public.app_coach(id)) WITH CHECK (public.app_coach(id));
CREATE POLICY memberships_select ON memberships FOR SELECT TO talde_api USING (public.app_scope(team_season_id) AND (user_id=public.app_actor() OR public.app_staff(team_season_id))) ;
CREATE POLICY memberships_insert ON memberships FOR INSERT TO talde_api WITH CHECK (public.app_coach(team_season_id) OR (user_id=public.app_actor() AND role='COACH' AND status='ACTIVE' AND public.app_bootstrap_season(team_season_id)));
CREATE POLICY memberships_update ON memberships FOR UPDATE TO talde_api USING (public.app_coach(team_season_id)) WITH CHECK (public.app_coach(team_season_id));
CREATE POLICY players_select ON players FOR SELECT TO talde_api USING (public.app_player_any(id) OR public.app_coach_team(team_id)) ;
CREATE POLICY players_insert ON players FOR INSERT TO talde_api WITH CHECK (public.app_coach_team(team_id));
CREATE POLICY players_update ON players FOR UPDATE TO talde_api USING (public.app_coach_team(team_id)) WITH CHECK (public.app_coach_team(team_id));
CREATE POLICY roster_entries_select ON roster_entries FOR SELECT TO talde_api USING (public.app_staff(team_season_id) OR public.app_guardian(team_season_id,player_id)) ;
CREATE POLICY roster_entries_insert ON roster_entries FOR INSERT TO talde_api WITH CHECK (public.app_coach(team_season_id));
CREATE POLICY roster_entries_update ON roster_entries FOR UPDATE TO talde_api USING (public.app_coach(team_season_id)) WITH CHECK (public.app_coach(team_season_id));
CREATE POLICY invitations_select ON invitations FOR SELECT TO talde_api USING (public.app_coach(team_season_id) OR (token_hash=nullif(current_setting('app.invitation_hash',true),'') AND current_setting('app.mode',true)='invite')) ;
CREATE POLICY invitations_insert ON invitations FOR INSERT TO talde_api WITH CHECK (public.app_coach(team_season_id) AND created_by_user_id=public.app_actor());
CREATE POLICY invitations_update ON invitations FOR UPDATE TO talde_api USING (public.app_coach(team_season_id) OR (public.app_actor() IS NOT NULL AND token_hash=nullif(current_setting('app.invitation_hash',true),'') AND current_setting('app.mode',true)='invite')) WITH CHECK (public.app_coach(team_season_id));
CREATE POLICY guardian_link_requests_select ON guardian_link_requests FOR SELECT TO talde_api USING (public.app_coach(team_season_id) OR (requester_user_id=public.app_actor() AND team_season_id=public.app_tenant())) ;
CREATE POLICY guardian_link_requests_insert ON guardian_link_requests FOR INSERT TO talde_api WITH CHECK (requester_user_id=public.app_actor() AND status='PENDING' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND public.app_valid_claim(invitation_id,team_season_id,player_id));
CREATE POLICY guardian_link_requests_update ON guardian_link_requests FOR UPDATE TO talde_api USING (public.app_coach(team_season_id)) WITH CHECK (public.app_coach(team_season_id));
CREATE POLICY guardian_links_select ON guardian_links FOR SELECT TO talde_api USING (public.app_player_coach(player_id) OR public.app_player_any(player_id) AND guardian_user_id=public.app_actor() OR EXISTS(SELECT FROM public.roster_entries r WHERE r.player_id=guardian_links.player_id AND public.app_staff(r.team_season_id))) ;
CREATE POLICY guardian_links_insert ON guardian_links FOR INSERT TO talde_api WITH CHECK (public.app_player_coach(player_id));
CREATE POLICY guardian_links_update ON guardian_links FOR UPDATE TO talde_api USING (public.app_player_coach(player_id)) WITH CHECK (public.app_player_coach(player_id));
CREATE POLICY events_select ON events FOR SELECT TO talde_api USING (public.app_member(team_season_id)) ;
CREATE POLICY events_insert ON events FOR INSERT TO talde_api WITH CHECK (public.app_staff(team_season_id) AND created_by_user_id=public.app_actor());
CREATE POLICY events_update ON events FOR UPDATE TO talde_api USING (public.app_staff(team_season_id)) WITH CHECK (public.app_staff(team_season_id));
CREATE POLICY availability_responses_select ON availability_responses FOR SELECT TO talde_api USING (public.app_player(public.app_event_season(event_id),player_id)) ;
CREATE POLICY availability_responses_insert ON availability_responses FOR INSERT TO talde_api WITH CHECK (actor_user_id=public.app_actor() AND ((source='STAFF_RECORDED' AND public.app_staff(public.app_event_season(event_id))) OR (source='GUARDIAN_RECORDED' AND public.app_guardian(public.app_event_season(event_id),player_id))));
CREATE POLICY availability_responses_update ON availability_responses FOR UPDATE TO talde_api USING (public.app_player(public.app_event_season(event_id),player_id)) WITH CHECK (actor_user_id=public.app_actor() AND ((source='STAFF_RECORDED' AND public.app_staff(public.app_event_season(event_id))) OR (source='GUARDIAN_RECORDED' AND public.app_guardian(public.app_event_season(event_id),player_id))));
CREATE POLICY availability_history_select ON availability_history FOR SELECT TO talde_api USING (public.app_player(public.app_event_season(event_id),player_id)) ;
CREATE POLICY availability_history_insert ON availability_history FOR INSERT TO talde_api WITH CHECK (actor_user_id=public.app_actor() AND ((source='STAFF_RECORDED' AND public.app_staff(public.app_event_season(event_id))) OR (source='GUARDIAN_RECORDED' AND public.app_guardian(public.app_event_season(event_id),player_id))));
CREATE POLICY callups_select ON callups FOR SELECT TO talde_api USING (public.app_staff(team_season_id) OR (status='PUBLISHED' AND public.app_member(team_season_id))) ;
CREATE POLICY callups_insert ON callups FOR INSERT TO talde_api WITH CHECK (public.app_staff(team_season_id) AND created_by_user_id=public.app_actor());
CREATE POLICY callups_update ON callups FOR UPDATE TO talde_api USING (public.app_staff(team_season_id) OR (status='PUBLISHED' AND public.app_member(team_season_id))) WITH CHECK (public.app_staff(team_season_id));
CREATE POLICY callup_draft_selections_select ON callup_draft_selections FOR SELECT TO talde_api USING (public.app_staff(public.app_callup_season(callup_id))) ;
CREATE POLICY callup_draft_selections_insert ON callup_draft_selections FOR INSERT TO talde_api WITH CHECK (public.app_staff(public.app_callup_season(callup_id)));
CREATE POLICY callup_draft_selections_delete ON callup_draft_selections FOR DELETE TO talde_api USING (public.app_staff(public.app_callup_season(callup_id))) ;
CREATE POLICY callup_revisions_select ON callup_revisions FOR SELECT TO talde_api USING (public.app_staff(public.app_callup_season(callup_id)) OR public.app_member(public.app_callup_season(callup_id)) AND EXISTS(SELECT FROM public.callups c WHERE c.id=callup_id AND c.status='PUBLISHED')) ;
CREATE POLICY callup_revisions_insert ON callup_revisions FOR INSERT TO talde_api WITH CHECK (public.app_staff(public.app_callup_season(callup_id)) AND actor_user_id=public.app_actor());
CREATE POLICY callup_selections_select ON callup_selections FOR SELECT TO talde_api USING (public.app_player(public.app_revision_season(revision_id),player_id) AND (public.app_staff(public.app_revision_season(revision_id)) OR EXISTS(SELECT FROM public.callup_revisions r JOIN public.callups c ON c.id=r.callup_id WHERE r.id=revision_id AND c.status='PUBLISHED'))) ;
CREATE POLICY callup_selections_insert ON callup_selections FOR INSERT TO talde_api WITH CHECK (public.app_staff(public.app_revision_season(revision_id)));
CREATE POLICY action_items_select ON action_items FOR SELECT TO talde_api USING (public.app_staff(team_season_id) OR public.app_guardian(team_season_id,player_id)) ;
CREATE POLICY action_items_insert ON action_items FOR INSERT TO talde_api WITH CHECK (public.app_staff(team_season_id) OR public.app_guardian(team_season_id,player_id));
CREATE POLICY action_items_update ON action_items FOR UPDATE TO talde_api USING (public.app_staff(team_season_id) OR public.app_guardian(team_season_id,player_id)) WITH CHECK (public.app_staff(team_season_id) OR public.app_guardian(team_season_id,player_id));
CREATE POLICY audit_events_select ON audit_events FOR SELECT TO talde_api USING (public.app_staff(team_season_id) OR actor_user_id=public.app_actor() AND public.app_scope(team_season_id)) ;
CREATE POLICY audit_events_insert ON audit_events FOR INSERT TO talde_api WITH CHECK (actor_user_id=public.app_actor() AND (public.app_member(team_season_id) OR public.app_claim_audit(team_season_id,entity_id)));
CREATE POLICY outbox_events_select ON outbox_events FOR SELECT TO talde_api USING (public.app_member(team_season_id) AND actor_user_id=public.app_actor()) ;
CREATE POLICY outbox_events_insert ON outbox_events FOR INSERT TO talde_api WITH CHECK (public.app_member(team_season_id) AND actor_user_id=public.app_actor());

CREATE FUNCTION public.app_check_relations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ts uuid; tid uuid; pid uuid; expected uuid;
BEGIN
 IF TG_TABLE_NAME='roster_entries' OR TG_TABLE_NAME='invitations' OR TG_TABLE_NAME='guardian_link_requests' THEN
  ts:=NEW.team_season_id; pid:=NEW.player_id;
 ELSIF TG_TABLE_NAME IN ('availability_responses','availability_history','action_items') THEN
  SELECT e.team_season_id INTO ts FROM public.events e WHERE e.id=NEW.event_id;pid:=NEW.player_id;
  IF TG_TABLE_NAME='action_items' THEN
   IF NEW.team_season_id IS DISTINCT FROM ts THEN RAISE EXCEPTION 'Cross-season action' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='callups' THEN
  SELECT e.team_season_id INTO ts FROM public.events e WHERE e.id=NEW.event_id;
  IF NEW.team_season_id IS DISTINCT FROM ts THEN RAISE EXCEPTION 'Cross-season callup' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='callup_draft_selections' THEN
  SELECT c.team_season_id INTO ts FROM public.callups c WHERE c.id=NEW.callup_id;pid:=NEW.player_id;
 ELSIF TG_TABLE_NAME='callup_selections' THEN
  SELECT c.team_season_id INTO ts FROM public.callups c JOIN public.callup_revisions r ON r.callup_id=c.id WHERE r.id=NEW.revision_id;pid:=NEW.player_id;
 END IF;
 IF TG_TABLE_NAME='availability_history' THEN
  IF NOT EXISTS(SELECT FROM public.availability_responses a WHERE a.id=NEW.response_id AND a.event_id=NEW.event_id AND a.player_id=NEW.player_id) THEN
   RAISE EXCEPTION 'History response/event/player mismatch' USING ERRCODE='23514';
  END IF;
 END IF;
 IF pid IS NOT NULL AND ts IS NULL THEN RAISE EXCEPTION 'Missing relation scope' USING ERRCODE='23514'; END IF;
 IF pid IS NOT NULL AND ts IS NOT NULL THEN
  SELECT team_id INTO tid FROM public.team_seasons WHERE id=ts;
  IF NOT EXISTS(SELECT FROM public.players p WHERE p.id=pid AND p.team_id=tid) THEN RAISE EXCEPTION 'Cross-team player relation' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME<>'roster_entries' AND NOT EXISTS(SELECT FROM public.roster_entries r WHERE r.player_id=pid AND r.team_season_id=ts) THEN RAISE EXCEPTION 'Player not in related season' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='guardian_link_requests' THEN
  SELECT team_season_id INTO expected FROM public.invitations WHERE id=NEW.invitation_id;
  IF NEW.team_season_id IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Cross-season invitation request' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION public.app_check_relations() OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_check_relations() FROM PUBLIC;
CREATE TRIGGER check_tenant_relations BEFORE INSERT OR UPDATE ON roster_entries FOR EACH ROW EXECUTE FUNCTION public.app_check_relations();
CREATE TRIGGER check_tenant_relations BEFORE INSERT OR UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION public.app_check_relations();
CREATE TRIGGER check_tenant_relations BEFORE INSERT OR UPDATE ON guardian_link_requests FOR EACH ROW EXECUTE FUNCTION public.app_check_relations();
CREATE TRIGGER check_tenant_relations BEFORE INSERT OR UPDATE ON availability_responses FOR EACH ROW EXECUTE FUNCTION public.app_check_relations();
CREATE TRIGGER check_tenant_relations BEFORE INSERT OR UPDATE ON availability_history FOR EACH ROW EXECUTE FUNCTION public.app_check_relations();
CREATE TRIGGER check_tenant_relations BEFORE INSERT OR UPDATE ON action_items FOR EACH ROW EXECUTE FUNCTION public.app_check_relations();
CREATE TRIGGER check_tenant_relations BEFORE INSERT OR UPDATE ON callups FOR EACH ROW EXECUTE FUNCTION public.app_check_relations();
CREATE TRIGGER check_tenant_relations BEFORE INSERT OR UPDATE ON callup_draft_selections FOR EACH ROW EXECUTE FUNCTION public.app_check_relations();
CREATE TRIGGER check_tenant_relations BEFORE INSERT OR UPDATE ON callup_selections FOR EACH ROW EXECUTE FUNCTION public.app_check_relations();

-- Aggregate provenance is internal to the trigger/migrator, not a lookup API.
REVOKE EXECUTE ON FUNCTION public.app_outbox_season(text,uuid) FROM talde_api;
