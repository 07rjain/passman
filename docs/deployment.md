# Deploy the MVP to Vercel

Status: the replacement Vercel project/domain, Clerk production configuration and restricted database connection are deployed. Health, published-client login setup and authorization denial checks pass; genuine browser signup and full vault acceptance remain pending. The former Keyman deployment is being retired by its owner; no new infrastructure is configured merely by importing source. Use synthetic secrets and record fresh results in [live-setup.md](live-setup.md).

## Fresh standalone deployment

1. Import **`07rjain/passman`** into a new Vercel project. Select Next.js, **Root Directory `apps/web`**, Node.js 24 and inclusion of files outside the Root Directory. Keep the checked-in install/build commands below.
2. Configure a separate test Neon database and restricted runtime role; retain a separate owner connection for migrations. Do not delete/reset an existing database as part of this repository move. Existing Clerk/account/vault bindings need an explicit migration decision if you reuse data.
3. Create/select a new Clerk application and set its intended stable production origin. Enable email signup and verification, use Open access, and leave unused social providers disabled. Keep production and development/preview configuration separate.
4. Use the **new instance's** exact DNS records. Public mail/DKIM targets from the earlier app are not reusable settings. Preserve the application DNS record and unrelated websites while updating Clerk records. Complete certificate issuance before directing testers there.
5. In Vercel Production, set the matching production publishable key, issuer and RSA public verifier, the stable `APP_ORIGIN` and restricted `DATABASE_URL`. If supplied by an integration, verify its server-only `CLERK_SECRET_KEY` belongs to the same production instance. Keep every private/customer decryption key off Vercel.
6. Run the additive database migration and redeploy. Verify health and invalid/unauthenticated request rejection. Then complete an ordinary browser signup/real email verification without a testing token. Review the matched Protect decision if it fails; replacing the app does not automatically fix a policy block, and blanket disabling of protections is not acceptance.
7. Enroll a fresh test vault under a separate local directory, create a project, upload a synthetic value locally, retrieve it with the actual SDK and revoke the read credential. Never overwrite or reset an existing local vault to accommodate a new Clerk user ID. Record results with [feature.md](feature.md).

The existing 0.1.0 installer defaults to `https://passman.subdomain.wtf`; retain that stable origin for the replacement, or use the CLI's explicit `--url` option for a separate test origin. No release is published by this repository setup. See [releases.md](releases.md) for the deliberately retained legacy download source.

## Architecture

- Next.js dashboard and Node.js Route Handlers on Vercel.
- Clerk for human sessions; account management APIs verify signed session JWTs.
- Neon-compatible PostgreSQL with pooled runtime connections and a separate migration owner.
- Node.js 24 local CLI/SDK for private-key storage, recommended input and decryption.

Functions keep no authoritative local-file or in-memory session state. PostgreSQL holds account/public-key registration, names, encrypted values, credential hashes, one-time setup transactions and rate counters. Module-level database pools may be reused as a connection optimization, not as authorization state. Customer private keys/passphrases and provider plaintext must not enter Vercel configuration, builds or logs.

## Prepare the database

