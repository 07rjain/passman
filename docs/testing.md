# Run and test the MVP

Status: experimental. Local verification and hosted Vercel/Neon API checks passed; targeted two-account production browser/VM acceptance is recorded in the manual report, with wider platform and operational checks still open. Use synthetic values. See [live-setup.md](live-setup.md), [deployment.md](deployment.md) and [security.md](security.md).

The maintained [feature/regression catalogue](feature.md) is the checklist for every future feature and release.

## Landing-page redesign — 2026-11-11

Local working-tree verification based on `3d996de` covers WEB-01–04. `npm run check` passed formatting, production builds, types, lint, Linux unit tests, installed-package consumption and documentation checks. The native Windows-only unit test is skipped on Linux. No API/database or SDK behavior changed, so database integration and a new client release are not prerequisites for this presentation change.

Headless Chromium checked widths 320, 390, 768, 900, 1024 and 1440 without page-level horizontal overflow or JavaScript page errors. Browser interactions verified actual clipboard contents for both installation platforms and the SDK example, the permission-denied manual-copy message, arrow-key tab navigation, disclosure expansion, the static local-key/encrypted-storage illustration and reduced-motion media behavior. The public page was checked without Clerk configuration; real configured Clerk sign-in, account switching and device approval remain separate live acceptance checks. Screenshots and browser-check evidence are under `ignore-docs/landing-revision/`.

The subsequent pale sage background and faint static wave refinement passed a fresh web production build and the same Chromium interaction/responsive checks. Desktop and mobile screenshots were visually reviewed; the waves keep broad curves on narrow screens and do not intercept controls. This CSS/SVG refinement did not rerun the earlier full package suite. Evidence uses the `tinted-` prefix in the same ignored directory.

The landing page uses bundled, SIL Open Font License Manrope files, normal HTML for the hero illustration and small decorative SVG icons. It loads no remote font or art-rendering script.

The installer-link follow-up passed a fresh web production build and local development-server Chromium checks for the stable macOS/Linux and Windows URLs, copied command contents, latest-release link and the existing WEB-01–04 interactions/viewports. Both public hosted installer scripts downloaded successfully and matched the repository scripts byte-for-byte; their existing latest-version selection and signature/checksum verification were inspected. No installer was executed or client version published for this link-only change. Evidence is under `ignore-docs/installer-link-check/`.

## Site-icon verification — 2026-11-13

WEB-05 passed a fresh web production build and headless Chromium checks against a temporary local production server without Clerk configuration. The rendered page advertised the SVG icon, ICO fallback and 180x180 Apple touch icon. All three linked assets returned HTTP 200, their expected image content types and bytes matching the source files. The icon links remained available under dark-mode media with no JavaScript page errors. Image inspection confirmed the ICO's 16/32/48-pixel frames and the touch icon's 180-pixel dimensions; enlarged previews of the small sizes were visually reviewed.

Evidence is in `ignore-docs/favicon-check/`. No dependencies, account/API/database behavior or client format changed. The earlier cancelled preview server was not needed; this check started and stopped its own local server. This is source/local verification, not a deployed favicon or native Safari/iOS acceptance result.

## Install and configure

End users can use the [Passman installer/package](releases.md) without cloning this repository. The commands below remain the source-contributor setup. Distribution checks additionally cover offline package installation, SDK types and local crypto, CLI version output, first HTTPS install, repeat install, version upgrade, checksum rejection and vault preservation.

Use Node.js 24 and npm 11 on macOS or Linux. From the repository:

```sh
npm ci
npm run build
```

Configure a separate MVP PostgreSQL database and Clerk public settings using the deployment guide. Copy `.env.example` to `apps/web/.env.local`, restrict its permissions to `600`, and fill the runtime settings privately. Put only the separate owner connection in a protected `.env.migrate` file:

```dotenv
MIGRATION_DATABASE_URL=YOUR_MVP_OWNER_CONNECTION
```

Run the schema migration, then start the website:

```sh
npm run db:migrate
npm run dev
```

The default local origin is `http://localhost:3100`; use that exact origin in `APP_ORIGIN`, your browser and CLI. Remote deployments require HTTPS. Without a Clerk publishable key the home page shows the public landing page with documentation links, and public support/status pages remain accessible. API configuration failures do not enable an authentication bypass.

## Set up your local vault

In a separate terminal, from the repository root:

```sh
node packages/client/dist/cli.js login --url http://localhost:3100
```

