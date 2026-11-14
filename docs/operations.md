# Operations and release checks

Status: operational procedures and acceptance gates; automated alert delivery, immutable audit export and a completed disaster-recovery drill are not established.

## Public service status

The website's `/status` page calls the existing `GET /api/health` without account credentials on opening, manual retry and every 60 seconds while the page is visible. A 10-second request timeout bounds each check. Only a successful response with `status: "ready"` shows a passed check. Server 5xx responses show a failed check; network errors, timeouts, unexpected responses and malformed data show unknown status rather than asserting an outage or a healthy service. The page displays the check time and links to support.

Health verifies required API configuration and access to migration version 2 in the database. It does not test Clerk sign-in, email delivery, individual vault operations, provider usage, backups or alerts. There is no incident-history or uptime-percentage claim. No account data, database details or raw error payloads are exposed by the page. Existing no-store behavior and audit exclusions for health are preserved. This visible readiness check does not configure monitoring, paging, recovery drills or cost controls.

## Monitor

Monitor `/api/health`, application 5xx/latency, DB connections/storage, spending and edge denials. Configure alerts for `audit.persistence_failed`, sustained authentication failures and rate limits. Use the [audit guide](audit.md) for event coverage, retention, privileges and Clerk setup. Diagnostic logging must exclude credentials and payloads. Set diagnostic retention to 30 days and schedule audit pruning with the maintenance role.

## Back up and rehearse restore

1. Establish encrypted off-server database backups with separate access and retention. Protect the encryption/unlocking credentials independently.
2. Restore into an isolated database without production credentials, outbound Clerk delivery or public traffic.
3. Check schema versions, row counts, tenant boundaries and the restricted runtime role. Verify synthetic encrypted retrieval using an authorized test vault held outside the service.
4. Check restored credential revocation/expiry and stale-record consequences before cutover. An older backup can restore an older credential state; apply incident records/revocations deliberately.
5. Record actual recovery duration, lost-data interval, checks and failures. Operator audit commands report outcomes; they do not replace evidence.

Database restore cannot recover a missing client key. Do not copy users' private vault keys onto the service to make a drill pass. A completed drill and agreed recovery objectives remain production gates.

## Credential incidents and configuration changes

Follow [key-loss.md](key-loss.md). Rotate infrastructure credentials through provider secret facilities, validate the matching Clerk issuer/verifier/frontend, and redeploy deliberately. Keep production secrets out of Preview and untrusted CI. Review service-token revocations and provider rotations separately. Document every manual operational change with its commit/deployment reference and result.

## Release gate

Run the [feature catalogue](feature.md), required build/integration/distribution checks, full-history and artifact secret scans, applicable live acceptance and backup/restore checks. Independent protocol/security review remains required. Publish immutable client artifacts through [releases.md](releases.md); never overwrite an existing release. Audit metadata does not resolve the documented hostile-server value substitution or rollback boundary.
