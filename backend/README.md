# Talde Hemendik backend — private-production candidate

Candidate from frozen `integration/beta-vs03` / `ac49e34326b643b65d69089266fde088a2882ab3`. The Beta 0.1 Local tag is not moved.

**Deployment verdict: BLOCKED until real production SMTP configuration and end-to-end delivery/login are validated.** The development-only authentication blocker is implemented, not bypassed: production uses persistent OTP and verified TLS SMTP, fails closed, and forbids the development adapter. No VPS has been changed.

- [Candidate audit, migration and runtime contract](docs/PRIVATE-PRODUCTION-CANDIDATE.md)
- [Production authentication](docs/PRODUCTION-AUTH.md)
- [Outbox semantics and recovery](docs/OUTBOX-WORKER.md)
- [Recorded security evidence](docs/evidence/private-production/)

Reproduce on a workstation with Docker, Bash, Node >=22 and npm:

```sh
npm ci
npm run proof:docker       # fresh PostgreSQL, restricted logins, full backend tests
bash scripts/prove-container.sh  # compiled API + worker in disposable Compose stack
```

Production image contains compiled JavaScript and runtime dependencies only. `npm run build && npm start` starts the compiled API; `npm run outbox:production` starts its separate worker. Do not run seeds, reset commands or development OTP in production.

---

## Historical local slice instructions

The following describes the frozen local development workflow, not production readiness. Use the new candidate documentation for the role-separated production runtime.


Experimental backend isolated from the V2 frontend. Modular monolith: Fastify + TypeScript + PostgreSQL, SQL-first migrations.

## Local run

```bash
cp .env.example .env
docker compose up -d --wait db
npm install
npm run migrate
npm run seed
npm test
npm run dev
```

If the current login shell has not refreshed Docker group membership, use `sg docker -c 'docker compose up -d --wait db'` once.

- API: `http://127.0.0.1:3100`
- health: `GET /health`
- OpenAPI UI: `http://127.0.0.1:3100/documentation`

`DEV_AUTH_EXPOSE_OTP=true` returns the OTP only in the local development response. Leave it false outside an isolated workstation. The development adapter also emits its OTP through ephemeral structured console delivery; it never stores it in audit/outbox.

## Reproducible proof

```bash
npm run seed
npm test
npm run demo
npm run demo:vs02
npm run demo:vs03
```

The seed is deliberately minimal and isolated: S. D. Indautxu, season 2026/27 Infantil A, Mikel Zubeldia, Ibai Aranguren #9, Torneo Indautxu, plus a second team used only for access-isolation tests.

See [HTTP contracts](./docs/HTTP-CONTRACTS-VS01.md) and [RLS decision](./docs/RLS-DECISION-VS01.md).

VS02 adds [operational contracts](./docs/HTTP-CONTRACTS-VS02.md), [schema](./docs/SCHEMA-VS02.md) and a complete Event → Callup → ActionItem → Replacement proof through `npm run demo:vs02`.

VS03 adds a seed-free [BETA bootstrap](./docs/HTTP-CONTRACTS-VS03.md) and an isolated, explicitly enabled S. D. Indautxu DEMO reset. Run `npm run demo:vs03` to prove a clean signup-to-guardian-access flow without seed or hardcoded IDs.
