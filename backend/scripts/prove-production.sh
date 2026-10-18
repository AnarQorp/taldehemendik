#!/usr/bin/env bash
# [TEST ONLY] Own isolated container/database. No access to production hosts.
set -euo pipefail
cd "$(dirname "$0")/.."
name="talde-proof-$(date +%s)-$$"
password="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
mkdir -p proof-artifacts
export NODE_ENV=test
docker run -d --name "$name" -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=talde_proof -p 127.0.0.1::5432 postgres:17-alpine > proof-artifacts/container.txt
for attempt in $(seq 1 40); do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d talde_proof >/dev/null 2>&1; then break; fi
  sleep .25
done
port="$(docker port "$name" 5432/tcp | head -1 | sed 's/.*://')"
export MIGRATION_DATABASE_URL="postgres://postgres:$password@127.0.0.1:$port/talde_proof"
DATABASE_URL="$MIGRATION_DATABASE_URL" npm run migrate
# Actual logins: not superusers, not table owners, only the matching group role.
docker exec -i "$name" psql -U postgres -d talde_proof -v ON_ERROR_STOP=1 -v password="$password" <<'SQL'
SELECT format('CREATE ROLE proof_api LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION', :'password') \gexec
SELECT format('CREATE ROLE proof_auth LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION', :'password') \gexec
SELECT format('CREATE ROLE proof_worker LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION', :'password') \gexec
GRANT talde_api TO proof_api;
GRANT talde_auth TO proof_auth;
GRANT talde_worker TO proof_worker;
SQL
export DATABASE_URL="postgres://proof_api:$password@127.0.0.1:$port/talde_proof"
export AUTH_DATABASE_URL="postgres://proof_auth:$password@127.0.0.1:$port/talde_proof"
export OUTBOX_DATABASE_URL="postgres://proof_worker:$password@127.0.0.1:$port/talde_proof"
npm run typecheck
npm run build
npm run test:all
npm audit --omit=dev
node --import tsx scripts/security-evidence.ts > proof-artifacts/security.json
printf '%s\n' 'PASS: isolated PostgreSQL, migrations, restricted-logins API/auth/worker integration and security proof.'
