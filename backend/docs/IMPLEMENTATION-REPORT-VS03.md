# Vertical Slice 03 — clean BETA bootstrap

## Proven flow

`npm run demo:vs03` empties application rows, does not seed and does not call dev reset, then proves through HTTP:

auth → Team/TeamSeason/COACH bootstrap → Player/RosterEntry → individual invitation → tutor auth/request → coach approval → tutor access → fresh coach login → membership discovery.

## Invariants

1. Team has stable identity and sport; category/season/display label remain on TeamSeason.
2. Bootstrap is one transaction; partial Team/TeamSeason/Membership states cannot survive failure.
3. Bootstrap and roster creation are retry-idempotent with payload-conflict detection.
4. `/me/memberships` derives context from authenticated User; callers need no known IDs.
5. Player and RosterEntry remain separate; birth date is absent.
6. Individual token is returned once and only SHA-256 is persisted.
7. Public resolution never returns Player identity, shirt number, roster or guardian data.
8. General code is exact lookup only and never authorizes or enumerates.
9. General claim remains unresolved until COACH chooses an active same-TeamSeason Player.
10. Tutor access still requires ACTIVE Membership + GuardianLink + RosterEntry.
11. STAFF/GUARDIAN cannot add roster Players or manage link requests.
12. Known cross-team UUIDs do not grant read or mutation access.
13. Normal BETA is independent of C.D. Indautxu, seed and `/dev/reset`.
14. DEMO reset is absent by default and explicitly dev-only.

## Objective fixes discovered

- VS01's invitation-request `SELECT ... FOR UPDATE` ran outside the transaction. VS03 moved lookup, expiry validation and request insertion into one transaction so the lock is effective; public behavior is unchanged.
- OTP HTTP limiting by IP alone blocked multiple legitimate family emails behind one network. The dev HTTP boundary now has broader per-IP limits while DevelopmentAuthAdapter enforces five attempts per challenge. A real provider must add identity-aware throttling inside its AuthAdapter.

## Scope

No Supabase, remote hosting, frontend changes, APK, Notices, push, recurrence or cosmetic RLS. Logical Model v1 remains unchanged.