Choose a passphrase of at least 12 characters. A new vault asks for confirmation. The CLI stores its private key in `~/.keyman-mvp/vault.json`, encrypted locally; this is separate from the earlier application's `~/.keyman/` directory. Keep this file and passphrase. No recovery or replacement-key reset exists.

The CLI prints a full public-key fingerprint, approval code and browser URL. It attempts to open your browser; `--no-browser` disables that attempt. Sign in with Clerk, compare the full fingerprint with your own terminal, enter that terminal's approval code and acknowledge the loss policy. The CLI must finish claiming the one-time approval before setup is complete. Administrative changes require recent first-factor authentication; the website uses Clerk's reverification hook to prompt when needed.

Approval expires after ten minutes. Retry `login` with the same vault after interruption. Re-login with the same key renews the 20-minute local upload credential. It does not generate a new key when an existing vault fails to unlock. A different key on the same account is rejected; signing in does not recover or replace the private key.

## Add values locally

Create a project such as `production` on the website. Then:

```sh
node packages/client/dist/cli.js put --project production --name TEST_PROVIDER_KEY
```

Enter an obviously synthetic value into the hidden local prompt. The CLI encrypts before upload and prints only the stored revision. Names are readable metadata. Existing names require explicit `--replace`; concurrent/stale changes fail with a conflict instead of silently overwriting.

In current source, interactive `put` checks for missing/expired upload authorization after local unlock, starts the existing bound browser approval once and saves the renewed credential before secret input. `--no-browser` still prints the URL for manual opening. Noninteractive commands stop with `passman login` guidance before reading `--value-file`. Failed approval, key/account/vault mismatch and an already-expired newly issued credential leave the saved identity unchanged and read no value. Client 0.3.1 requires explicit login after expiry. Runtime SDK calls never renew authorization or open a browser.

An explicitly supplied `--value-file PATH` reads the exact contents of an owner-only regular file, up to 65,536 bytes; it does not trim or execute the file. Passphrases can likewise come from `--passphrase-file PATH` for controlled automation. These files must have restricted permissions (`600`) and ownership, inside a private (`700`) directory with safe ancestors. Storing a plaintext passphrase beside the encrypted vault weakens protection; interactive entry is the normal user path, and automation fixtures are not a hardware-backed key store.

The optional website-entry form encrypts using the public key before its normal request. It intentionally warns that a compromised page could capture the input. It never asks for the private key or reveals an existing value. The browser must support the selected Web Crypto/X25519 profile; unsupported encryption fails rather than uploading plaintext. Cross-browser live acceptance remains a release check.

## Issue a read credential and call the SDK

Use the website to issue a named read-only service credential. Choose one project or all account projects and an expiry of 1–90 days. Save the displayed `kmr_` value privately; it is shown only at issuance, while the server retains its SHA-256 hash. This is a normal bearer credential received by the API, not the earlier application's dual-signature credential.

Source contributors can import the internal workspace package as below. End users can install the versioned `@07rjain/passman` archive and use the same API; see [releases.md](releases.md):

```js
import { KeymanClient, unlockIdentity } from "@keyman-mvp/client";

// Obtain these from trusted local input/configuration, outside model messages.
const identity = await unlockIdentity(directory, passphrase);
const client = new KeymanClient({ identity, serviceKey, project: "production" });

const exists = await client.hasSecret({ name: "TEST_PROVIDER_KEY" });
const page = await client.search({ query: "PROVIDER" });
if (exists) {
  const value = await client.getSecret({ name: "TEST_PROVIDER_KEY" });
  // Pass value directly to trusted application code. Do not log/return it to the model.
}
```

This is an integration fragment; the variables are privately supplied by the caller. For a complete repository example, configure an ignored local `.env.runtime` with `KEYMAN_DIRECTORY`, `KEYMAN_PASSPHRASE_FILE`, `KEYMAN_SERVICE_KEY`, and `KEYMAN_PROJECT`, then run:

```sh
node --env-file=.env.runtime examples/retrieve.mjs TEST_PROVIDER_KEY
```

The example reports success without printing the value. Ordinary `unlockIdentity` omits the short-lived upload credential; the administrative CLI explicitly opts into it. This reduces accidental exposure, but does not isolate an agent with equivalent file/passphrase access.

`KeymanClient` exposes no write method. The separately exported `uploadValue` helper is administrative and requires the short-lived upload authorization, not a read service credential. Broader unattended SDK mutation and private-key transfer remain deferred.

CLI metadata lookup is also available after configuring `KEYMAN_SERVICE_KEY` privately:

