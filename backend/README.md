# Talde Hemendik backend — Vertical Slice 01

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
