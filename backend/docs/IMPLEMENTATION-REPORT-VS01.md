# Vertical Slice 01 — implementation report

Status: implemented and verified on 2026-09-18. Experimental backend branch; not merged into the V2.

## Functional proof

`npm run demo` executes through Fastify's real HTTP interface and PostgreSQL:

1. Mikel authenticates as COACH.
2. He creates an individual invitation for Ibai.
3. Public resolution returns only C.D. Indautxu / Infantil A / 2026/27.
4. Elena authenticates; access remains denied.
5. Elena creates a pending GuardianLinkRequest; access remains denied.
6. Mikel approves; replay returns the same relationship without duplicates.
7. Elena can read Ibai but cannot read another TeamSeason's Player.
8. Elena records `CAN_ATTEND`; Mikel reads the current status, actor, source and server timestamp.
9. STAFF may record a delegated response; Elena may change it while open.
10. History, audit and outbox are inspected from PostgreSQL.

## Verified invariants

- Role is seasonal Membership, not User state.
- Plain invitation token is returned once and only SHA-256 is stored.
- Public invitation resolution contains no Player name, number, roster or guardian PII.
- Authentication and PENDING request never grant Player access.
- Guardian Player access requires ACTIVE Membership + ACTIVE GuardianLink + ACTIVE RosterEntry in the same TeamSeason.
- Only COACH may list/approve/reject guardian link requests; STAFF and GUARDIAN receive 403.
- Approval is one transaction and natural-key idempotent; a forced DB failure proves full rollback.
- Known UUIDs do not cross TeamSeason boundaries for COACH, STAFF or GUARDIAN.
- Availability status is current state plus append-only history.
- `NO_RESPONSE` is derived and never persisted.
- STAFF delegated records preserve actor/source/server time; an authorized guardian may update later.
- Expected version prevents silent concurrent overwrite with `409 AVAILABILITY_VERSION_CONFLICT`.
- Availability closure is enforced by backend.
- Availability retry is idempotent; key reuse with different payload is rejected.
- `GuardianLinkApproved` and `AvailabilityChanged` are written to outbox inside their mutations.
- Audit/outbox contain no OTP or plaintext invitation token.

## Test evidence

- TypeScript strict typecheck: PASS.
- PostgreSQL integration/domain suites: 2 files, 10 tests: PASS.
- Runtime and development dependency audit: 0 known vulnerabilities.
- `git diff --check`: PASS.

## Scope decisions and deviations

No domain deviation from Logical Model v1 was required.

- RLS is deliberately deferred, not silently omitted. See `RLS-DECISION-VS01.md`; the restricted app role and request-scoped DB context are prerequisites for RLS to add real defence.
- DevelopmentAuthAdapter uses an in-memory OTP challenge and locally signed development access token. Both are adapter concerns and are not the contract of a future provider.
- OpenAPI UI is generated for route discovery. Domain request/response/error/idempotency semantics remain explicitly documented in `HTTP-CONTRACTS-VS01.md`; no Zod-to-OpenAPI coupling was added merely for richer generated schemas.
- The general-team fallback invitation remains architecturally defined but is outside this explicitly individual-invitation slice. No Player-enumeration endpoint exists.
- No notification worker is added: transactional outbox insertion is implemented and tested, as requested; delivery belongs to a later slice.

## Intentionally absent

Frontend integration, Callups, Notices, ActionItems, attendance, recurrence, real email/push, APK, cloud infrastructure, payments, club administration, statistics and AI.
