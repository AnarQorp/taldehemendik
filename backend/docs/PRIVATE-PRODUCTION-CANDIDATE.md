# Private-production candidate: audit and execution contract

## Baseline and verdict

Frozen source: `integration/beta-vs03`, commit `ac49e34326b643b65d69089266fde088a2882ab3`; annotated `beta-0.1-local` still peels to that exact commit. Candidate branch: `feat/private-production-rls-outbox`. The exact candidate commit is supplied with the delivery manifest, avoiding a self-referential commit hash in this file.

**BLOCKED for deployment with real users until the operator configures production SMTP and completes a real email delivery → OTP login smoke test.** No existing production SMTP credentials or destination were provided or used. TLS delivery and verification are proven against an isolated local SMTP test server, not an actual deployment mail service. Do not substitute development authentication. The code candidate is reviewable and reproducibly tested; no VPS, production database, Beta tag or frozen migration was modified. No paid service or subscription was introduced.

## Audit of the actual frozen contract

- Fastify/TypeScript monolith with PostgreSQL and five ordered SQL migrations; the pool used no transaction-local actor/season context, and no application table had ENABLE/FORCE RLS or policies.
- The backend checked memberships/guardian links in SQL and wrote business mutations, audit and outbox rows in the same transaction. The outbox had no executable consumer, acknowledgement/retry contract or durable effect.
- Every app instance selected `DevelopmentAuthAdapter`: in-memory OTP challenges and a default development signing secret. Turning off the OTP response alone was not production authentication.
- Existing MVP includes coach bootstrap, roster, capability invitations and guardian approval, events, availability, callup drafts/publication/revision and replacement action items. Those contracts are retained. No external notification integration is invented.

## New migrations (001–005 preserved byte-for-byte)

1. **006_tenant_rls.sql**: role groups, actor/tenant helpers, provenance backfill, FORCE RLS on the 19 original domain tables, policies and cross-relation integrity triggers. Teams gain creator provenance; outbox gains non-null tenant and actor provenance. The backfill derives scope from real aggregates; ambiguous/orphan legacy records abort migration rather than receive an arbitrary tenant. Repair verified source relationships on a copied database before retrying.
2. **007_outbox_worker.sql**: attempts, due time, failure/dead-letter metadata, ready index, durable activity inbox and consumer receipt. New tables are FORCE RLS and worker-only.
3. **008_production_auth.sql**: FORCE-RLS persistent OTP challenge table, narrow authentication role and SECURITY DEFINER identity mapping.
4. **009_immutable_scope_keys.sql**: blocks reparenting of existing tenant/identity keys and rewriting original outbox content. Normal lifecycle/status changes remain available.

`npm run migrate:production` runs compiled migrations with an administrator/migrator credential. An advisory lock serializes concurrent migrators; each file and its ledger entry commit atomically. Database/role creation requires administrator authority. Startup never auto-migrates. There is no destructive automatic down migration: stop writers and back up before applying to an existing installation; rehearse restoration on an isolated copy. Preserve ledger and domain data. Test both a new database and an upgrade of a copy of the frozen five-migration schema. This task verified fresh PostgreSQL with ordered 001–009 **and a populated copy of the exact frozen 001–005 schema**, using the frozen seed and actual frozen API producers. Five pending events across four event types were backfilled and consumed correctly; users/teams/players/events counts were preserved. A deliberately orphaned copy blocked 006 atomically, preserving its five-file ledger and six pending events. No real user dataset was migrated.

## Transaction identity and trust boundary

The verified bearer token supplies actor UUID. Route scope is an explicit season UUID or a resource-to-season lookup that itself checks active membership. Clients cannot supply the actor through a header or request body. Reads and writes use `requestPool` / `inTransaction`: BEGIN → SET LOCAL ROLE talde_api → transaction-local actor, season, mode and invitation hash → SQL → COMMIT/ROLLBACK before releasing the client. Nested work shares the transaction. No request holds a transaction across email delivery. No ambient context means deny, not a wildcard. Pool reuse, rollback and simultaneous different-tenant contexts are tested.