```sh
node packages/client/dist/cli.js search --project production --query PROVIDER
node packages/client/dist/cli.js check --project production --name TEST_PROVIDER_KEY
```

`check` prints only `Found` or `Not found`. No CLI command prints provider values. Missing metadata is returned only after account/credential authorization; malformed or inaccessible requests do not enumerate another account.

## Errors and limits

`KeymanError.code` uses `INVALID_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `KEY_MISMATCH`, `EXPIRED`, `RATE_LIMITED`, or `UNAVAILABLE`. Errors omit raw HTTP/SQL/crypto inputs. A revoked/expired read token is unauthorized; an expired setup request returns `EXPIRED`. Search returns at most 50 metadata entries and an optional `nextCursor`; pass that cursor as `after` for the next page.

CLI errors distinguish local-vault/protected-file failures from upload authorization expiry/rejection. An already-expired new upload token includes machine date/time guidance. Expiry or rejection after secret entry stops with login guidance; the CLI does not restart approval or replay the upload. The administrative `uploadValue` helper still returns `EXPIRED` without starting browser approval.

Names are limited to 256 UTF-8 bytes; values to 65,536 UTF-8 bytes. The API limits JSON bodies to 120,000 bytes and the client bounds responses to 150,000 bytes with a 15-second timeout and no redirects. The dashboard shows up to 1,000 entries and 100 credentials; use SDK pagination for additional secret-name results.

## Independent live VM verification

The [Agent37 verification record](agent37-verification.md) covers a separate Ubuntu VM using the public installer and SDK against the live service, real Clerk development sessions, encrypted upload/retrieval, two-account isolation, restart and revocation. It distinguishes the sanctioned development OTP mechanism from actual email delivery and browser UI acceptance.

## Automated evidence

```sh
npm run check
MVP_TEST_DATABASE_URL=postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/keyman_mvp_test npm run test:integration
```

The database command requires a disposable database named exactly **`keyman_mvp_test`** and a bootstrap role that can create the restricted fixture runtime role. It truncates only the MVP fixture schema's account/dependency and transient tables. Never use real-user data there. It does not target the earlier application's database or reset that deployment.

Integration files run serially because they share that disposable schema. The focused device-poll regression (`test/device-poll.integration.ts`, SETUP-09) checks rotating unknown codes against persisted counter cardinality, a concurrent shared-quota boundary across API instances, pending-device cadence/reset, and consumed/expired rejection. Run it alone with `MVP_TEST_DATABASE_URL=YOUR_DISPOSABLE_TEST_CONNECTION node --import tsx --test test/device-poll.integration.ts`. This fixture does not establish edge/IP protection or production load capacity.

Executed locally on Linux: six unit tests, installed-tarball/type/runtime/CLI checks, builds, types, lint and formatting, plus a built-Next.js/PostgreSQL integration with two named subtests. The integration uses the real session-JWT verifier with locally signed fixture JWTs, an actual Next.js child process, a restricted database role, real CLI subprocesses and the real SDK. It covers setup binding/replay/expiry, existing-key replacement denial, local upload, exact decrypted values, update conflicts, search/existence, read-only enforcement, wrong account/project/key, expiry/revocation, no-store responses, host/forwarding-header handling, repeated migration and plaintext/key/token persistence checks. The CLI login test preserves the original private identity and does not print provider values.

The default `npm run build` from `apps/web` also passed in an independent fresh source snapshot with a new dependency install and no generated core or Next.js artifacts. Its npm `prebuild` lifecycle compiles core first. The Linux integration CI job exercises this default prerequisite path by building the web workspace before the client, rather than relying on a previously built core package.

The separate hosted setup record establishes Vercel/Neon configuration and seven API/SDK enrollment smoke checks. Neither that record nor these automated suites establish an interactive Clerk signup/login/reverification dialog, interactive Mac installation, supported-browser encryption, production load, disaster recovery or an independent audit. Linux/macOS checks and Linux PostgreSQL integration are configured in the dedicated MVP GitHub workflow. Report its actual result separately from local success.

## Standalone repository verification — 2026-10-31

OPS-11 was checked using a separate clean Git clone outside the former parent repository, with no inherited environment files, generated artifacts or parent license/documentation files. `npm ci`, `npm run check` and `npm run test:distribution` passed on Linux/Node.js 24. The suite includes six unit tests, package runtime/declaration checks, formatting, lint, type checking and the repository-local Markdown checks.

After removing generated core/client/web output, a direct `npm run build --workspace @keyman-mvp/web` passed and regenerated the hosted installer. Keep explicit npm `prebuild` hooks enabled: inheriting `ignore-scripts=true` would suppress this prerequisite in a standalone Vercel build. The repository's `.npmrc` retains strict engines/exact saves without that setting.

A separate temporary PostgreSQL 16 cluster on loopback ran the real built-Next.js integration against a disposable `keyman_mvp_test` database. The parent scenario and both named subtests passed, covering actual CLI approval/upload/search, exact SDK decryption, authorization/isolation, conflicts, expiry and revocation. No deployed database or customer vault was used.

GitHub private vulnerability reporting was enabled for `07rjain/passman`. Package source metadata and future release publication point to that repository; existing immutable 0.1.0 downloads intentionally retain their original location. No SDK release was published.

The install audit reported eleven moderate advisories in existing development-tool dependencies (ESLint/TypeScript-ESLint/minimatch), with no high/critical findings. Their versions were preserved and the upgrade review is tracked in [plan.md](plan.md). These local results do not establish macOS CI success, replacement Vercel/Clerk deployment, actual inbox/browser signup or independent security approval.

## Audit trail

The [audit guide](audit.md) defines metadata-only event coverage, transaction/failure behavior, account-scoped activity, signed session webhooks and maintenance retention. Migration 2, restricted runtime grants and separate webhook configuration are required for rollout. Local decryption, provider usage and Clerk failed-sign-in details are outside the application event stream. Immutable external export and automated alert delivery remain follow-up work.

## Bearer denial quota regression — 2026-11-04

The workflow integration suite now includes API/PostgreSQL coverage for TOKEN-09 and AUD-12: unknown, expired, revoked and active read/upload tokens reach 429 on attempt 121, including across API instances, and recover in the next minute. Repeated dead-token denials retain representative attributed audit events, while successful authenticated requests retain individual events. A mix of rotating and malformed bearer candidates exhausts the shared 1,200-attempt quota despite changing forwarding headers; a known revoked token is then rejected before account attribution.

The source fix was prepared against `e5a942efe4f8c10529b07797fea372f4b05de039`. Execution of the regression and the full required checks remains blocked in the editing environment: no dependency installation is present, Docker is unavailable, and a sandbox satisfying the security review execution controls could not be established. No passing runtime or baseline-failure result is claimed. Run `npm run check`, `npm run test:distribution` and the disposable PostgreSQL `npm run test:integration` command above in an appropriately isolated Node.js 24/npm 11 environment before merge. No live service or production database was exercised.

## Audit implementation verification — 2026-11-01

On Linux/Node.js 24, `npm run check` passed formatting, production build, types, lint, six unit tests, installed-package checks and documentation validation. `npm run test:distribution` passed the artifact/installer preservation checks. `npm run test:integration` passed all four tests/subtests against a separate local PostgreSQL 16 database, including the built Next.js API and actual CLI subprocesses.

New audit coverage exercises tenant isolation, payload/token/private-key exclusion, denied-event durability, rollback when audit INSERT is unavailable, read failure on audit outage, concurrent request context, filtered numeric cursor pagination, anonymous event bounding, forbidden runtime UPDATE/DELETE, retention, forged/stale webhook rejection, concurrent delivery deduplication and retry after storage failure. Fixed diagnostic events in the test output are intentionally induced audit outages.

The first integration run exposed lexical rather than numeric cursor ordering; the SQL was corrected and the full integration run passed. Production migration/grants, actual Clerk webhook delivery, scheduled retention/alerts and native browser activity interaction were not performed by these local checks. No client version or ciphertext/vault format changed.

## Windows acceptance

Use [windows.md](windows.md) for native Windows prerequisites and security boundaries. CI runs native Windows builds/unit/package checks plus `distribution/check-windows.ps1`; Linux/macOS continue using the shell installer checks. Native ARM64 and real production Windows browser/terminal acceptance must be reported separately. Local Linux success cannot establish Windows ACL or PowerShell behavior.

### Windows 0.2.0 results — 2026-11-01

[Native cross-platform CI](https://github.com/07rjain/passman/actions/runs/41320353014) passed all Windows x64/macOS/Linux checks and disposable PostgreSQL integration. [Public Windows acceptance](https://github.com/07rjain/passman/actions/runs/41320715002) passed using the real hosted installer/public archive, with synthetic local vault data and SDK retrieval/decryption, repeat installation and unavailable-release preservation. See [release evidence](releases.md#020-verification-record--2026-11-01) for the tested checksum and cross-version vault compatibility. No real Windows Clerk login, native ARM64 or independent audit is established by these runs.

## Seven-finding remediation verification

See [security-remediation.md](security-remediation.md) for regression IDs and production sequencing. Local Linux unit/build/type/lint/distribution and disposable PostgreSQL 16 integration passed during preparation. The latter includes explicit denied SQL under the restricted runtime role, normal encrypted CLI/SDK operations, setup isolation by trusted client address, and durable denial quotas. Distribution tests use an isolated fixture signing key patched into a fixture installer only, with no production key in CI; forged matching checksums and invalid signatures fail before execution. Native Windows tests also reject private input under replaceable parents and exercise handle-based ACL reads. Final native CI results and production acceptance remain separate evidence.

## Public website and mobile dashboard — 2026-11-14

WEB-06–08 were checked locally on Linux/Node.js 24. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='' npm run check` passed formatting, production builds, types, lint, eight Linux unit tests, installed-tarball/type/runtime/CLI checks and validation of 33 Markdown documents. The Windows-only unit test was skipped on Linux; this run does not replace native CI. After a final dashboard wordmark CSS adjustment, the web production build and browser checks passed again.

