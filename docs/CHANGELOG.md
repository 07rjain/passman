# Passman product and server changelog

This file records website/API/security and operational changes. Installable client versions belong in [SDK_CHANGELOG.md](SDK_CHANGELOG.md). Unreleased means implemented in source, not necessarily deployed. Server rollout records must include the deployed commit or deployment ID; never invent a client version for a server-only change.

## Unreleased

- Announce fresh SDK/CLI 1.0.0-alpha.1 on the public landing page with promptless reads, multi-machine sync/transfer and trusted local writes. Link the matching alpha release, render the SDK example with copyable line breaks, and clarify pending website entry. Preserve the existing visual style and experimental-software disclosure.

- Align the fresh landing page, support and agent entry points with the new quickstart and pinned alpha release. Use the installer's `passman` command, configure the service origin before login, and show the required account UUID in administrative examples. Clarify fresh restoration versus earlier-client key-loss behavior.

- Prepare the signed fresh 1.0.0-alpha.1 SDK/CLI archive and pinned alpha installers, fresh home/console entry point, separate `/legacy` access and schema-backed `/api/passman/health`. The production guard verifies the exact signed alpha artifact before deployment. Publication, CI and live acceptance are recorded separately.

- Record the owner-specified live `Vercel` SDK round trip on a temporary Agent37 VM, with exact retrieval, encrypted transport checks and credential/VM cleanup. Preserve the requested test entry and verified encrypted vault copy; no code change or deployment. See [the short report](live-vercel-sdk-test.md).

- Verify the fresh SDK across two Linux machines using a temporary Agent37 VM: 44 synthetic checks covering transfer, three-account local custody, automatic sync, compromise re-provisioning, credential replacement, mounted Docker restarts and cold VM reboot. Remove the VM and fixture keys afterward; no application-code change or hosted rollout. See [the verification record](fresh-multimachine-verification.md).

- Record the owner's explicit 2026-11-20 cleanup of all legacy application data: vault bindings, projects, ciphertext, credentials and setup sessions. Preserve Clerk identities and audit history; verify zero remaining legacy data and live health 200. This is a database maintenance action, not a new SDK/API deployment. See [the operations record](operations.md#owner-authorized-legacy-cleanup--2026-11-20).

- Add the isolated fresh alpha API/schema, browser-assisted native login, create-only pending submissions, signed local activation/rejection, service-key management, read-only installation inventory, role-separated sync/restoration, single-receiver transfer and transactional writer replacement. Requires explicit fresh migration/grants and separate configuration; no old-data import, publication or deployment. See [fresh verification](fresh-testing.md).

- Add upload-only import-context and atomic encrypted batch-import API operations, with account/key/revision validation and transactional `secret.import` auditing. The original `.env` file and plaintext stay local; no schema/grant changes or per-entry fallback. Prepare client 0.4.0 and portable skill 0.2.0; publication/deployment remain separate.
- Patch Next.js from 16.4.3 to 16.4.6 after the build reported GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8. Preserve the Node.js 24 baseline and other direct dependency versions.

### Website

- Prepare SDK/CLI 0.3.1 and portable skill 0.1.3, with matching package examples and release notes for seamless command discovery. Publish through the protected signed-release workflow; existing releases and vault/account bindings remain unchanged.

- Make macOS/Linux setup commands activate the installed command path immediately, and use `passman login`/`passman put` on the landing page, dashboard and public agent/setup guides. The maintained installer also configures future terminals; no vault/account migration or new client archive is required.

- Simplify the shared public footer to “Contact us” with Book a call, Website and Email. Remove the builder introduction while preserving destinations and native accessible disclosure. No migration or client update is required.

- Group the three creator contact links inside a single, initially collapsed “Meet the builder” footer control. Identify Rishabh as Passman’s builder and reveal call, website and email links with native keyboard/touch support, including without JavaScript.

- Add public `/llms.txt` agent setup/usage guidance, a complete source-document index and `/llms-full.txt` containing the public documentation snapshot. Generate both in web build/development from maintained docs, advertise them through public footer links and alternate metadata, and document private unlock, credential scopes, SDK/skill integration, errors and support without adding MCP or autonomous secret access.
- Add a separate, wrapping creator-contact row to the public landing, support and status footers: book a call, visit Rishabh’s website or email him. Preserve existing branding, links and theme; use ordinary links without a Calendly embed or tracking.

- Add canonical, Open Graph and Twitter metadata with a locally generated sharing card. Publish support and feedback routes with best-effort beta expectations and separate private vulnerability reporting.
- Add a public service-status page backed by the existing readiness check, including timestamps, manual/visible-page refresh, a timeout and distinct ready, failed and unknown results. It does not add alerts, incident history, recovery drills or cost controls.
- Improve public-page touch targets and dashboard mobile navigation, forms, long names/credentials, approval text and row actions. Keep account isolation, approval, credential-clearing and cryptographic operations unchanged.
- Reconcile current client instructions and portable skill 0.1.2 with signed release 0.3.0 and completed native/integration CI. Require a configured read credential before quickstart search/existence operations; preserve historical evidence and outstanding live acceptance separately.
- Add a Passman favicon matching the header mark, with a charcoal glyph on pale sage. Serve an SVG browser icon, 16/32/48-pixel ICO fallback and 180-pixel Apple touch icon through Next.js file-based metadata.
- Use stable hosted installer URLs for both landing-page platforms and link the release announcement to GitHub's latest release. New visitors need no version edit to install the latest published client. Installer version selection, publisher-signature checks and checksum verification are unchanged.
- Redesign the public landing page around Passman's local-key model, with charcoal controls, a pale sage background fading to white, a few faint static waves behind the hero, consistent wordmark, self-hosted Manrope typography, a concrete illustration of local keys, encrypted storage and SDK retrieval, a real SDK example, keyboard-accessible platform install tabs and clipboard feedback. Explain key loss, optional browser input and application/model access in expandable security questions. Preserve the existing signed-in workspace, Clerk controls and approval flow. No database, API or client-format change is introduced; this is a source change awaiting deployment.

