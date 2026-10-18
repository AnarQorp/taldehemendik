-- Email OTP material is isolated from the API/worker and never enters audit/outbox.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='talde_auth') THEN CREATE ROLE talde_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='talde_auth_owner') THEN CREATE ROLE talde_auth_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS; END IF;
END $$;
CREATE TABLE auth_challenges (
  id uuid PRIMARY KEY,
  email text NOT NULL CHECK (email=lower(email)),
  otp_hash text NOT NULL CHECK (otp_hash ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX auth_challenges_email_created ON auth_challenges(email,created_at DESC);
ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_challenges FORCE ROW LEVEL SECURITY;
REVOKE ALL ON auth_challenges FROM PUBLIC, talde_api, talde_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON auth_challenges TO talde_auth;
GRANT USAGE ON SCHEMA public TO talde_auth,talde_auth_owner;
CREATE POLICY auth_service_only ON auth_challenges TO talde_auth USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE ON users TO talde_auth_owner;
CREATE FUNCTION resolve_auth_user(p_subject text,p_email text,p_display_name text)
RETURNS TABLE(id uuid,email text,display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_email IS NULL OR p_email<>lower(p_email) OR p_subject NOT IN ('email:'||p_email,'dev-email:'||p_email) OR length(p_email)>254 OR p_display_name IS NULL OR length(p_display_name) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid identity mapping' USING ERRCODE='22023';
  END IF;
  RETURN QUERY INSERT INTO public.users AS u(auth_subject,email,display_name)
    VALUES(p_subject,p_email,p_display_name)
    ON CONFLICT(auth_subject) DO UPDATE SET email=EXCLUDED.email
    RETURNING u.id,u.email,u.display_name;
END $$;
ALTER FUNCTION resolve_auth_user(text,text,text) OWNER TO talde_auth_owner;
REVOKE ALL ON FUNCTION resolve_auth_user(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_auth_user(text,text,text) TO talde_auth;