Create a separate Neon project/database for the MVP, in a region close to the Vercel functions. Use an owner/direct connection for migrations and a restricted runtime login with the pooled connection for the application, following [Neon's pooling guidance](https://neon.com/docs/connect/connection-pooling). Require TLS for remote database connections. Do not substitute the existing application's database as an unreviewed migration.

From the repository root, put only the owner connection in a private `.env.migrate`, then:

```sh
npm ci
npm run db:migrate
```

The migration creates only the `keyman_mvp` schema and version 1 objects inside it, under an advisory transaction lock. The running API checks schema readiness; it never runs migrations automatically. Repeating the migration preserves accounts and ciphertext.

Create the runtime login through your database administration facility using a generated password, then grant the following, replacing the example role name with your actual role. Keep owner credentials outside the Vercel runtime:

```sql
GRANT USAGE ON SCHEMA keyman_mvp TO keyman_mvp_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  keyman_mvp.accounts, keyman_mvp.projects, keyman_mvp.secrets,
  keyman_mvp.credentials, keyman_mvp.devices, keyman_mvp.limits
TO keyman_mvp_runtime;
GRANT SELECT ON keyman_mvp.migrations TO keyman_mvp_runtime;
```

Confirm that the runtime role cannot create/drop schema objects or alter other application tables. The integration test checks the restricted role separately. Future migrations may add grants explicitly; using the database owner as the permanent runtime is not the recommended setup.

## Configure Clerk and the application

The accepted early-test rollout uses email signup with email verification and [Clerk's Open access mode](https://clerk.com/docs/guides/secure/restricting-access). Invite-only access and GitHub sign-in are not required. Anyone who discovers the URL can register; sharing it with selected testers does not restrict signup. The application trusts valid sessions from the configured Clerk instance; it does not maintain a second invitation database. These are the application variables:

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact stable HTTPS origin, without a path or trailing slash. Local development permits `http://localhost:3100`. |
| `DATABASE_URL` | Restricted MVP runtime PostgreSQL connection; use Neon pooling/TLS in production. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk's public frontend key, required at build time for the browser UI. |
| `CLERK_JWT_KEY` | Clerk's public RSA session-JWT verification PEM, not a private key or Clerk API secret. Literal escaped newlines are supported. |
| `CLERK_ISSUER` | Exact HTTPS issuer of the Clerk application. |

The implementation needs no Clerk administrator secret. The [Marketplace integration](https://clerk.com/docs/guides/development/integrations/platforms/vercel-marketplace) syncs the standard publishable/secret keys, but Keyman's additional `CLERK_JWT_KEY` and `CLERK_ISSUER` settings must also match that instance. The verifier pins issuer, authorized application origin, session ID, signature and expiry. Sensitive mutations require a first-factor verification age no greater than ten minutes. Configure your actual allowed domains/redirects for the stable origin and verify reverification interactively. Track Clerk verification-key rotation and update the public verifier configuration when required.

Configure each preview environment with its own correct origin and isolated data. The API validates Host against `APP_ORIGIN` and uses that pinned public origin rather than granting trust to forwarding headers. A preview using production's configured origin fails closed; do not disable the check to make previews work.

## Switch the hosted app to Clerk production

The earlier [Agent37 run](agent37-verification.md) used Clerk development. It is not a production-authentication pass. The requested production cutover requires all of these steps; it is not achieved by Vercel's environment being named Production.

1. In Vercel's Clerk integration, open the linked resource. Create/select its production instance and set its production application domain to `passman.subdomain.wtf`. Vercel-managed applications change their production domain through the integration settings. Follow [Clerk's production guide](https://clerk.com/docs/guides/development/deployment/production).
2. Enable email signup/sign-in, require email verification, and retain Open access. Social providers are optional; development's shared Google/GitHub credentials are not production OAuth credentials.
3. In Clerk's Domains page, copy the exact requested DNS records into the authoritative DNS provider. Do not invent record targets or overwrite the existing application record. Wait for Clerk's DNS verification and certificate deployment to complete.
4. Confirm whether any non-test users already have local vaults or saved secrets. Production users have separate Clerk identities. Existing Keyman account IDs are part of the encrypted record context and are pinned locally: do not merge by email, reset keys, delete records or rewrite ciphertext/account IDs as a shortcut. If real bindings exist, plan and verify their migration before cutover. No automatic cross-instance account migration is implemented. Preserve any existing data even if the initial cutover contains only disposable test metadata.
5. Configure **Vercel Production only** with the production `pk_live_` publishable key, its exact `CLERK_ISSUER`, and the matching RSA `CLERK_JWT_KEY`. Keep `APP_ORIGIN=https://passman.subdomain.wtf`. If the Marketplace integration supplies a backend secret, its production mapping must use the production instance; do not copy a development secret into production. Keep preview/development settings separate. The application's verifier itself needs only the public verification key.
6. Redeploy and inspect the served frontend for a production key, verify the production JWKS/domain, and check database-backed health. A healthy endpoint alone does not validate login.
7. Use a dedicated production test account and real inbox to complete signup, email verification, CLI approval, encrypted upload, exact SDK retrieval and revocation. Do not enable test mode or use the reserved development OTP to mark production email acceptance complete. Run the applicable [feature cases](feature.md), especially AUTH-01 through AUTH-10 and the complete live journey.

If provisioning, DNS or existing-user migration is incomplete, record that blocker and keep the current deployment available rather than falsely reporting a completed switch. Preserve the prior configuration for an explicit rollback; switching identities back and forth is not an account migration strategy.

## Vercel project settings

Import this repository as a **new** Vercel project, using [Vercel's build settings](https://vercel.com/docs/builds/configure-a-build) and explicitly selecting the supported [Node.js 24 runtime](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions):

- Framework: Next.js; Node.js version: 24.
- Root Directory: `apps/web`.
- Enable inclusion of source files outside the Root Directory so the shared MVP workspace package is available.
- Install command: `cd ../.. && npm ci` (committed in `apps/web/vercel.json`).
- Build command: `npm run build` (committed in the same file and compatible with Vercel's default command).
- Output Directory: the Next.js default (`.next` within the selected app root).
- Set the runtime/build variables above in the appropriate environment. Do not set `MIGRATION_DATABASE_URL` in the running application.

The app's own `package.json` pins Node.js to `24.x`, so importing the nested app does not select Vercel's newer default runtime. `@keyman-mvp/core` must be compiled before Next.js resolves its exported JavaScript/declarations. The web app's npm `prebuild` lifecycle compiles core before its `next build` script. Both a default `npm run build` inside `apps/web` and a workspace-targeted web build perform that prerequisite, including when a custom Vercel command is not applied. The checked-in `vercel.json` supplies the workspace install command and uses the same default build entry point.

`next.config.mjs` traces the MVP workspace root so the shared core package is included. Runtime handlers use Node.js, not an Edge-only crypto/database API. Requests are deliberately small; there is no persistent server-side broker, WebSocket process or local database file.

These settings have passed local production builds and the hosted infrastructure/API checks in the live setup record. Interactive signup and the full client workflow still require acceptance. Use a Vercel plan permitting the intended commercial use; confirm current plan terms/pricing directly with Vercel.

## Troubleshooting the initial import

- `passman login` reports `UNAVAILABLE` before printing an approval URL: check `https://passman.subdomain.wtf/api/health` and the Production server variables first. A missing `DATABASE_URL`, origin, issuer or public verifier returns 503 before setup can start. For Neon, open the existing MVP project → Connect, select its existing branch/database and restricted runtime role, and copy the pooled TLS connection URL into Vercel Production as `DATABASE_URL`. Do not use the database owner as the runtime role. Verify schema/privileges, then redeploy; the health endpoint must return 200 before retrying login. Local key creation happens before this request, so keep `~/.keyman-mvp/vault.json` and use the same passphrase on retry. Reinstallation or deleting the local vault does not repair server configuration.
- `EBADENGINE` showing Node.js 26: select **Settings → Build and Deployment → Node.js Version → 24.x**, and deploy the latest `main` commit containing the app-level engine pin. These log lines are warnings; read the end of the build log for the actual failure.
- `Module not found: Can't resolve '@keyman-mvp/core'`: verify the Root Directory is `apps/web`, inclusion of outside source files is enabled, and the build command is `npm run build`. Current code runs `@keyman-mvp/web ... prebuild`, then the core TypeScript build, before `next build`. A custom command of `next build` alone bypasses the npm lifecycle; reset that override to `npm run build`.
- Retry using the newest `main` commit rather than redeploying an earlier failed commit. The default app build was tested in a fresh independent source snapshot with a new dependency install and no generated artifacts or repository-parent dependencies. CI also builds the web workspace first, before any other package build, to catch this regression.
- A Clerk signup security screen with a reference code requires investigation in the production instance's Application Logs / Protect dashboard. Correlate `sign_up.failed` and `protect.sign_up.blocked` for that reference before changing protections. A sensitive `CLERK_SECRET_KEY` setting's existence does not establish that its hidden value belongs to the right instance; validate a replacement against the production JWKS, keep it server-only and redeploy when changing it. The browser's signup request uses the public Frontend API; updating a backend credential alone does not establish that a Protect policy block is resolved. See the [live investigation record](history/legacy-hosted-setup.md#production-backend-key-and-signup-investigation--2026-10-31).

## Operational checks

- `GET /api/health` returns 200 only with required server configuration and the migrated database available. No fake-auth or test-identity production mode exists.
- Run CLI login at the exact configured public origin, compare the fingerprint/code, approve through real Clerk, create a project, upload a synthetic value and retrieve it locally through the SDK.
- Exercise browser input, wrong credentials, another account, credential expiry/revocation and a conflicting update. Confirm private responses have `Cache-Control: private, no-store`.
- Configure edge/IP abuse limits and spending alerts before a public rollout. Database-backed counters cover authenticated subjects and baseline public setup/poll buckets. Device polling admits at most 1,200 attempts per minute across instances before device lookup; unknown codes do not allocate individual counters. The shared public-start and poll buckets can aggregate users and are not a complete distributed abuse policy. Rejected polls still require shared counter and audit database work. Failed credential attempts and connection floods need platform protection before database work.
- Use separate preview/production databases, TLS, least-privilege credentials, controlled migrations, metadata-only observability, monitoring and encrypted off-server backups with an exercised restore.
- Keep the stable service origin before creating user vaults. The initial CLI does not silently change stored origins, reset a key or migrate earlier application data.

Hosting does not strengthen optional hosted input against malicious JavaScript or isolate an arbitrary-code agent from its local vault. Read [security.md](security.md) before claiming production guarantees.

## Audit rollout

Before deploying the audit-enabled API, run additive migration 2 with the separate owner and grant the existing runtime role the audit privileges listed in [audit.md](audit.md). Health requires version 2. Configure production-only session webhooks, daily maintenance retention and alerts separately. Do not infer these are configured from a successful build.