Headless Chromium exercised the built home, support and status routes at 320, 390, 768, 900, 1024 and 1440 pixels, checking horizontal overflow, visible controls, canonical/Open Graph/Twitter metadata and the locally served sharing image. Support links point to public Issues and private vulnerability reporting, with explicit best-effort expectations. Status tests covered ready, HTTP 503, malformed/unexpected data, network failure, timeout, manual recovery, timestamps and polling only while visible. Raw failure details were not displayed.

The actual dashboard components were bundled separately with isolated Clerk and API fixtures containing synthetic data. Checks covered long project/secret/credential names, activity identifiers, one-time credential display/hide, project submission, mobile input sizing and local-vault approval controls, including expanded Windows instructions. No horizontal overflow or browser page errors occurred, and screenshots were reviewed. This fixture does not establish real Clerk sign-in/reverification, ordinary-user signup, email delivery or a native-device vault round trip. No authentication bypass was added to the application.

Local scripts, logs and screenshots are in ignored `ignore-docs/launch-followup/`. These results describe source/local behavior, not deployment. API, database, authentication and cryptographic behavior were unchanged, so the PostgreSQL suite was not rerun for this presentation change. Alert delivery, recovery drills and cost controls were left outside this update; the status page is a current readiness check, not an incident feed or uptime record.


