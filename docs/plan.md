# Passman implementation plan

Status: experimental standalone source prepared for [07rjain/passman](https://github.com/07rjain/passman). The new Vercel project/domain are deployed; Clerk/database configuration, health, published-client login setup and authorization denial checks pass; targeted two-account production browser/VM acceptance is recorded in [the manual report](manual-security-test-2026-11-01.md); wider release validation remains pending. Follow the [PRD](PRD.md), [design decisions](simplified-design.md) and [working instructions](../AGENTS.md). See [testing.md](testing.md) for commands and [live-setup.md](live-setup.md) for the new deployment checklist.

## Implemented and verified locally

- Independent npm workspace with shared browser/Node HPKE contracts, encrypted local identity files and a read-only runtime SDK.
- App-level Node.js 24 pin, committed Vercel commands and an npm prebuild lifecycle that compiles core before Next.js even with the default app build command. The clean default build passed in an independent source snapshot; CI builds the web workspace first to cover the missing-core regression.
- Application-owned CLI/browser approval bound to the exact public key and a one-time claim secret. Clerk JWT verification pins issuer, authorized origin, session identity, expiry and recent authentication for administrative changes.
- Separate PostgreSQL schema/migration, account/project isolation, hashed/expiring/revocable read and short-lived upload credentials, encrypted value storage and optimistic revision checks.
- Next.js dashboard for setup approval, projects, secret metadata, optional browser-encrypted replacement/deletion and credential management.
- Real built-Next.js/PostgreSQL integration using signed synthetic session JWTs, actual CLI subprocesses, encrypted uploads, SDK decryption and denial cases. Crypto, local-vault, JWT and installed-package checks pass locally. Linux/macOS CI is configured, not certified by a local run.

## Independent hosted client acceptance

An [Agent37 Ubuntu VM run](agent37-verification.md) passed public installation, SDK/vault checks and seventeen authenticated API/CLI/SDK checks, including separate Clerk test accounts, exact live retrieval, scope/tenant denials, an actual VM restart and revocation. Test users/secrets/credentials and the VM were cleaned up as documented. Interactive browser forms, actual email delivery and Mac acceptance remain distinct checks.

## Regression and production-auth follow-up

[feature.md](feature.md) is the maintained regression catalogue. New features extend it and record actual automated/live results. Clerk production cutover requires verified domain/DNS, matching production frontend/issuer/public verifier, and a review of existing development-user vault bindings before any environment change. The prior Agent37 test remains development-instance evidence.

On the former Keyman deployment, the configuration cutover completed on 2026-10-31: production frontend/issuer/public verifier now match, Clerk DNS/TLS and live denial checks passed, preview configuration and existing data were preserved, and the owner confirmed only disposable development test accounts existed. See [the setup record](history/legacy-hosted-setup.md#production-clerk-cutover--2026-10-31). That historical record predates the replacement instance. Targeted current production inbox/browser acceptance is recorded in the 2026-11-01 manual report.

## Standalone repository transition

- Include license, engineering/contribution/security guides, local documentation checks and Linux/macOS/PostgreSQL workflows inside this repository.
- Use `apps/web` as Vercel's Root Directory. Keep the internal workspace names, schema, wire/vault versions and local vault path stable.
- Preserve the earlier immutable client release. Version 0.1.1 moves public downloads to this repository after the former repository became private; verify the hosted installer and published artifacts.
- Preserve historical setup evidence separately; no old deployment IDs, secrets or Clerk user bindings configure the replacement automatically.

## Remaining release work

- [x] Deploy the replacement Vercel app with matched Clerk configuration and the preserved database/restricted runtime role. Preserve existing identities/data; see [live-setup.md](live-setup.md).
- [x] Complete targeted two-account real inbox/browser/VM login, approval, uploads, retrieval, reverification and revocation; see [manual evidence](manual-security-test-2026-11-01.md).
- [ ] Complete new-user signup, Mac acceptance, wider browser coverage and operational drills; previous targeted checks do not establish these.
- [ ] Independently review cryptographic/authentication contracts and the documented base-HPKE/hosted-code/client-compromise limits.
- [ ] Set edge/IP abuse protection, monitoring, spending limits and encrypted backup/restore operations; current database counters are a baseline.
- [ ] Complete production key/session configuration rotation and production client-support procedures. npm-registry publication and separate commercial licensing remain future work; the noncommercial GitHub client release is available.

## Delivery sequence

1. Finalize the minimal account/vault model, package names, CLI versus SDK administrative upload interface, record-integrity profile, typed errors and key-storage format.
2. Define stable wire contracts and an established hybrid-encryption profile, with interoperability/context/tamper fixtures. Keep the user-facing key model small.
3. Build bound Clerk login/setup, local key generation/protection and public-key registration. Test interruption, wrong-account and key-loss behavior.
4. Implement account-owned project/name storage, read-only hashed bearer credentials and encrypted-record retrieval with expiry/revocation and redacted errors.
5. Implement the preferred local administrative encryption/upload path and website management. Add optional browser encryption with the documented hosted-code trust boundary.
6. Implement the programmatic read/search/decryption SDK and a complete local usage example. Test that normal task-tool outputs and errors contain no credentials.
7. Run appropriate builds, formatting, types, lint, crypto/authorization/packaging/integration checks, then update installation and operations documentation. Use this repository's scripts, including documentation checks; the separate historical application's checks do not verify this build.

## Client distribution

The current SDK/CLI version is 0.1.1. Distribution includes the installer/private runtime, a self-contained npm archive with bundled locked dependencies, default hosted login, artifact/installer tests, and manual immutable GitHub Releases. Follow [releases.md](releases.md) and [SDK_CHANGELOG.md](SDK_CHANGELOG.md) for future versions. Windows, Homebrew and npm-registry publication remain follow-up work.

## Future TODO

- [ ] Review whether sender authenticity and independently checked record freshness are required: the manual hostile-response experiments demonstrated the documented HPKE base-mode substitution/rollback limits. Any change needs an explicit protocol decision and compatibility review, rather than importing the old multi-machine architecture.
- [ ] Improve safe UI error messages for wrong approval codes, conflicts, expiration and service unavailability; maintain redaction.
- [ ] Specify supported deletion/purge and test-vault retention procedures without silently resetting immutable account keys.

- [ ] Review the existing development-tool dependency advisories: the standalone install reported 11 moderate findings in the ESLint/TypeScript-ESLint/minimatch toolchain and no high/critical findings. Dependency versions were preserved during extraction; evaluate upgrades separately with regression checks.

- [ ] Upgrade the MVP to Node.js 26.x: verify dependency compatibility; run crypto/local-vault, SDK/CLI, packaging, database integration and clean web-build checks on Linux/macOS as applicable; then align package engine constraints, lockfile metadata, `.nvmrc`, CI, Vercel settings and documentation. Complete a deployed smoke test before making 26.x the default. Keep 24.x as the current baseline until validation passes.
- [ ] Separately authorized programmatic SDK create/update/delete operations; ordinary application credentials stay read-only.
- [ ] Browser-to-local connector bridge, only after origin binding, authentication and permissions are specified.
- [ ] Secure private-key transfer between machines with recipient verification and explicit cloned-identity/revocation limitations.
- [ ] Optional task-specific agent tools/adapters that return task output rather than credentials.
- [ ] Stronger agent isolation through a restricted executor if protection from arbitrary agent code is required.

The detailed TODOs and acceptance evidence remain in [simplified-design.md](simplified-design.md). Avoid duplicating the prior root-recovery/machine-delegation architecture in the MVP. Any production deployment or migration is a separate delivery step after implementation and tests.

## Audit trail

The [audit guide](audit.md) defines metadata-only event coverage, transaction/failure behavior, account-scoped activity, signed session webhooks and maintenance retention. Migration 2, restricted runtime grants and separate webhook configuration are required for rollout. Local decryption, provider usage and Clerk failed-sign-in details are outside the application event stream. Immutable external export and automated alert delivery remain follow-up work.

## Agent skill and deferred MCP

The [Passman skill](skills.md) provides portable instructions for local CLI metadata lookup and SDK retrieval/use without printing values. Public GitHub distribution uses the skills.sh discovery/install workflow; instructions do not grant access or create an unlocked session. Keep private credentials outside skill content/model output. Skill metadata is versioned separately from the client.

MCP remains future work: a local stdio adapter may wrap the SDK after login with privately configured service credentials and manual local unlock. Search/existence/status are metadata-only; raw retrieval/decryption would expose plaintext to the MCP client/model and requires explicit opt-in, disabled by default. Preserve read-only credentials, separate management authorization and the same local-key/OS-user limitations. See [the detailed scope](skills.md#future-mcp-integration).

- [ ] Implement a local MCP adapter only as a separately scoped feature: private service-key configuration, manual unlock, metadata tools, explicit opt-in for raw plaintext retrieval, separate management authority and redacted audit/diagnostic behavior. See [MCP design](skills.md#future-mcp-integration).
