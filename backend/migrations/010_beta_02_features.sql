-- Beta 0.2 Features: Team Notices, Player Direct Messages, Guardian Contacts

-- 1. Contact & Relationship additions
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text CHECK (phone IS NULL OR length(btrim(phone)) <= 30);
ALTER TABLE guardian_links ADD COLUMN IF NOT EXISTS relationship text CHECK (relationship IS NULL OR length(btrim(relationship)) <= 50);
ALTER TABLE guardian_link_requests ADD COLUMN IF NOT EXISTS relationship text CHECK (relationship IS NULL OR length(btrim(relationship)) <= 50);
ALTER TABLE guardian_link_requests ADD COLUMN IF NOT EXISTS contact_phone text CHECK (contact_phone IS NULL OR length(btrim(contact_phone)) <= 30);

-- 2. Team Notices (Broadcast notices to all team members)
CREATE TABLE IF NOT EXISTS team_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_season_id uuid NOT NULL REFERENCES team_seasons(id),
  author_user_id uuid NOT NULL REFERENCES users(id),
  category text NOT NULL CHECK (category IN ('GENERAL', 'SCHEDULE_CHANGE', 'CALLUP_NOTICE', 'KIT', 'URGENT')),
  title text NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 120),
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 2000),
  urgent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_notices_ts_created_idx ON team_notices(team_season_id, created_at DESC);
ALTER TABLE team_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_notices FORCE ROW LEVEL SECURITY;
REVOKE ALL ON team_notices FROM PUBLIC;
GRANT SELECT, INSERT ON team_notices TO talde_api;
GRANT SELECT ON team_notices TO talde_policy_owner;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='team_notices' AND policyname='team_notices_select') THEN
    CREATE POLICY team_notices_select ON team_notices FOR SELECT TO talde_api
      USING (public.app_member(team_season_id));
  END IF;
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='team_notices' AND policyname='team_notices_insert') THEN
    CREATE POLICY team_notices_insert ON team_notices FOR INSERT TO talde_api
      WITH CHECK (public.app_staff(team_season_id) AND author_user_id = public.app_actor());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgname='immutable_team_notices') THEN
    CREATE TRIGGER immutable_team_notices BEFORE UPDATE ON team_notices FOR EACH ROW
      EXECUTE FUNCTION public.app_immutable_scope_keys('id', 'team_season_id', 'author_user_id');
  END IF;
END $$;

-- 3. Player Direct Messages (Private coach -> family communications for a specific child)
CREATE TABLE IF NOT EXISTS player_direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_season_id uuid NOT NULL REFERENCES team_seasons(id),
  player_id uuid NOT NULL REFERENCES players(id),
  author_user_id uuid NOT NULL REFERENCES users(id),
  message text NOT NULL CHECK (length(btrim(message)) > 0 AND length(message) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_direct_messages_ts_p_idx ON player_direct_messages(team_season_id, player_id, created_at ASC);
ALTER TABLE player_direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_direct_messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON player_direct_messages FROM PUBLIC;
GRANT SELECT, INSERT ON player_direct_messages TO talde_api;
GRANT SELECT ON player_direct_messages TO talde_policy_owner;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='player_direct_messages' AND policyname='pdm_select') THEN
    CREATE POLICY pdm_select ON player_direct_messages FOR SELECT TO talde_api
      USING (public.app_staff(team_season_id) OR public.app_guardian(team_season_id, player_id));
  END IF;
  IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename='player_direct_messages' AND policyname='pdm_insert') THEN
    CREATE POLICY pdm_insert ON player_direct_messages FOR INSERT TO talde_api
      WITH CHECK (public.app_staff(team_season_id) AND author_user_id = public.app_actor());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_trigger WHERE tgname='immutable_pdm') THEN
    CREATE TRIGGER immutable_pdm BEFORE UPDATE ON player_direct_messages FOR EACH ROW
      EXECUTE FUNCTION public.app_immutable_scope_keys('id', 'team_season_id', 'player_id', 'author_user_id');
  END IF;
END $$;

-- 4. Extend app_outbox_season to recognize TeamNotice and PlayerDirectMessage aggregates
CREATE OR REPLACE FUNCTION public.app_outbox_season(kind text, aid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $f$
SELECT CASE kind
 WHEN 'TeamSeason' THEN (SELECT id FROM public.team_seasons WHERE id=aid)
 WHEN 'GuardianLink' THEN (SELECT min(r.team_season_id::text)::uuid FROM public.guardian_links g JOIN public.roster_entries r ON r.player_id=g.player_id WHERE g.id=aid AND (r.team_season_id=public.app_tenant() OR public.app_tenant() IS NULL) GROUP BY g.id HAVING count(DISTINCT r.team_season_id)=1)
 WHEN 'AvailabilityResponse' THEN (SELECT e.team_season_id FROM public.availability_responses a JOIN public.events e ON e.id=a.event_id WHERE a.id=aid)
 WHEN 'ActionItem' THEN (SELECT team_season_id FROM public.action_items WHERE id=aid)
 WHEN 'Event' THEN (SELECT team_season_id FROM public.events WHERE id=aid)
 WHEN 'Callup' THEN (SELECT team_season_id FROM public.callups WHERE id=aid)
 WHEN 'TeamNotice' THEN (SELECT team_season_id FROM public.team_notices WHERE id=aid)
 WHEN 'PlayerDirectMessage' THEN (SELECT team_season_id FROM public.player_direct_messages WHERE id=aid)
 END
$f$;