Narrow non-tenant modes preserve existing endpoints: own-membership discovery, creator-only bootstrap, opaque-resource resolution, and invitation capability metadata. An invitation hash authorizes only its exact invitation and safe team metadata, never a roster. Requesting guardian approval gives no child-data access before approval. An absent actor or season does not authorize ordinary tenant reads. Self identity reads are not a tenant roster.

The backend and runtime database secrets are trusted to establish the context. RLS protects against omitted/incorrect SQL predicates and hostile identifiers; it does not make a compromised server or arbitrary SQL execution with stolen credentials unable to impersonate context. No runtime login owns tables, bypasses RLS, creates roles/databases or receives other runtime identities. Startup rejects those credentials.

### Policy boundaries

- Team/season: active membership and matching scope. Coach-only management; bootstrap limited to verified creator.
- Players/roster: coach/staff within season; guardians only their approved active linked child and roster. Cross-team foreign-key combinations rejected inside PostgreSQL.
- Invitations/requests: coach control; exact capability for claiming; requester may see their own scoped request. No pending-link escalation.
- Events: active season members read; staff/coach mutate.
- Availability/history: own linked child for guardians, scoped staff access; source/actor checks, immutable history and relational provenance. Optimistic versions retained.
- Callups/drafts/revisions/selections: scoped staff management; guardian reads only published callups; selections checked against the event roster.
- Action items: staff scope, immutable source identity and payload. Audit/outbox source are append-only to API; only draft selections expose the narrow DELETE needed to replace a draft.
- Auth challenges: auth identity only; worker inbox/receipts: worker identity only. Neither is a public diagnostic interface.

Recursion-free helpers use a tightly limited NOLOGIN `talde_policy_owner` with BYPASSRLS and read-only domain access. Identity mapping uses a separate NOLOGIN `talde_auth_owner` with narrow users privileges. These are explicit privileged function owners, **not** runtime logins, and no runtime may inherit them. Functions have fixed trusted search paths and PUBLIC execution revoked; public schema creation is revoked. They do not authorize arbitrary SQL. FORCE RLS alone is not claimed to constrain a PostgreSQL superuser.

## Worker contract

`node dist/outbox/main.js` is a separate continuously polling process. Its credential belongs only to `talde_worker`. It consumes all existing MVP producer event types into a durable **local activity inbox**, plus a unique consumer receipt and source acknowledgement, atomically. `published_at` means internal processing, not user email/push delivery. There is no claim of a notification UI or external integration.

Concurrent workers use row locks with SKIP LOCKED. Per-event savepoints isolate failures; bounded backoff retries then retains poison events as dead letters. Process/connection failure rolls back partial work, and receipts prevent duplicate committed effects during replay. Recovery/requeue is explicit operator work, preserving event IDs and receipts. See [the full outbox runbook](OUTBOX-WORKER.md) for supported events, SQL monitoring, retry limits and replay. Network side effects must not be added to the transactional handler.

## Authentication

Production factory selects persistent email OTP with HMAC-hashed codes, expiry, attempt limits, mailbox throttling, single-use concurrency and real SMTP STARTTLS/SMTPS certificate validation. Access tokens are one-hour signed opaque tokens with validated issuer/audience/timestamps/UUID, not interoperable JWTs. OTPs are absent from production response/log/audit/outbox. Development adapters/endpoints and example signing keys fail closed in production. Membership removal takes effect in RLS immediately; global token revocation uses signing-key rotation (no new refresh/revocation feature). See [production auth](PRODUCTION-AUTH.md).

## Docker and operator execution

