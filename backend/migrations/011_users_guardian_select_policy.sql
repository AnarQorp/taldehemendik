-- Allow staff to view profile of guardians linked to players on their teams
-- and allow team members (guardians) to view coach/staff profiles for notices and messages
GRANT SELECT(phone), UPDATE(phone) ON users TO talde_api;
GRANT SELECT(phone) ON users TO talde_policy_owner;

CREATE OR REPLACE FUNCTION public.app_user_is_staff(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT EXISTS(
  SELECT 1 FROM public.memberships m
  WHERE m.user_id = uid AND m.role IN ('COACH', 'STAFF') AND m.status = 'ACTIVE' AND public.app_member(m.team_season_id)
);
$f$;
ALTER FUNCTION public.app_user_is_staff(uid uuid) OWNER TO talde_policy_owner;
REVOKE ALL ON FUNCTION public.app_user_is_staff(uid uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_user_is_staff(uid uuid) TO talde_api;

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users FOR SELECT TO talde_api USING (
  -- 1. Any user can view their own profile
  id = public.app_actor()
  -- 2. Staff can view requesters who applied to link to their team
  OR EXISTS (
    SELECT 1 FROM public.guardian_link_requests r
    WHERE r.requester_user_id = users.id AND public.app_coach(r.team_season_id)
  )
  -- 3. Staff can view linked guardians of players on their team
  OR EXISTS (
    SELECT 1 FROM public.guardian_links g
    JOIN public.roster_entries r ON r.player_id = g.player_id
    WHERE g.guardian_user_id = users.id AND g.status = 'ACTIVE' AND public.app_staff(r.team_season_id)
  )
  -- 4. Members (including guardians) can view staff/coaches of their team (e.g. for notices, messages, team info)
  OR public.app_user_is_staff(users.id)
);

DROP POLICY IF EXISTS users_update ON users;
CREATE POLICY users_update ON users FOR UPDATE TO talde_api
  USING (
    id = public.app_actor()
    OR EXISTS (
      SELECT 1 FROM public.guardian_link_requests r
      WHERE r.requester_user_id = users.id AND public.app_coach(r.team_season_id)
    )
  )
  WITH CHECK (
    id = public.app_actor()
    OR EXISTS (
      SELECT 1 FROM public.guardian_link_requests r
      WHERE r.requester_user_id = users.id AND public.app_coach(r.team_season_id)
    )
  );
