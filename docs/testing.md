# Run and test the MVP

Status: experimental. Local verification and hosted Vercel/Neon API checks passed; a fresh live Clerk browser login and the full user-owned machine workflow remain unverified. Use synthetic values. See [live-setup.md](live-setup.md), [deployment.md](deployment.md) and [security.md](security.md).

The maintained [feature/regression catalogue](feature.md) is the checklist for every future feature and release.

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

The default local origin is `http://localhost:3100`; use that exact origin in `APP_ORIGIN`, your browser and CLI. Remote deployments require HTTPS. The UI shows a configuration screen when the Clerk publishable key is missing; API configuration failures do not enable an authentication bypass.

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

An explicitly supplied `--value-file PATH` reads the exact contents of an owner-only regular file, up to 65,536 bytes; it does not trim or execute the file. Passphrases can likewise come from `--passphrase-file PATH` for controlled automation. These files must have restricted permissions (`600`) and ownership. Storing a plaintext passphrase beside the encrypted vault weakens protection; interactive entry is the normal user path, and automation fixtures are not a hardware-backed key store.

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

Names are limited to 256 UTF-8 bytes; values to 65,536 UTF-8 bytes. The API limits JSON bodies to 120,000 bytes and the client bounds responses to 150,000 bytes with a 15-second timeout and no redirects. The dashboard shows up to 1,000 entries and 100 credentials; use SDK pagination for additional secret-name results.

## Independent live VM verification

The [Agent37 verification record](agent37-verification.md) covers a separate Ubuntu VM using the public installer and SDK against the live service, real Clerk development sessions, encrypted upload/retrieval, two-account isolation, restart and revocation. It distinguishes the sanctioned development OTP mechanism from actual email delivery and browser UI acceptance.

## Automated evidence

```sh
npm run check
MVP_TEST_DATABASE_URL=postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/keyman_mvp_test npm run test:integration
```

The database command requires a disposable database named exactly **`keyman_mvp_test`** and a bootstrap role that can create the restricted fixture runtime role. It truncates only the MVP fixture schema's account/dependency and transient tables. Never use real-user data there. It does not target the earlier application's database or reset that deployment.

Executed locally on Linux: six unit tests, installed-tarball/type/runtime/CLI checks, builds, types, lint and formatting, plus a built-Next.js/PostgreSQL integration with two named subtests. The integration uses the real session-JWT verifier with locally signed fixture JWTs, an actual Next.js child process, a restricted database role, real CLI subprocesses and the real SDK. It covers setup binding/replay/expiry, existing-key replacement denial, local upload, exact decrypted values, update conflicts, search/existence, read-only enforcement, wrong account/project/key, expiry/revocation, no-store responses, host/forwarding-header handling, repeated migration and plaintext/key/token persistence checks. The CLI login test preserves the original private identity and does not print provider values.

The default `npm run build` from `apps/web` also passed in an independent fresh source snapshot with a new dependency install and no generated core or Next.js artifacts. Its npm `prebuild` lifecycle compiles core first. The Linux integration CI job exercises this default prerequisite path by building the web workspace before the client, rather than relying on a previously built core package.

The separate hosted setup record establishes Vercel/Neon configuration and seven API/SDK enrollment smoke checks. Neither that record nor these automated suites establish an interactive Clerk signup/login/reverification dialog, interactive Mac installation, supported-browser encryption, production load, disaster recovery or an independent audit. Linux/macOS checks and Linux PostgreSQL integration are configured in the dedicated MVP GitHub workflow. Report its actual result separately from local success.

## Standalone repository verification — 2026-10-31

OPS-11 was checked using a separate clean Git clone outside the former parent repository, with no inherited environment files, generated artifacts or parent license/documentation files. `npm ci`, `npm run check` and `npm run test:distribution` passed on Linux/Node.js 24. The suite includes six unit tests, package runtime/declaration checks, formatting, lint, type checking and the repository-local Markdown checks.

After removing generated core/client/web output, a direct `npm run build --workspace @keyman-mvp/web` passed and regenerated the hosted installer. Keep explicit npm `prebuild` hooks enabled: inheriting `ignore-scripts=true` would suppress this prerequisite in a standalone Vercel build. The repository's `.npmrc` retains strict engines/exact saves without that setting.

A separate temporary PostgreSQL 16 cluster on loopback ran the real built-Next.js integration against a disposable `keyman_mvp_test` database. The parent scenario and both named subtests passed, covering actual CLI approval/upload/search, exact SDK decryption, authorization/isolation, conflicts, expiry and revocation. No deployed database or customer vault was used.

GitHub private vulnerability reporting was enabled for `07rjain/passman`. Package source metadata and future release publication point to that repository; existing immutable 0.1.0 downloads intentionally retain their original location. No SDK release was published.

The install audit reported eleven moderate advisories in existing development-tool dependencies (ESLint/TypeScript-ESLint/minimatch), with no high/critical findings. Their versions were preserved and the upgrade review is tracked in [plan.md](plan.md). These local results do not establish macOS CI success, replacement Vercel/Clerk deployment, actual inbox/browser signup or independent security approval.
