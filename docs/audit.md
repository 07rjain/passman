# Audit events and account activity

Status: implemented in source with migration 2. Production migration and restricted runtime grants were verified on 2026-11-01; webhook subscription, scheduled retention and rollout acceptance remain separate configuration steps. Audit evidence is metadata, never secret contents.

## Coverage

| Event | Meaning |
| --- | --- |
| `setup.start/inspect/approve/claim` | Bound local-vault enrollment stages; claim may be pending |
| `workspace.list`, `project.create` | Workspace read or project creation |
| `credential.create/revoke` | Read-token issuance or credential revocation |
| `secret.write/delete/retrieve/search/exists`, `upload.context` | Encrypted write, deletion, ciphertext retrieval or metadata lookup |
| `activity.list` | Account activity access |
| `session.created/ended/removed/revoked` | Verified Clerk session webhook delivery |
| `request.unknown` | Unrecognized application operation |
| `operation.deploy/backup/restore/configuration/migrate` | Explicit operator-reported operation result |

Outcome is `success`, `denied` or `error`, with a safe reason code. Known revoked/expired credentials record `CREDENTIAL_REVOKED`/`CREDENTIAL_EXPIRED` internally while preserving the generic public 401 response. Events have an ID, generated request ID, server timestamp, verified actor/account when known, and applicable credential/resource UUID. Names, full URLs, query strings, request/response bodies, ciphertext, tokens, private keys, passwords, session IDs, verification codes and raw errors are excluded. Resource IDs identify projects, credentials or setup requests; secret names are not duplicated. `secret.write` covers both creation and replacement.

A successful retrieval means ciphertext was prepared for return, not proof of network delivery, local decryption or provider usage. Health checks and pre-dispatch Host/configuration failures are excluded; provider logs/monitoring cover those boundaries. Failed authentication cannot always be attributed to an account. Anonymous traffic is represented by at most one event per minute/action/outcome/reason across the deployment, not a complete count; edge protection is required before DB work. Repeated expired/revoked bearer denials retain one representative event per credential/minute/action/reason, including the verified account and credential IDs. Attempts rejected by a quota before lookup are anonymous `RATE_LIMITED` events. Successful authenticated events are not sampled. No historical events are backfilled.

## Storage and failure policy

Successful mutations and events commit in the same PostgreSQL transaction. Failure to persist that event rolls back the mutation. Denied requests are recorded after rollback. Other reads fail with 503 if their audit write fails. A fixed `audit.persistence_failed` diagnostic with request ID signals persistence failures; no raw exception is logged. Configure an operator alert for this diagnostic and elevated 503/401/429 rates.

Runtime privileges are SELECT/INSERT plus identity-sequence USAGE, with no audit UPDATE/DELETE. The owner retains maintenance access. A database/server administrator can forge or remove records: this is not tamper-proof storage. Separately controlled immutable export and automated alert delivery remain planned; the database alone is not independent evidence.

## Activity API

`GET /api/console/activity` requires a Clerk human session and a registered account. Optional parameters: `action` (exact documented event), `outcome` and `before` (positive sequence cursor). Returns up to 50 `items` and `nextCursor`. Results are account-isolated, newest sequence first, and no-store. The dashboard Activity section offers action/outcome filters and older-page navigation. Pagination is a moving view, not an exported snapshot. Events arriving during pagination appear on refresh.

## Clerk configuration

Create a production webhook endpoint at `https://passman.subdomain.wtf/api/webhooks/clerk`. Subscribe only to `session.created`, `session.ended`, `session.removed`, `session.revoked`; store its endpoint signing secret as server-only `CLERK_WEBHOOK_SIGNING_SECRET` in Production. Preview needs a separate Clerk instance, secret and database. Verification uses Clerk's SDK, including signature timestamp validation; delivery IDs deduplicate retries atomically. Database failure returns 503 so Clerk can retry. No account is created or authorized by these events.

Failed Clerk sign-ins/Protect decisions are **not** session webhooks. They remain in [Clerk Application Logs](https://clerk.com/docs/guides/dashboard/logs/application-logs); they are not copied into Passman by this implementation. Operator actions also require explicit reporting; Vercel/Neon changes are not automatically discovered.

## Migration and retention

Run `npm run db:migrate` using the separate migration owner before deploying this API. Health requires migration 2. After migration, replace `YOUR_RUNTIME_ROLE` with the existing restricted role:

```sql
GRANT SELECT, INSERT ON keyman_mvp.audit_events TO YOUR_RUNTIME_ROLE;
GRANT USAGE ON SEQUENCE keyman_mvp.audit_events_sequence_seq TO YOUR_RUNTIME_ROLE;
REVOKE UPDATE, DELETE, TRUNCATE ON keyman_mvp.audit_events FROM YOUR_RUNTIME_ROLE;
```

Do not grant broad ALL TABLES privileges or put the owner connection in Vercel. The additive migration preserves vaults, identities, ciphertext and earlier version 1. Older API versions can still use the existing tables.

Schedule `npm run audit:prune` daily in a trusted maintenance environment with `MIGRATION_DATABASE_URL`. Default `AUDIT_RETENTION_DAYS=90`, valid range 1–3650. This deletes expired audit rows; backups have separate expiry policies. Runtime cannot prune. Diagnostic logs should use a provider-configured 30-day retention; the application does not enforce that provider setting. Pruning also expires webhook deduplication records, so a deliberately re-signed old replay after retention may be recorded again.

Operators can run `npm run audit:operation -- operation.backup success` after verifying a backup. Use `error` for failure. The command records a report, does not perform or verify the operation itself, and never accepts arbitrary payloads. Keep actual restore evidence and deployment commits in release/run records.
