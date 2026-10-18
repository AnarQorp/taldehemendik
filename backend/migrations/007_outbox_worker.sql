-- Local transactional consumer. Published means durably materialized in the inbox,
-- NOT delivered to an email/push provider. Existing rows remain pending.
ALTER TABLE outbox_events
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_error text,
  ADD COLUMN dead_lettered_at timestamptz;
CREATE INDEX outbox_worker_ready_idx ON outbox_events(next_attempt_at, created_at, id)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;
CREATE TABLE outbox_consumer_receipts (
  consumer text NOT NULL,
  event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
-- Durable MVP internal activity inbox. No invented email/webhook integration.
CREATE TABLE outbox_activity_inbox (
  event_id uuid PRIMARY KEY REFERENCES outbox_events(id) ON DELETE CASCADE,
  team_season_id uuid,
  actor_user_id uuid,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_activity_team_idx ON outbox_activity_inbox(team_season_id, occurred_at);
ALTER TABLE outbox_consumer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_consumer_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_activity_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_activity_inbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON outbox_consumer_receipts, outbox_activity_inbox FROM PUBLIC, talde_api;
GRANT SELECT, INSERT ON outbox_consumer_receipts, outbox_activity_inbox TO talde_worker;
GRANT SELECT ON outbox_events TO talde_worker;
GRANT UPDATE (published_at, attempts, next_attempt_at, last_error, dead_lettered_at) ON outbox_events TO talde_worker;
CREATE POLICY outbox_worker_select ON outbox_events FOR SELECT TO talde_worker USING (true);
CREATE POLICY outbox_worker_update ON outbox_events FOR UPDATE TO talde_worker USING (true) WITH CHECK (true);
CREATE POLICY receipts_worker_select ON outbox_consumer_receipts FOR SELECT TO talde_worker USING (true);
CREATE POLICY receipts_worker_insert ON outbox_consumer_receipts FOR INSERT TO talde_worker WITH CHECK (true);
CREATE POLICY inbox_worker_select ON outbox_activity_inbox FOR SELECT TO talde_worker USING (true);
CREATE POLICY inbox_worker_insert ON outbox_activity_inbox FOR INSERT TO talde_worker WITH CHECK (true);
