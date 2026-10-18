> Historical VS01 decision, superseded for the private-production candidate by migrations 006–009 and [the candidate contract](PRIVATE-PRODUCTION-CANDIDATE.md). RLS is now mandatory; backend authorization complements rather than replaces it.

# VS01 RLS decision

RLS is deferred to the next persistence-hardening slice. Primary authorization is implemented in the backend Policy layer and every exposed resource path has real PostgreSQL cross-team integration tests.

Reason: meaningful RLS requires request-scoped database identity/claims and a non-owner application role. Adding policies while the current development pool connects as table owner would create false confidence because owners bypass RLS by default. VS01 instead uses:

- scoped membership/link/roster policy queries;
- complete foreign keys and unique constraints;
- transactional mutations;
- negative cross-team tests using known UUIDs;
- loopback-only PostgreSQL in Compose.

Before any live pilot: create migration/app roles, set request-scoped actor and TeamSeason context per transaction, add FORCE RLS policies, and rerun the same policy suite against the restricted app role. Backend Policy remains authoritative.
