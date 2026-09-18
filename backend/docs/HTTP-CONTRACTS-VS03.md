# HTTP contracts — Vertical Slice 03

VS01/VS02 remain valid. VS03 removes the requirement for hardcoded TeamSeason IDs or seeded BETA data.

## Bootstrap and discovery

| Operation | Contract | Permission / consistency |
|---|---|---|
| `POST /v1/teams/bootstrap` | `{team:{name,sport},teamSeason:{seasonLabel,category,displayLabel},createGeneralJoinCode?}` | Authenticated User; mandatory `Idempotency-Key`; atomically creates Team + TeamSeason + ACTIVE COACH Membership + optional general Invitation |
| `GET /v1/me/memberships` | active memberships with minimal Team/TeamSeason selector data | Current authenticated User only |

Bootstrap replay with the same key and payload returns the same IDs and optional join code. Reusing a key with different data returns `BOOTSTRAP_IDEMPOTENCY_CONFLICT`.

## Roster bootstrap

`POST /v1/team-seasons/{teamSeasonId}/players`

Request: `{firstName,lastName,shortName?,shirtNumber?,position?}` plus mandatory `Idempotency-Key`.

COACH only. It atomically creates Player under Team and ACTIVE RosterEntry under TeamSeason. Birth date and medical/federative data are absent. A retry returns the same Player/RosterEntry; key reuse with different data returns `ROSTER_IDEMPOTENCY_CONFLICT`.

## Individual family invitation

The VS01 endpoints are unchanged and now work with runtime-created IDs:

- `POST /team-seasons/{ts}/players/{player}/invitations` — COACH only;
- `GET /invitations/{token}` — safe Team/season metadata only;
- `POST /invitations/{token}/guardian-link-requests` — authenticated tutor, remains PENDING;
- COACH approval activates Membership + GuardianLink transactionally.

## General-code fallback

| Operation | Contract |
|---|---|
| `GET /v1/team-join/{code}` | exact-code lookup returning only Team name/sport and TeamSeason labels |
| `POST /v1/team-join/{code}/guardian-link-requests` | `{claimedPlayerName,claimedShirtNumber?}` → PENDING request with no resolved Player ID |
| `POST /v1/guardian-link-requests/{id}/approve` | for a general claim COACH supplies `{playerId}`; backend revalidates active roster in the request TeamSeason |

There is no roster listing, autocomplete, partial-match or match-status endpoint. The short code never grants access.

## DEMO reset

`POST /v1/dev/reset` is not registered unless `DEV_RESET_ENABLED=true` (or explicitly enabled in a test harness). It transactionally recreates the independent C.D. Indautxu / Infantil A / 2026/27 / INDA16 DEMO. Default BETA returns 404 and never calls it.

## Added stable errors

`BOOTSTRAP_IDEMPOTENCY_CONFLICT`, `ROSTER_IDEMPOTENCY_CONFLICT`, `GENERAL_JOIN_INVALID`, `PLAYER_CLAIM_REQUIRED`.
