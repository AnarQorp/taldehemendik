# Private production: email OTP authentication

Production uses `ProductionAuthAdapter`, never `DevelopmentAuthAdapter`. This preserves the email OTP MVP, but codes are delivered through an operator-provided existing or self-hosted SMTP server. No paid service is required or automatically subscribed. `buildApp` must reject development adapter injection and development endpoints in production.

## Required configuration

- `NODE_ENV=production`.
- `AUTH_TOKEN_SECRET`: at least 32 characters generated with a CSPRNG (recommend 32 random bytes hex/base64), unique to this deployment. Development/default/example secrets are rejected. Never commit secrets.
- `DATABASE_URL`: dedicated runtime login member only of `talde_api`.
- `AUTH_DATABASE_URL`: separate runtime login member only of `talde_auth`.
- In the separate worker container only: `OUTBOX_DATABASE_URL` (or `WORKER_DATABASE_URL`) selects a dedicated login member only of `talde_worker`. Do not provide worker credentials to the API container; API startup requires only its API and authentication URLs.
- `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_FROM`; optional `SMTP_USER` and `SMTP_PASSWORD` together. `SMTP_SECURE=true` uses SMTPS (typically port 465); otherwise STARTTLS is mandatory. Certificate verification and TLS >=1.2 are enforced. A production SMTP server with a valid certificate must be provisioned; localhost plaintext mailcatchers are not a production delivery path.
- Optional `AUTH_TOKEN_ISSUER`, `AUTH_TOKEN_AUDIENCE`; defaults `talde-hemendik` and `talde-private-api`. Changing these or the secret invalidates existing sessions.
- `ALLOWED_ORIGINS`: comma-separated explicit origins. Production has no localhost default.

Production startup fails closed for missing critical config and attempts to enable `DEV_AUTH_EXPOSE_OTP` / `DEV_RESET_ENABLED`. Never grant a runtime login migration-owner, `talde_auth_owner`, `talde_policy_owner`, superuser, BYPASSRLS or unrelated role membership. Run migrations with a separate administrator/migrator connection. Never provide `MIGRATION_DATABASE_URL` or migration credentials to the deployed API/worker containers.

## Challenge lifecycle and guarantees

Each request creates a random UUID and uniformly random six-digit code, expires after five minutes, and stores only HMAC-SHA256 of UUID, normalized email and code. Secret material and plaintext codes never enter API responses, logs, outbox or audit. SMTP errors are replaced with a generic unavailable response. Delivery failure marks the challenge consumed.

Issuance is serialized using a transaction advisory lock per mailbox: maximum one request/minute and five/hour, surviving process restarts. A replacement request invalidates previous codes. Verification locks the row, persists failed attempts, rejects after five failures, and atomically consumes successful codes. Parallel/replayed verification has at most one success. A crash before delivery can strand a challenge until the one-minute issuance throttle expires; retry requests never reactivate spent codes. Periodically delete expired challenges older than operational retention (e.g. 24h) using a tightly restricted auth-maintenance operation; throttle evidence must remain at least one hour. An already issued valid challenge does not depend on process memory.

Access tokens are signed HMAC-SHA256 opaque two-part tokens, not advertised as interoperable JWTs. They carry UUID subject, issuer, audience, issue and expiry times. Verification validates exact framing, bounded length, signature length and constant-time comparison, all claims, max one-hour lifetime and future timestamps. Unknown/malformed/expired values return a generic authentication error. There is no refresh or revocation endpoint in this MVP; deleting membership immediately revokes access to team data through RLS, while explicit global token revocation requires rotating the signing secret or waiting <=1h.

## Database boundary

Migration 008 creates FORCE-RLS `auth_challenges`, usable only by `talde_auth`. OTP SQL always runs inside BEGIN / SET LOCAL ROLE talde_auth / COMMIT. API and outbox runtime cannot read the challenge hashes. A dedicated NOLOGIN `talde_auth_owner` owns only the narrow SECURITY DEFINER identity mapping function with fixed trusted search path, and has SELECT/INSERT/UPDATE users privileges; no runtime login may be a member. PUBLIC execute is revoked. Identity subjects use `email:<normalized-email>`. `dev-email:` subjects remain solely for nonproduction fixtures; production adapter never issues them. Do not migrate development fixture identities into real private accounts; start production without demo seed data.

## Verification and readiness

`test/integration/auth-production.test.ts` injects a transport to capture messages without sending mail. It proves persistence across new adapter instances, single-use concurrent consumption, five-attempt lockout, expiry, identity mismatch, issuance concurrency, safe delivery failure, runtime role denial and strict access-token validation. `smtp-production.test.ts` additionally exercises actual Nodemailer over a local SMTPS connection with a temporary trusted CA, completes HTTP OTP login, and rejects an untrusted certificate. Neither test proves an operator's SMTP service works. Before real deployment perform an end-to-end delivery and OTP login smoke test with the configured SMTP service and production role-separated connection URLs; missing SMTP delivery/configuration is a deployment blocker, not permission to enable development authentication.

Runtime dependency: `nodemailer`; development type dependency `@types/nodemailer`. SMTP uses outbound network/TLS, requires trusted CA certificates and DNS resolution inside the backend Docker image. No extra database or paid external infrastructure is required.
