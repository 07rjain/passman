# Fresh implementation: verification record

Latest status: [signed alpha publication and hosted rollout, 2026-11-21](#signed-alpha-publication-and-hosted-rollout--2026-11-21). Earlier dated entries below retain their original verification scope.

## Connection approval verification fix — 2026-11-21

FRESH-55 source verification: `npm run check` passed (71 unit tests passed, five native/platform cases skipped on this runner; build, type checks, lint, package/distribution and documentation checks passed). Two new request tests cover Clerk challenges, fresh-token request submission, explicit approval validation, distinct denial guidance and redaction. PostgreSQL native-login regression checks that stale sign-in returns the verification hint alongside the existing 403 error, is audited as denied and leaves the login unapproved; a wrong code returns 403 without a verification hint.

All 19 fresh PostgreSQL integration tests passed with a separate temporary PostgreSQL 16 cluster bound to loopback, including built Next/Clerk-format JWT/CLI and native-login tests. Docker was inaccessible to this process, so the existing extracted PostgreSQL binaries ran as the unprivileged user; the temporary cluster was stopped and removed. No deployed database or user vault was modified. Hosted deployment and actual Clerk reverification on the owner's Mac are separate acceptance steps; this record does not claim they passed.

Date: 2026-11-20. Runtime: Node.js 24.22.3/npm 11.19.1 on Linux x64. Source packages are `@passman/protocol` and `@passman/sdk` 1.0.0-alpha.1. This is local synthetic verification, not a release, deployment, independent cryptographic audit or production acceptance. Follow [the alpha guide](fresh-quickstart.md) for runnable setup and limitations.

## Implemented boundaries

The replacement uses its own `/api/passman/v1` routes, `passman_v1` database schema, OS-keystore namespace and explicit `.passman-v1` file mode. It neither reads old vault/data formats nor modifies old account bindings. The existing implementation stays available pending an intentional cutover.

Implemented source covers pinned HPKE/Ed25519 records, runtime/admin role separation, password-protected synchronization/restoration, saved scoped credentials, account-specific routing, signed CRUD/tombstones, exact pending activation/rejection, browser-assisted native login, automatic keyring refresh, credential expiry/revocation, informational installation inventory, code transfers with durable acknowledgement, routine and compromise key rotation, staged writer-root replacement and restricted transactional auditing.

## Local evidence

| Command | Observed result / scope |
| --- | --- |
| `npm run build` | Protocol, SDK, previous packages and optimized Next app build, including fresh API and management routes |
| `npm run typecheck` | Strict workspace and web TypeScript checks |
| `npm run check` | Full format/build/typecheck/lint/unit/old-and-fresh artifact/docs pipeline passed |
| `npm test` | 69 passed, 4 skipped: native-keystore fixture cases run separately and the Windows-only existing test cannot run on Linux |
| `npm run test:fresh:native` | 3 passed in an isolated D-Bus/gnome-keyring session: durable secret/runtime storage, competing writes, locked collection denial without UI unlock |
| `npm run test:fresh:package` | Protocol and SDK tarballs installed in an isolated consumer; public imports, password restoration, writer-replacement/login exports, actual CLI bin shim and TypeScript declarations |
| `npm run test:fresh:isolated` | 19 passed, no skips, against disposable PostgreSQL 17: built Next/Clerk-verifier/CLI journey, login, API workflow and staged writer replacement |

The PostgreSQL launcher binds a random loopback port, uses synthetic credentials/database `passman_v1_test`, and removes its container. Suites reject other database names. Requests run through a restricted login, not the migration owner. The direct API suites inject synthetic human authentication. The built-Next HTTP case separately verifies real RSA-signed Clerk-format tokens against the configured verifier and runs the compiled CLI twice in fresh processes.

Source suites:

- [Protocol](../test/fresh-protocol.test.ts): canonical credentials, RFC 8032 interoperability, exact empty/UTF-8 values, context/signature tampering, key correspondence and pinned generation floors.
- [Profiles](../test/fresh-profiles.test.ts): explicit/default credential routing, no fallback on error, no implicit switch after deleting a default and distinct index namespace.
- [Transfer sessions](../test/fresh-transfer-session.test.ts): exact receiver-session forgetting, terminal denial cleanup and interrupted-claim proof preservation.
- [Vault/runtime](../test/fresh-vault.test.ts): separate password restoration, wrong passwords, epoch rewrap/rotation, hostile and replayed records, one-shot sync, deployment custody and filesystem checks.
- [Native custody](../test/fresh-native.test.ts): actual isolated Linux Secret Service, locking, persistence and no interactive fallback.
- [API/SDK](../test/fresh-workflow.integration.ts): account/scope privacy, create races/idempotency, activation/rejection, tombstones/recreation, bootstrap capability, restoration, replay races, audit rollback/redaction, credential replacement, sync replacement and interrupted transfers.
- [Native login](../test/fresh-login.integration.ts): browser-only approval, connection proof, hash-only management tokens, expiry, wrong identity/scheme/claim, poll retries and concurrent use without exhausting the pool.
- [Writer replacement](../test/fresh-writer.integration.ts): bounded record batches, pending/stale-state denial, full-account atomic cutover, new credential, lost commit response, old-key denial and explicit new-root pinning.
- [Built HTTP/CLI](../test/fresh-http.integration.ts): actual Next route, pinned Clerk verifier, locally signed administrative writes, exact plaintext in restarted CLI processes and redacted invalid-credential failures.

## FRESH acceptance mapping

The catalogue remains the acceptance contract; an implementation-level test does not close a platform/manual requirement.

| Cases | Evidence and remaining qualification |
| --- | --- |
| FRESH-01–12, 16, 26–29, 31–34 | Protocol, vault, PostgreSQL and package tests cover the local JS/API contracts. Installed native platform journeys remain separate. |
| FRESH-13–15, 48–54 | Role separation, full password restoration, stale-epoch rejection and transactional sync/root changes are covered. Native forgotten-password operator verification and every platform's loss/reset journey are not closed. Read-only surviving keys cannot reconstruct the separate signer. |
| FRESH-17–20, 24 | Linux Secret Service, explicit POSIX custody, injected runtime adapters and packed Node artifacts are exercised. The separate [Agent37 run](fresh-multimachine-verification.md) exercises Linux file custody across a cold VM reboot and real Docker mounts/restarts. Native Windows/macOS, Kubernetes and selected cloud-function deployments still need their runners. |
| FRESH-21–23 | Routine/compromise rotations, generation CAS, lost responses and staged writer replacement are covered in PostgreSQL. Provider-side secret rotation is an operator task; tests never call a real provider. |
| FRESH-25, 43–47 | API create-only/idempotency/activation/inventory boundaries and built pages are exercised. Real Clerk browser forms, exact UX and responsive interaction still require browser acceptance. |
| FRESH-30 | Credential revocation and explicit local profile removal exist. Actual decommission of each deployment's secret facility remains operator verification; no proof of all-copy destruction is possible. |
| FRESH-35–42 | SDK/relay tests exercise private-code transfer, account/origin checks, single-recipient claims, interrupted claim/save/ack and erased relay payload. Cross-platform transfer/install/restart remains part of native acceptance. |

Secret revision observations are bounded in memory per client instance. They reject observed same-instance rollback but do not survive process restart or guarantee completeness/latest state. Fresh/stateless clients have no independent global witness. The account-wide key's blast radius and same-OS-user trust are accepted design limits, not permission isolation claims.

## Model verification

Opus 5.5 and Gemini 4 Neon ran through Factory/Droid with high reasoning; GPT-6.2 Sol performed protocol review and separate PostgreSQL/native verification. Early reviews found actionable flaws in pending rejection, epoch activation, initialization retry, rate-limit transactions, native helper execution/storage and transfer recovery. Those findings led to source fixes and regression tests. These are model reviews of source snapshots, not certification or a substitute for an external security audit. Final Opus review found no remaining critical/high server authorization, replay, epoch or writer-transition blockers. Final Neon review identified native helper correctness, staged-operation recovery and implicit default-account selection issues; source fixes and regression tests followed. Linux-native, full pipeline and PostgreSQL/HTTP suites were rerun successfully. Windows/macOS native execution remains unverified, so those fixes are not claims of native acceptance.

## Release gates still open

- Run the configured [fresh CI workflow](../.github/workflows/fresh.yml), including native macOS Keychain and Windows DPAPI. Local Linux success cannot establish their behavior. Native CLI password reset currently has a Unix verifier; Windows integrations must supply a verified operator callback.
- Exercise live Clerk login/reverification, pending form, code transfer and read-only inventory in a real browser, including mobile/keyboard layout. No real email/CAPTCHA/signup delivery is claimed.
- Repeat service-user/reboot and protected-mount acceptance on the intended production platform. The [Agent37 run](fresh-multimachine-verification.md) covers an unprivileged Linux worker, cold VM reboot and actual Docker mount/restart. Automatic service startup, Kubernetes and a chosen ordinary Node cloud function remain open. Edge runtimes are deferred.
- Review installation/update artifacts and choose a publication/cutover plan. Source tarballs are local alpha artifacts, with no public registry/package release or deployed server change.
- Configure remote database TLS, production admission/edge quotas, scheduled cleanup/audit retention, alerts, encrypted backups and a real restore drill. The deployment-wide limiter and bounded login pool do not replace edge abuse protection.

A separate Linux smoke test also loaded a root-owned Kubernetes-style projected secret under an unprivileged UID, using root-owned relative links and a 0440 target beneath a 0750 directory. This checks that filesystem policy, not a real Kubernetes rollout.

The safe next user activity is controlled testing with synthetic values in a separately configured fresh environment. This document does not approve storing production credentials or deployment.

## Live availability check — 2026-11-20

A user-authorized shared-browser test against `https://passman.subdomain.wtf` observed health 200, fresh dashboard `/passman` 404, and fresh account API `/api/passman/v1/account` 404 `NOT_FOUND`. The public page still advertised the earlier `KeymanClient` interface. The supplied test identity was not registered in the live sign-in flow. No sign-up submission, mailbox read, application secret creation or new-SDK authenticated lifecycle was completed. The private AgentMail input timed out without a value; mailbox access is unnecessary until the fresh deployment is available. The browser tab was closed after the check.

Result: **live fresh-SDK testing blocked by missing deployment**, distinct from the successful local synthetic suites above. Deployment of the matching source, fresh schema/grants and runtime configuration is a prerequisite; this test did not authorize or perform that rollout.

## Live email sign-in follow-up — 2026-11-20

With the user's AgentMail authorization, both supplied existing AgentMail identities completed the normal live Clerk email-code sign-in flow in an incognito shared-browser tab. Password reset, sign-up, Clerk backend administration and authentication bypasses were not used. Each account reached its own initial local-vault setup screen after the legacy cleanup. Mail access was limited to the requested inboxes and fresh Passman verification messages; API credentials and verification codes are excluded from this record.

For both authenticated sessions, `/api/passman/v1/account` still returned 404 `NOT_FOUND`. Thus browser/email sign-in passed for the existing deployment, but the fresh SDK's authenticated storage/retrieval journey remains blocked by its missing API deployment. No vault binding, project, service credential or secret was created during this follow-up. Both accounts were signed out, and the test tab was closed.

## Two-machine and multiple-vault acceptance — 2026-11-20

A new temporary Agent37 VM and the controlling Linux machine passed 44 distinct synthetic checks with packed fresh SDK artifacts and an isolated real PostgreSQL API. Evidence covers code transfer/retry/expiry/single-use, password bootstrap, three account vaults in one store, account routing/no fallback, routine and compromise rotation, credential replacement, inventory identity, an unprivileged read-only mounted container, and reads after a confirmed cold VM reboot. The fixture API used verified synthetic human JWTs and explicit transport adapters; this is not a live Clerk/production test. The VM was deleted, and transient fixture key material was removed. See [the full record and repeatable user steps](fresh-multimachine-verification.md).

## macOS CI fixture isolation — 2026-11-21

The first native macOS CI run passed the build/unit/package checks but failed its Keychain persistence case with `STORAGE_UNAVAILABLE`. The macOS runner now creates an isolated disposable keychain, unlocks it explicitly, selects it only for the native suite, then restores the previous default/search list and deletes the fixture. This tests supported unlocked storage without depending on an unattended runner login keychain or weakening runtime no-prompt behavior. Native acceptance is pending the next CI result.

The isolated macOS fixture still returned native `errSecParam` (-50) for each query. The adapter now uses only supported file-keychain query options and keeps process-wide interaction disabled. The macOS suite adds locked-keychain read/write denial; successful native CI is still required to confirm this correction.

## Windows package-fixture quoting — 2026-11-21

Both Windows jobs on `02dbbd8` passed their build/unit/earlier-package stages, then failed when the fresh package fixture launched npm’s `.cmd` shim. Node escaped the intentionally quoted `cmd /s /c` payload a second time. The fixture now passes that payload verbatim and uses a consumer directory containing spaces. It still executes the installed shim and checks its actual help output; native DPAPI acceptance remains pending the subsequent CI stages.

The reduced queries also returned -50. Boundary inspection identified raw Security `CFStringRef` constants being passed as `NSDictionary` keys/values. The helper now casts those constants to their toll-free Objective-C objects and uses a Foundation Boolean for return-data requests. The synthetic bridge probe uses the same conversions. Native macOS read/write and locked-keychain tests remain enabled; CI must confirm the corrected bridge.

## Windows native-helper verification — 2026-11-21

After the package-quoting correction, Windows package/distribution checks passed and the native suite reached the DPAPI helper, which returned `STORAGE_UNAVAILABLE`. SID ownership/access checks now compare canonical SID strings. The isolated Windows runner can diagnose a failure with a fresh random slot and fixed synthetic data using the actual helper; production helper diagnostics remain drained/redacted. Native acceptance is pending CI.

The probe on `92bcb2c` identified a `Microsoft.PowerShell.Security` module-loading failure at `Get-Acl`. The helper runs in Windows PowerShell while the CI shell is PowerShell 7, whose inherited module search path can select incompatible modules. ACL reads and writes now use the .NET filesystem APIs already exercised by the earlier Windows client. The native persistence/context-validation suite remains the regression gate; this Linux workspace cannot establish Windows acceptance.

On `921612d`, those synthetic create/read/delete probes passed, but the complete native test still failed. Existing-file replacement passed PowerShell's `$null` to a .NET string parameter, which coerces it to an empty backup path. It now uses `[NullString]::Value`. Native acceptance explicitly replaces/reloads a credential, and the failure probe repeats its write to exercise replacement. Windows CI must confirm this correction before merge/publication.

## Public alpha preflight — 2026-11-21

After the replacement/onboarding corrections, `npm run check` passed: 69 unit cases passed, 5 platform-fixture cases were skipped, both package consumers and the offline signed alpha distribution passed, and 43 Markdown documents passed checks. The isolated Linux native suite passed 3 cases, including credential replacement/reload, with the macOS-only case skipped. GitHub private vulnerability reporting is enabled. The landing page and support/agent documentation now target the fresh guide, pinned alpha release and actual installer command; setup includes origin/account configuration. These local results do not close Windows native CI, signed public publication or the fresh hosted end-to-end journey.

## Signed alpha publication and hosted rollout — 2026-11-21

Merged [PR #7](https://github.com/07rjain/passman/pull/7) at `a94215b36469717b2bf83b56c15caf60b3f627e8` after all four required checks and fresh native Linux/macOS/Windows jobs passed on head `86f9be84525cc34971ebcd9697e21f411732d503`. The [fresh release workflow](https://github.com/07rjain/passman/actions/runs/44865978986) repeated platform acceptance, received the configured maintainer approval, signed with the protected publisher key and published immutable [1.0.0-alpha.1](https://github.com/07rjain/passman/releases/tag/passman-v1.0.0-alpha.1) at 04:31:59 UTC. The stable latest pointer and earlier release assets were retained.

The first production build stopped at the missing-public-archive gate. After public signature/checksum verification, a production retry completed as deployment `dpl_BfYJ91YVm3EeA5ypCeV5UCWwVGTM` for that main commit, aliased to `passman.subdomain.wtf`. Fresh schema version 1 and the separate restricted runtime configuration were verified without resetting prior data. The browser observed fresh health 200 (`ready`, version 1.0.0-alpha.1), unauthenticated account 401 with cookies omitted, the pinned new release link and correct SDK line breaks. Desktop 1280×800 and mobile 375×667 layouts had no horizontal document overflow; no console errors were observed.

At 08:09 UTC, anonymous downloads passed pinned publisher-signature and checksum verification. Both hosted installers matched source. A fresh, isolated Linux installation using the hosted installer and its verified private Node runtime reported the correct CLI version; the actual installed SDK decrypted a synthetic signed record, restored runtime and administrative packages, rejected a wrong password, and denied plaintext access without custody. Temporary installation/key material was removed, and shell profiles and existing installations were left unchanged. Archive SHA-256: `4886432c9455061525f0307a32b59b4304de8f2574bb38033779a4efa6180a47`.

This closes the prior missing-deployment/publication and native-CI gates for this alpha. It does not establish a newly authenticated hosted Clerk-to-vault lifecycle, real provider use, Kubernetes/cloud-function platform acceptance, monitoring delivery or production backup/restore. The alpha remains experimental.