The portable Passman skill was reconciled to SDK 0.3.0 and its metadata version advanced to 0.1.2. The skill-creator validator, `gh skill publish --dry-run` and an isolated `skills@1.7.4` local installation passed; all installed skill files matched source. The dry-run reported absent active tag-protection rulesets; no repository protections or release publication were changed.

## Creator-contact footer — 2026-11-14

WEB-09 passed a fresh web production build without Clerk configuration, repository lint/format checks and headless Chromium checks on the built landing, support and status pages at 320, 390, 768, 1024 and 1440 pixels. The three supplied destinations matched, existing footer links remained intact and the contact row stayed separate, allowed wrapping and had no horizontal overflow. Keyboard navigation followed call → website → email, with at least 44px link targets on mobile. Screenshots were reviewed; no page errors or automatic requests to contact destinations occurred. No call or email was sent.

The shared browser rendered the links, but its resize setting twice failed to change the actual viewport; the automated viewport assertions above therefore used headless Chromium. Evidence is in ignored `ignore-docs/creator-footer/`. These are local source checks, not a push or deployment. No API, database, authentication, SDK or operational behavior changed.


## Agent documentation entry points — 2026-11-14

WEB-10 passed `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='' npm run check`: formatting, production builds, types, lint, ten Linux unit tests, installed-tarball/type/runtime/CLI verification and validation of 34 Markdown documents. The Windows-only unit test was skipped on Linux. Generator tests cover the complete public-file index/bundle, relative-link portability, deterministic output, refreshed source edits, exclusion of unrelated private files and failure before publication when the agent guide is missing.

Against a temporary built production server without Clerk configuration, anonymous GET/HEAD requests to `/llms.txt` and `/llms-full.txt` returned HTTP 200 and `text/plain`, exact generated bytes, no redirect and no cookie. The bundle contained 33 unique public source documents, with every Markdown guide under `docs/` included and every indexed source file present locally. The full bundle's Markdown links were absolute. These are source-file checks, not a claim that unpushed GitHub links are already live.

