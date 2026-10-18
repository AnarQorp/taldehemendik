# Recorded private-production proof — 2026-10-18

Source baseline: ac49e34326b643b65d69089266fde088a2882ab3.

- `backend-proof.txt`: clean disposable PostgreSQL, ordered migrations001–009, separate actual restricted API/auth/worker logins, typecheck, JS build, **84 passed tests** (10 +14 +9 +51), production dependency audit0.
- `security.json`: observed table ENABLE/FORCE flags, role attributes, policy names and migration ledger. Includes deliberately privileged NOLOGIN helper owners, never runtime credentials. The schema_migrations ledger is not tenant data and is not FORCE RLS.
- `container-proof.txt`: actual isolated Compose image build, fresh role provisioning/migrations, compiled non-root API health/401, no runtime tsx/typescript, worker startup and graceful shutdown. Temporary stack/volume removed. SMTP host intentionally invalid; no real mail delivery claimed.
- `populated-upgrade-proof.txt`: exact frozen schema+seed+API producers upgraded with five pending events; tenant provenance, business counts and real restricted worker effects verified; orphan-containing clone rejected atomically.

Tests use synthetic fixture data. No production data or secrets are included. A previous development run exposed a missing-row concurrent update race; the final suite includes two HTTP regressions. Final readiness remains **BLOCKED for real deployment until configured production SMTP completes an end-to-end mail/OTP login smoke test**. No VPS was touched.