### Fixed

- Restrict runtime database writes to required tables/columns. Account vault bindings, project names and migration state cannot be rewritten by the runtime role. Apply `npm run db:grants` with the migration owner and `MVP_RUNTIME_ROLE` after deploying the matching API; no user data or schema format is reset.
- Admit public setup/poll/bearer requests by a platform-verified client address before spending shared quota. One address cannot exhaust the enrollment bucket; arbitrary forwarding headers grant no identity. Non-Vercel HTTPS deployments fail closed until a trusted deployment adapter is supplied.
- Gate production promotion on a publicly available client whose pinned publisher signature and archive verify, preserving the previous healthy deployment until publication.
- Protect client publication with pinned publisher signatures and a protected signing environment; local path/ACL fixes are recorded in the SDK changelog.

- Bound device-poll counter allocation with a shared 1,200-attempt/minute quota before parsing or lookup. Allocate the 30-poll/minute per-device counter only for a verified live, unconsumed device, keyed by its server-generated ID. Rotating unknown codes no longer create individual persistent counters. Existing client/vault formats and schema remain compatible; no migration is needed. Edge/IP controls remain required because shared admission and anonymous audit accounting still use PostgreSQL.

- Commit bearer attempt quotas before authentication so unknown, expired and revoked tokens cannot undo their counters. Read/upload endpoints now share a baseline 1,200-attempt minute quota before lookup and retain the 120-attempt per-token quota. Aggregate repeated expired/revoked denial audit events while keeping account attribution. Quota exhaustion returns 429, including for valid callers when the shared quota is saturated; edge abuse controls remain required. No schema, vault format or SDK version change is needed. Current PostgreSQL integration CI passes the regressions; the [2026-11-04 preparation record](testing.md#bearer-denial-quota-regression--2026-11-04) preserves the earlier execution limitation.

### Added

- Add Windows client/installer support, current-user NTFS ACL enforcement, native Windows CI and hosted `install.ps1`. Client changes are versioned separately as 0.2.0; see the SDK changelog.

- Add a portable Passman agent skill for existing CLI/SDK workflows, with private-configuration guidance and skills.sh installation/discovery instructions. Track the local MCP adapter as future work; no client/API/vault behavior changes.

- Require future contributors/agents to preserve audit guarantees, maintain task-oriented documentation and changelogs, and verify migration prerequisites before automatically deployed pushes.

- Metadata-only audit history for setup, projects, credentials, secret operations and denials; no secret payloads or usable tokens are recorded.
- Account-scoped activity filters and pagination, signed/deduplicated Clerk session webhook ingestion, maintenance retention and explicit operator event reporting.
- Task-oriented documentation index, quickstart, reference, troubleshooting, key-loss and operational guides.

### Compatibility and upgrade

- Run additive database migration 2 and grant the existing runtime role audit SELECT/INSERT and identity-sequence USAGE before deploying. Health now requires version 2. Configure session webhooks and schedule retention separately; see [audit.md](audit.md).
- Audit-only changes preserve existing client compatibility, vault/ciphertext formats and account identities. Windows support is delivered separately in client 0.2.0.

### Known limitations

- Audit records are not independent of a compromised server/DB administrator. External immutable export and automated alerts are not yet implemented.
- Local decryption/provider use are unobservable; failed Clerk sign-ins remain in Clerk Application Logs. Anonymous application events are bounded representatives, not complete traffic counts.

## 2026-11-01 — Windows client 0.2.0

- Publish Windows installation and strict NTFS key custody with unchanged encryption/vault formats. Verified native x64 and actual public-download/SDK acceptance; native ARM64 and interactive production Windows login remain pending. See [release verification](releases.md#020-verification-record--2026-11-01).

## 2026-11-01 — hosted configuration and acceptance

- Published immutable client 0.1.1 from `bbde134d4a2459e62fab24cf4d9442727b6e66a8`, fixing download availability after the former release repository became private. See the SDK changelog for client details.
- Configured the preserved database with a separate restricted runtime role; recorded setup under `e4eee87f92d40d6c768e66cb2913234a96a6f47c`.
- Documented two-account real browser/VM acceptance and scoped production Clerk keys to Production only in `185d5713ef7ef527c9be925dd9c74ebf21fc3ef6`. See the [manual report](manual-security-test-2026-11-01.md) for results, known boundaries and cleanup.

## 2026-10-31 — standalone repository transition

- Extracted the simplified MVP into `07rjain/passman`, retaining existing client/vault/API/database formats and dependency baseline.
- Added standalone contributor/security/license documentation, reproducible CI and Vercel Root Directory `apps/web` configuration.
- Preserved npm prebuild hooks so clean web builds compile core and generate the installer.

The prior multi-machine application and its history remain in [07rjain/keyman](https://github.com/07rjain/keyman). Older deployment reports are historical evidence, not current configuration instructions.