Dependencies: Docker/Compose with `!override` support for the optional proof script, PostgreSQL 17, a Node 24 Alpine build/runtime image, DNS and CA trust for a configured SMTP service. No Redis, external queue, paid API or runtime TypeScript toolchain. The application image runs as non-root with compiled JS and production dependencies. API and worker use read-only filesystem/tmpfs, dropped capabilities and no-new-privileges in prepared Compose.

Prepared files: `compose.private.yaml`, `docker/roles.sh`, `.env.production.example`, `Dockerfile`. Each runtime gets a distinct non-owner login; migrate alone receives the administrator password. API gets API/auth URLs, never worker/migration secrets; worker gets only outbox URL. Database has no published host port; API binds host loopback. The externally managed private HTTPS entrypoint is not changed by this task.

Before an authorized deployment, create an untracked secret file from `.env.production.example` with a distinct random hex password per role and a random signing secret (e.g. `openssl rand -hex 32` for each), correct private frontend origin and actual SMTP settings. Existing Postgres volumes do not rerun init scripts: an administrator must provision roles explicitly there before migration. Never mount demo fixtures or run seed/reset against production.

```sh
# Prepared command contract only — this task did not run these against a VPS:
docker compose --env-file .env.production -f compose.private.yaml config --quiet
docker compose --env-file .env.production -f compose.private.yaml up -d --build api worker
# Migrate service must finish successfully before API/worker start.
```

The local startup proof uses its own generated secrets, fresh named volume and random loopback API port, then deletes that stack. It configures an intentionally invalid SMTP host to prove startup without sending external mail. It must not be mistaken for the real mail-delivery smoke test required to unblock deployment.

## Reproducible evidence

From `backend/`, after `npm ci`:

```sh
npm run proof:docker
bash scripts/prove-container.sh
```

The first creates/removes its own PostgreSQL container, migrates all nine files, creates distinct restricted API/auth/worker logins, typechecks/builds, runs the original API suites plus production auth/RLS/outbox/SMTP suites, audits runtime dependencies and writes role/policy evidence to ignored `proof-artifacts/security.json`. The second builds the production image and verifies compiled non-root API, health, unauthenticated denial, no runtime dev toolchain, worker startup and graceful shutdown in isolated Compose. Neither accesses production. Recorded output and table/role/policy metadata are in [evidence](evidence/private-production/).

Security tests include hostile direct SQL across tenants, missing/stale transaction context, suspended/nonmember actors, unapproved guardians, opaque resource probes, cross-tenant references and history, immutable season reparenting, auth/worker separation, concurrent OTP use, persistent retries, worker competition, rollback and real database connection death/recovery. Production SMTP end-to-end is the remaining deployment blocker; no delivery is asserted until measured.

### Recorded results (2026-10-18)

- Backend: **84/84 passed** = 33 API compatibility/concurrency + 13 production authentication + 28 direct RLS/security + 8 worker + 2 real local TLS SMTP tests.
- TypeScript typecheck and production JS build: PASS.
- Production dependency audit: 0 vulnerabilities reported by `npm audit --omit=dev` at verification time.
- PostgreSQL metadata: 22 application tables ENABLE + FORCE RLS; the migration ledger is the sole non-domain exception. Runtime logins are non-owner/non-superuser/non-bypass. Privileged NOLOGIN function owners are recorded explicitly.
- Docker: clean role provisioning + migrations, compiled non-root API health/401, absent development toolchain, worker startup and graceful shutdown PASS. No real SMTP endpoint contacted.
- Populated frozen upgrade, scoped backfill, committed worker effects and atomic rejection of orphan data: PASS (see recorded upgrade report).
- Freeze preservation: Beta tag still points to the original exact commit; migrations 001–005 unchanged.

The container proof also caught and fixed two startup defects before delivery: PostgreSQL health initially observed its temporary init server (now checks TCP), and importing development reset modules blocked production API startup (now loaded only when development routes are enabled). API concurrency proof reproduced and fixed a first-response missing-row race with a transaction advisory lock; concurrent writes now produce one success and one conflict, and same-key retries produce one effect.