Headless Chromium verified footer and alternate-metadata discovery on home, support and status pages. The existing creator-contact row remained present; new links were reachable and no page overflow occurred at 320, 390, 768, 1024 and 1440 pixels. Clicking Agent docs opened the text guide without browser errors. Scripts/logs are in ignored `ignore-docs/agent-docs/`. This is local verification, not deployment, real signup or agent-client compatibility acceptance. A client must support discovery or be directed to fetch the URL; documentation does not grant vault access. No API/database, credential or SDK behavior changed.


## Builder contact group — 2026-11-14

WEB-09 passed a fresh web production build, lint and formatting checks. Built-page Chromium checks on home, support and status verified one initially collapsed “Meet the builder” control, creator identification, the existing three destinations, Enter/Space and click toggling, keyboard link order and 44px targets. Closed links were hidden; expanded and collapsed layouts had no horizontal overflow at 320, 390, 768 and 1440 pixels. Existing footer/agent-docs links remained intact. Native disclosure also worked with JavaScript disabled, with no page errors or automatic contact-site requests. Screenshots were reviewed; no call or email was sent.

Evidence is in ignored `ignore-docs/builder-contact/`. These checks describe local source behavior, not a push or deployment. No API, database, authentication, SDK or operational behavior changed.

## 2026-11-15 — WEB-09 contact wording

Simplified the shared home, support and status footer to an initially collapsed “Contact us” disclosure containing Book a call, Website and Email. Removed the builder introduction; destinations and existing footer navigation are unchanged.

`npm run check` passed (formatting, builds, typecheck, lint, unit tests, package checks and documentation checks). Built-production Chromium checks passed on all three public routes at 320, 390, 768 and 1440px: collapsed state, Enter/Space and click toggling, keyboard link order, correct destinations, 44px link heights, no horizontal overflow, no page errors and no automatic requests to contact sites. Native disclosure also passed with JavaScript disabled. No contact navigation, call or email was sent. These local checks do not establish deployment or new authentication/database acceptance.

## 2026-11-15 — DIST-13 command discovery after installation

The new HTTPS installer regression failed against the previous installer because bare `passman` was not found after loading the existing shell configuration. With the fix, `npm run test:distribution` passed on Linux/Node.js 24: the exact updated copy/paste flow installs and activates the command in a clean shell without a system Node in PATH, real interactive Bash startup finds it, repeated environment activation and installation avoid duplicates, existing profile content survives, Bash login-file precedence is preserved, custom paths with spaces/quotes remain literal, symlinked profiles are skipped, and profile-edit opt-out leaves settings untouched. Upgrade, signature/checksum/missing-release denials, previous executable retention and vault-preservation checks also passed.

`npm run check` passed formatting, production builds, typecheck, lint, ten unit tests, installed-package verification and documentation checks; the Windows-only unit test was skipped. `sh -n distribution/install.sh` and `git diff --check` passed. The generated public installers and `/llms.txt` guides reflect the maintained sources. Native Zsh is unavailable on this host: its generated configuration was executed with a POSIX shell, while actual Zsh startup is covered conditionally by the distribution suite on hosts such as macOS CI. No native macOS/Windows, live browser approval, new client publication, push or deployment is claimed. No API/database/authentication or vault format changed, so the database integration suite was not rerun.

## 2026-11-15 — 0.3.1 release preparation

After the supported patch-version command advanced the client manifest, lockfile and changelog to 0.3.1, `npm run check`, `npm run test:distribution` and `npm run release:build` passed again on Linux. Public examples and the release-note installer command match the immediate PATH activation flow. Native cross-platform/database CI and protected signed publication remain subsequent gates; the preparation does not certify a published artifact or production deployment.

Portable skill 0.1.3 passed the skill-creator validator and repository-root `gh skill publish --dry-run`. The dry-run still reports no active tag-protection rulesets; no repository protections were changed. An isolated `skills@1.7.4` Codex installation succeeded and its complete skill directory matched source. An initial dry-run against the skill subdirectory failed directory-name validation; the documented repository-root invocation passed.

## 2026-11-15 — 0.3.1 signed public acceptance

