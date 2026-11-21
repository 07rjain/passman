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

## Owner-authorized legacy cleanup — 2026-11-20

The owner explicitly selected clearing all legacy accounts' application data after reviewing the live inventory. Deleted 7 `keyman_mvp` vault/account bindings, 10 projects, 6 encrypted secret records, 17 application credentials and 1 setup session in one transaction. A separate read verified all five live-data counts at zero. Clerk sign-in identities, the schema/migrations, quota counters and prior audit history were preserved. Seven atomic `operation.configuration` events identify the cleared bindings under request `f8de0a66-d615-4be1-abfd-116377f07a24`; the verified audit total was 87.

The live health endpoint returned 200 after cleanup. The fresh `/api/passman/v1/account` endpoint still returned 404 before cleanup, and the fresh `passman_v1` schema was absent: this operation did not deploy, migrate or publish the new SDK/API. Local vault files on users' machines were not deleted. Test the new implementation using [the fresh guide](fresh-quickstart.md) and a separately configured fresh server.
