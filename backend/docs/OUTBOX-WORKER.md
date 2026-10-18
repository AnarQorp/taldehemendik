# Transactional outbox worker (private-production candidate)

## Actual effect and scope

The frozen backend writes domain events atomically with API business writes but has no consumer. Migration `007_outbox_worker.sql` and `src/outbox/main.ts` implement the **MVP local activity inbox** consumer `mvp-activity-inbox-v1`. Processing creates a durable, immutable `outbox_activity_inbox` row containing the event identity, tenant, actor, aggregate, payload and occurrence time. It also creates a consumer receipt and acknowledges the source event. This is a real database materialization, not logging or an empty publish stub.

`published_at` now means **committed to the internal activity inbox**, not sent to a person or to an external broker. This release does not promise email, push, webhook delivery or an API notification screen. No external service is required. An external delivery integration would require its own consumer, receipts and idempotency contract; do not add network effects to this worker's transactional handler.

Supported frozen producer events: `TeamSeasonCreated`, `GuardianLinkApproved`, `AvailabilityChanged`, `CalledPlayerBecameUnavailable`, `ActionItemCreated`, `ActionItemResolved`, `EventCreated`, `EventUpdated`, `EventCancelled`, `EventCompleted`, `CallupPublished`, `CallupRevised`, `CallupCancelled`, `CallupPlayerReplaced`. Each must have its expected aggregate type, an object payload and a non-null tenant. Unsupported or malformed events fail, retry and become dead letters; they are never silently acknowledged. Tenant provenance is assigned by migration 006's producer trigger, not inferred from untrusted payload in the worker.

## Migrate and start

Apply migrations in filename order using the migration-owner connection. Migration 006 must create `talde_worker`, `talde_api`, the outbox provenance columns and producer trigger. Migration 007 adds scheduling/failure metadata, receipt/inbox tables, indexes, RLS and narrow worker grants. Migrations must not run using the worker or API login. Existing pending rows are consumed after migration; unresolved tenant provenance is retained as a visible failure.

Provision a **separate** non-superuser PostgreSQL login, `NOBYPASSRLS`, member of **only** `talde_worker`. The group role is NOLOGIN. Do not reuse the API or database owner password. Example, supplied by the operator using a secret password outside version control:

```sql
CREATE ROLE talde_outbox_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT talde_worker TO talde_outbox_login;
-- Set its password using the deployment secret mechanism, not a committed SQL file.
```

Set `OUTBOX_DATABASE_URL` to this login's connection string. It is mandatory; no fallback to the API/owner URL. Optional `OUTBOX_POLL_MS` defaults to 1000 and is bounded to 100..60000. Start from `backend/`:

```sh
npm run outbox:worker
# Equivalent: node --import tsx src/outbox/main.ts
```

The executable verifies the login is not superuser/BYPASSRLS, is a member of the worker role, and has no API/auth/policy-owner/auth-owner membership, elevated role-management privileges, or ownership of application tables (including through role membership); startup fails otherwise. Every processing transaction also executes `SET LOCAL ROLE talde_worker`. Worker grants permit reading outbox rows, changing **only** acknowledgement/retry metadata, and selecting/inserting inbox rows and receipts. It cannot read business tables, rewrite source payloads, delete effects/receipts, or change tenant provenance. The inbox/receipts are forced-RLS and inaccessible to the API role. They contain private data and are not public diagnostic tables.

## Delivery, concurrency and recovery contract

- Claim up to 20 eligible rows ordered by due time, creation time and UUID with `FOR UPDATE SKIP LOCKED`. Several replicas can safely claim disjoint batches without a lease clock or stale-owner takeover.
- A database transaction retains row locks until commit. Each handler runs behind a savepoint. Inbox effect + receipt `(consumer,event_id)` + source acknowledgement commit atomically; partial handler writes roll back before recording failure.
- On process/connection death, PostgreSQL rolls back the entire open batch and releases locks. Events become available to another worker immediately. Previously committed receipts prevent a second local effect if an acknowledgement is deliberately replayed.
- Delivery attempts are at least once; the local transactional inbox effect is exactly once for this fixed consumer version. This is **not** an exactly-once guarantee for arbitrary remote side effects.
- Default failure schedule is 1s, 2s, 4s, 8s, then dead-letter on the fifth failure. Exponential delay is capped at 5 minutes; attempts/max delay/batch/query timeouts are bounded in the library. Waiting rows are skipped; poison messages do not prevent later rows from processing. Dead letters retain the source event, attempt count and timestamp, with `published_at` null.
- Last error and process logs are intentionally generic: SQL error messages can disclose private payloads. Batch logs include claimed/processed/failed/dead-letter counts, and transaction failures have a distinct code. Inspect event type, metadata and handler contract using maintenance access to diagnose; never log payloads or credentials.
- Handlers are strictly local awaited database writes. `statement_timeout` and `idle_in_transaction_session_timeout` are set to 10s; they are not a JavaScript/network cancellation guarantee. Do not add hanging or network handlers. SIGTERM/SIGINT stop polling after the active batch; forced termination is safe because PostgreSQL rolls back.

## Monitoring and controlled replay

Using maintenance access, monitor pending age and dead letters (do not expose payloads):

```sql
SELECT count(*) pending, min(created_at) oldest_pending
FROM outbox_events WHERE published_at IS NULL AND dead_lettered_at IS NULL;
SELECT id,event_type,attempts,last_error,dead_lettered_at
FROM outbox_events WHERE dead_lettered_at IS NOT NULL ORDER BY dead_lettered_at;
```

After fixing a known cause, an operator may requeue a specific event, preserving payload, ID and receipts. Do not truncate receipts/inbox, silently discard unknown event types, or bulk replay without review:

```sql
UPDATE outbox_events SET attempts=0, next_attempt_at=now(),
  last_error=NULL, dead_lettered_at=NULL
WHERE id = '<reviewed-event-uuid>' AND published_at IS NULL;
```

Recovery is an owner/operator action, not an API or worker privilege. Record the review in the deployment's operations log. Retention/cleanup is likewise explicit operator work; no automatic deletion is introduced.

## Docker dependencies

Use the same compiled backend Node >=22 image and production lockfile dependencies (`pg`) as the API. Start a separate service/process with `npm run outbox:production` (`node dist/outbox/main.js`); `tsx` is development-only and is not present in the production image, read-only application files, `NODE_ENV=production`, database network access and its own `OUTBOX_DATABASE_URL` secret. PostgreSQL must be healthy and all migrations applied **before** starting either service; service startup does not migrate. Use a restart policy for infrastructure failures and allow graceful termination; forced termination is rollback-safe. No Redis, external queue, SMTP service, broker or paid dependency is needed. Do not embed the URL/password in an image or committed Compose file.

## Automated evidence

On an isolated migrated database, using maintenance `MIGRATION_DATABASE_URL` for test fixtures and restricted runtime `DATABASE_URL`, `AUTH_DATABASE_URL`, `OUTBOX_DATABASE_URL`:

```sh
npx vitest run test/integration/outbox-worker.test.ts --no-file-parallelism
```

Tests cover committed effect/receipt/ack, replay deduplication, concurrent consumers, unknown events, delayed retries, terminal failure, operator replay, rollback of partial handler effects, actual PostgreSQL connection termination before acknowledgement and recovery, worker business-table denial and API inbox denial. Test worker calls deliberately `SET LOCAL ROLE talde_worker`; the executable's startup verifier additionally prohibits owner credentials in real operation. These tests do not claim end-user notification delivery.
