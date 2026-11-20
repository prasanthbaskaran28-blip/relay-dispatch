# Security audit follow-up

This document records the two confirmed findings and their fixes.

| Severity | Finding | Fix | Status |
|---|---|---|---|
| HIGH | Dispatcher API routes had no authentication or authorization. | Added fail-closed Bearer authentication using `DISPATCH_API_TOKEN`; all `/api` routes are guarded and return 401 for missing or invalid credentials. | Fixed |
| LOW | Manual-queue retries relied on JSON event details for replay detection and did not store a replayable response or enforce uniqueness in the database. | Added an idempotency key and compound unique index to retry events. Retries lock the job row, return the persisted response for a replay, and create one audit event. | Fixed |

## Remaining limitations

- Authentication uses one shared dispatcher token. It does not provide
  individual dispatcher identities, role-based authorization, or per-user
  audit attribution.
- The frontend stores the token in `sessionStorage`; an XSS vulnerability could
  expose it. Deploy behind HTTPS and rotate the token if it is compromised.
- Existing retry audit events are preserved during migration. Only the earliest
  event for a duplicated legacy key is assigned the new indexed key. Legacy
  events without a stored response can be replayed without another audit event,
  but recommendations are recalculated for those old retries.
- Configure a strong token before starting the API. If it is missing or shorter
  than 32 bytes, API access fails closed with HTTP 503.

The test database used for database-backed verification is
`relay_dispatch_test`; no development database reset or migration is part of
the test workflow.
