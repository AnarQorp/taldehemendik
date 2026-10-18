#!/usr/bin/env bash
# Disposable local Compose proof; never uses deployment secrets or an existing volume.
set -euo pipefail
cd "$(dirname "$0")/.."
project="talde-container-proof-$$"
proof_dir="$(mktemp -d)"
chmod 700 "$proof_dir"
compose=(docker compose --env-file "$proof_dir/env" -p "$project" -f compose.private.yaml -f "$proof_dir/override.yaml")
cleanup() { result=$?; if [ "$result" -ne 0 ]; then "${compose[@]}" logs --no-color api worker migrate || true; fi; "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true; rm -f "$proof_dir/env" "$proof_dir/override.yaml"; rmdir "$proof_dir"; }
trap cleanup EXIT
node --input-type=module - "$proof_dir/env" <<'JS'
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const names=['DB_MIGRATION_PASSWORD','DB_API_PASSWORD','DB_AUTH_PASSWORD','DB_WORKER_PASSWORD','AUTH_TOKEN_SECRET'];
writeFileSync(process.argv[2],names.map(k=>`${k}=${randomBytes(32).toString('hex')}`).join('\n')+'\nALLOWED_ORIGINS=https://private.example.invalid\nSMTP_HOST=smtp.example.invalid\nSMTP_FROM=no-reply@example.invalid\n',{mode:0o600});
JS
cat > "$proof_dir/override.yaml" <<'YAML'
services:
  api:
    ports: !override ["127.0.0.1::3101"]
YAML
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --wait --wait-timeout 120 api worker
"${compose[@]}" exec -T api node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
assert.equal(process.getuid(),1000);
assert.equal(existsSync('node_modules/tsx'),false);
assert.equal(existsSync('node_modules/typescript'),false);
const health=await fetch('http://127.0.0.1:3101/health'); assert.equal(health.status,200);
const denied=await fetch('http://127.0.0.1:3101/v1/me/memberships'); assert.equal(denied.status,401);
console.log('PASS: compiled non-root API, health, unauthenticated denial, no development toolchain');
JS
worker_id="$("${compose[@]}" ps -q worker)"
test "$(docker inspect --format '{{.State.Running}} {{.RestartCount}}' "$worker_id")" = 'true 0'
"${compose[@]}" stop -t 15 worker
exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$worker_id")"
test "$exit_code" = 0
printf '%s\n' 'PASS: isolated Compose migrations, role-separated production API/worker and graceful worker shutdown. SMTP delivery deliberately not tested by this startup proof.'