The [protected release](https://github.com/07rjain/passman/actions/runs/43672957706) succeeded for main commit `237124eaf16acf1c85494e4f9c11ab41fcd93cde` after Windows acceptance and signing-environment approval. Anonymous release downloads passed pinned publisher signature/checksum verification, installer/source comparison and the production publication guard. The actual public Linux installer passed fresh install, reinstallation, missing-release preservation, current-shell activation and new interactive Bash discovery. The actual installed SDK passed synthetic encrypted-vault unlock, wrong-password denial and response decryption; no values were printed. See [the release record](releases.md#031-verification-record--2026-11-15) for checksum and CI references.

These are published-artifact checks in isolated local directories. Production deployment, hosted install-command acceptance and real human signup/login remain separate checks; no API or database mutation was required.

## CLI upload reauthorization — 2026-11-15

Local working-tree verification based on `6ecfbcd8205547292a0a09f8ffd14eed280cdedb`, client 0.3.1 plus unreleased changes, on Linux with Node.js 24.22.3/npm 11.19.1 covers SETUP-07/11 and local-vault error handling. The original expired noninteractive upload and wrong-passphrase regressions failed against the previous CLI. All 15 focused CLI regressions pass after the fix: renewal of missing/expired authorization before secret input, preservation of the key/account/origin, encrypted persistence, valid-token fast path, `--no-browser`, denied/expired/network/mismatched approval, clock skew, pending-approval timeout, protected value-file ordering and no replay after server rejection. Test fixtures contain synthetic values only and are removed afterward.

`npm run check` passed production builds, formatting, types, lint, installed-package consumption and documentation checks, with 25 passing unit tests and one native Windows-only test skipped on Linux. `npm run test:distribution` passed archive/SDK/installer, signature/tamper/PATH and vault-preservation checks. `npm run test:integration` passed all eight tests/subtests against the separate loopback PostgreSQL 16 `keyman_mvp_test` database. The new real-API renewal case verifies persisted identity preservation before the secret callback and exact SDK decryption after upload. Existing setup auditing, restricted privileges, expiry, denial durability and redaction remain covered without adding API operations or changing schema/authorization lifetimes. Expected fixed audit-failure diagnostics are part of rollback tests.

This is local verification, without a push, version bump, publication or deployment. Interactive callbacks/browser opening are injected in CLI tests; real API approval uses signed synthetic human-session JWTs, not a live Clerk/browser session. Native macOS/Windows terminal/browser approval, live email and this unreleased client's production acceptance remain unverified. No deployed database or customer vault was used. Client 0.3.1 users can renew explicitly with `passman login` using the existing vault before retrying `put`. Local logs are in ignored `ignore-docs/cli-expiry-*.log`.

## 2026-11-15 — 0.3.2 release preparation

The supported patch-version command advanced the client manifest, lockfile and changelog to 0.3.2 for SETUP-11. On Linux/Node.js 24.22.3, `npm run check` passed (25 unit tests passed, one native Windows-only test skipped), along with `npm run test:distribution`, `npm run release:build` and all eight disposable PostgreSQL integration tests/subtests. The versioned archive includes the renewal fix, CLI declarations and locked runtime dependencies. Existing account/vault/wire formats and the 20-minute upload lifetime remain unchanged. Current guides distinguish 0.3.1's explicit login workaround from 0.3.2's interactive reapproval. Native CI, main merge, protected signing/publication and public-download acceptance remain subsequent release gates; these local results do not establish publication or deployment.


## 2026-11-15 — 0.3.2 signed public acceptance

[Release verification](releases.md#032-verification-record--2026-11-15) records native CI, protected signing and actual anonymous public downloads. The real 0.3.1-to-0.3.2 Linux upgrade preserved the encrypted synthetic vault byte-for-byte and retained its key/account/origin. Installed SDK decryption, wrong-password denial, packaged CLI expiry preflight before missing value-file access, reinstall/failure preservation and command activation passed. Fixtures contained synthetic credentials and the vault/passphrase file were removed afterward. Scripts, fixed-status output and checksum evidence are in ignored `ignore-docs/release-0.3.2/`. No live Clerk approval, native Mac/Windows interactive installation or customer vault was used. The publication verification does not establish deployment of the updated documentation.

## Environment-file import — 2026-11-18

Local working-tree verification on `feat/env-import`, based on `0ac73a7398abbd26dc08f599d85d726d359f662e`, covers IMPORT-01–09. Client 0.4.0 and portable skill 0.2.0 are prepared; no publication, push or deployment is established. Node.js 24.22.3/npm 11.19.1 remain the toolchain. No schema migration, database grants, vault/account reset or ciphertext-format change was introduced.

`npm run check` passed formatting, production builds, types, lint, installed tarball runtime/declarations, documentation and 48 unit tests; one native Windows-only test was skipped on Linux. Parser tests cover UTF-8/BOM/CRLF, comments/export/quotes/multiline, literal references, syntax/duplicate/size/count boundaries and redacted issues. SDK/CLI tests cover metadata-only previews, conflict/empty policies, no-write dry runs, confirmation/cancellation/authorized automation, pre-file reapproval, pinned identity/context, encrypted requests, single-use commits and unknown-response handling. A subprocess regression verifies prompt rejection of FIFO input instead of a blocking open.

`npm run test:distribution` and `npm run release:build` passed for 0.4.0, including installable import exports/declarations, SDK runtime, private-runtime installer/PATH/tamper and vault-preservation checks. These are fixture artifacts, not a publicly signed client release. `npm run test:integration` passed all nine tests/subtests on separate loopback PostgreSQL 16 `keyman_mvp_test`. The new real-API case checks complete encrypted import and exact decryption, skip/replace/empty behavior, stale/concurrent atomicity, credential/key/account/project/size/duplicate boundaries, authorization expiry during a lock wait, audit rollback/redaction and actual noninteractive CLI preview/commit. Expected fixed audit-failure diagnostics are emitted by rollback fixtures. No deployed database or customer vault was used.

The skill-creator validator, `gh skill publish --dry-run` and an isolated local `skills@1.7.4` copy installation passed; all three installed skill files match the maintained source. Generated agent documentation includes the import guide. These checks validate packaging/instructions, not every agent's compliance. Native macOS/Windows interactive import/browser approval, new-client CI and production rollout remain unverified.

The initial full build reported known Next.js cache-disclosure advisories GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8. Next.js was patched from 16.4.3 to 16.4.6, without changing Node.js or other direct dependency versions; the full checks passed afterward. A fresh runtime-only `npm audit --omit=dev` reported zero vulnerabilities. This is a registry scan, not an independent security audit. Local command logs and fixture scripts are in ignored `ignore-docs/env-import-*` and `ignore-docs/env-skill-*` paths. Test temporary inputs are cleaned up by the suites.

## Live deployed SDK round-trip — 2026-11-20

At the owner's request, used an existing authorized AgentMail account, normal production Clerk email-code sign-in and explicit browser vault-fingerprint approval to test the deployed legacy API. This run consumed the compiled workspace `@keyman-mvp/client` 0.4.0 against `https://passman.subdomain.wtf`; it does **not** establish live acceptance for the separate new `@passman/sdk` implementation. No Clerk testing token, backend identity bypass or real provider credential was used.

Created project `live-roundtrip-1795213708883` and three synthetic entries: `SYNTHETIC_API_KEY`, `UTF8_MULTILINE` and `EMPTY_VALUE`. All three SDK returns exactly matched their locally supplied values. HTTP record responses contained encrypted envelopes/context; nonempty plaintext values were absent from those responses. The browser listed the project and all names without exposing their values. Two additional fresh Node processes unlocked the persisted local identity and repeated all three exact-match reads successfully. A missing name returned `false`/`NOT_FOUND`; a mismatched local key returned `KEY_MISMATCH`. After read-credential revocation, retrieval returned `UNAUTHORIZED`.

Cleanup deleted all three synthetic entries, verified the project search was empty, and revoked both test read access and active test upload authorization. The empty project and legacy account/vault binding remain. The encrypted test vault and owner-only local fixture state are retained privately in ignored `ignore-docs/live-secret-roundtrip/` to avoid stranding that immutable legacy binding; this is test custody, not a public backup/recovery feature. No secrets or email verification codes appear in this record. Signed out and closed the test browser.

The shared browser initially returned a click timeout and a failed subsequent action; the run switched to a dedicated local Chrome instance after those failures. No protection was disabled. New-API deployment remains a separate prerequisite for a live fresh-SDK test.

## Owner-specified Vercel round trip — 2026-11-20

A new Agent37 VM linked the owner-confirmed account through real email-code sign-in and browser fingerprint approval. The SDK stored the supplied `Vercel` test entry and returned its exact value in two VM processes. Ciphertext-only API and metadata-only website checks passed. The project/entry remain; temporary credentials were revoked and the VM was deleted after preserving/verifying its encrypted vault privately. See [the short report and executed code](live-vercel-sdk-test.md). This covers the currently deployed API-compatible client, not the undeployed replacement SDK.

## Deterministic pending-approval deadline — 2026-11-21

A loaded Linux CI runner exposed a timing dependency in the legacy CLI test: a real one-second timer could wake just before the cutoff and permit an extra pending poll. The fixture now advances a controlled logical clock to the deadline when returning its pending response. Assertions still require expiry, exactly one pending poll, no secret read/upload and byte-for-byte preservation of the local vault. The production deadline loop is unchanged.
