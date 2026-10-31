# Historical Keyman-hosted setup

Historical record from the earlier `07rjain/keyman` deployment on 2026-10-31 at https://passman.subdomain.wtf. The owner is retiring that Vercel/Clerk setup; this is not evidence for the new standalone deployment. This records infrastructure and API checks, not production approval or a completed interactive user workflow.

## Configured

- Initial Vercel production deployment of MVP commit `ebeab1248da61b05ae4d28394e4be43fb7d33888`, Root Directory `mvp/apps/web`, Node.js 24. The custom domain is attached to this project; the original generated deployment URL is protected by Vercel authentication. The later production Clerk cutover is recorded below.
- Separate Neon PostgreSQL database, additive `keyman_mvp` schema version 1. No earlier application database was migrated or reset.
- SQL-created `keyman_mvp_runtime` login with required table operations and schema usage. Verified that it has no superuser, role-creation, database-creation, RLS-bypass or `neon_superuser` authority. An actual table-creation attempt was denied and rolled back.
- Vercel uses the restricted pooled connection with certificate/hostname verification. The database owner connection was not placed in Vercel.
- `APP_ORIGIN`, `CLERK_ISSUER` and the matching public RSA `CLERK_JWT_KEY` are configured. The public verifier was retrieved from the existing Clerk instance's public JWKS; customer private keys were not requested or uploaded.
- The initial setup used a Clerk development instance, with email signup, required email verification and open access. The user accepted open email signup for early testers; invitations and GitHub sign-in are not required. Production now uses the separate instance described below; the earlier development test results remain historical evidence.

## Seven live checks passed

1. Database-backed health returns `200` with `{"status":"ready"}` and `no-store` caching.
2. Console state without a Clerk session returns `401`.
3. Secret retrieval without a service credential returns `401`.
4. A well-formed but unregistered read credential returns `401`.
5. A foreign browser Origin is rejected with `403` on the console route.
6. The actual SDK starts enrollment with an ephemeral synthetic identity, verifies the fingerprint/public URL binding and receives a pending claim.
7. Approval without Clerk authentication returns `401`.

The synthetic pending enrollment was removed after testing. No account, project or provider value was seeded by these checks. No real customer private key was generated on the service or requested from a tester.

## Production Clerk cutover — 2026-10-31

Vercel deployment `dpl_56qUzVF4Es6YbeVuujNXxnanWKu1` reached Ready and was
assigned to `passman.subdomain.wtf`. Its served frontend now contains the
matching `pk_live_` publishable key and no development publishable key.

The production-only `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_ISSUER` and
`CLERK_JWT_KEY` settings were aligned with the verified production Frontend API
at `https://clerk.passman.subdomain.wtf`. The public RSA verifier came from
that endpoint's JWKS; the public frontend identifier was derived using Clerk's
installed `buildPublishableKey` helper for that independently verified host.
No Clerk backend secret or customer decryption key was needed for this work.
`APP_ORIGIN` remains `https://passman.subdomain.wtf`; the database configuration
and preview settings were not changed.

The owner confirmed that development contained only temporary test accounts,
with no real tester vaults/secrets needing migration. Existing database data
was retained; no accounts were merged, local keys reset or ciphertext rewritten.
Production login creates a separate Clerk identity and does not recover an
existing development vault/account binding.

All five CNAMEs were checked against Vercel's authoritative DNS:

| Host under `passman.subdomain.wtf` | Exact target |
| --- | --- |
| `accounts` | `accounts.clerk.services` |
| `clerk` | `frontend-api.clerk.services` |
| `clk._domainkey` | `dkim1.ptrvvyzl104k.clerk.services` |
| `clk2._domainkey` | `dkim2.ptrvvyzl104k.clerk.services` |
| `clkmail` | `mail.ptrvvyzl104k.clerk.services` |

DNS names must be relative to the zone being edited: in the `subdomain.wtf`
zone, use `accounts.passman`, `clerk.passman`, and the corresponding `.passman`
suffix for the mail records. Specific records override wildcard fallback;
explicit `passman` and `*.passman` routing preserves the website/fallback, and
the original parent wildcard and existing DMARC policies were left intact.

Actual checks and their limits:

| Check | Result |
| --- | --- |
| AUTH-01: served production frontend, matching configured issuer/RSA verifier | Passed configuration/response inspection |
| AUTH-02: five exact CNAMEs, Clerk/account hostname TLS chain and hostname checks, production environment/JWKS/Clerk browser script | Passed; Frontend API CORS allows the application origin |
| Production public sign-up configuration | Production mode, open email signup, email verification required, no social providers, test mode false |
| OPS-02/OPS-04: database-backed `/api/health` and private-response caching | HTTP 200, `ready`; all checked API responses include `no-store` |
| AUTH-05: owner API without login and with a locally signed forged production-shaped JWT | HTTP 401 for both; no valid session was manufactured |
| OPS-03: owner API with a foreign browser Origin | HTTP 403; forwarding-header cases were not repeated in this run |
| Secret retrieval with no credential and with a random read credential | HTTP 401 for both |
| Existing auth verifier fixture test | Passed signature, issuer, origin, session, expiry and recent-auth assertions; fixture evidence only |
| AUTH-03/AUTH-06 and complete live journey | Not run: actual inbox verification, browser sign-in/reverification, CLI approval and authenticated upload/SDK retrieval remain acceptance work |

Automated HTTP access to the hosted accounts sign-in page received a Cloudflare
challenge (HTTP 403); its TLS certificate validated. This does not establish
whether the interactive account page or sign-in modal succeeds. Public Clerk
configuration also reported signup CAPTCHA disabled; no CAPTCHA/test-mode
settings were changed, and AUTH-07 remains an outstanding rollout check.

This was a configuration deployment, with no SDK/CLI or encryption-format
change. It establishes production configuration and live negative checks, not
an authenticated production user journey or an independent security review.

## Production backend key and signup investigation — 2026-10-31

A production Clerk backend key supplied through a private card was validated
against the same production instance/JWKS as the deployed public verifier.
`CLERK_SECRET_KEY` already existed as a sensitive Vercel Production setting;
its previous value was hidden and could not be verified. It was replaced with
the validated production value, retaining its sensitive type and Production-only
scope. Preview credentials were not changed. Deployment
`dpl_Ffdcq8SQNUPUte7qLxm6KbwQBx18` reached Ready; the live frontend retained
its matching production publishable key, database health returned 200 and the
unauthenticated owner API returned 401.

The reported signup reference `Sk1JqBjA` was located in the production
`sign_up.failed` event payload. The same signup trace contains
`protect.sign_up.blocked` with reason `policy`, after the email/password
submission. This establishes a Clerk Protect policy rejection; it is not
evidence that a missing Vercel backend key caused that attempt to fail.

The diagnostic API exposed a decision ID and the generic policy reason, but
not the individual matching protection. Its Protect response reported rule
enforcement and Device Intelligence enabled. No Protect setting was changed,
and no test token, fabricated session, backend-created user or protection
bypass was used to claim production signup success. The next diagnostic step
is to inspect the matching decision in Clerk's Production Application Logs /
Protect dashboard. Actual signup, inbox verification and the authenticated
SDK journey remain unresolved until a normal user completes them.

Investigation used the documented Backend API log list and full event payload
lookup (`/v1/logs/{event_time_ms}:{event_id}`). Raw credentials and personal
log fields are excluded from this record. The Clerk backend key is server-only
infrastructure configuration; it must never use a `NEXT_PUBLIC_` name or enter
client release artifacts.

## Next: user-owned machine acceptance

Use Node.js 24/npm 11 on your Mac or Linux machine. From an updated clone:

```sh
cd keyman/mvp
npm ci
npm run build
node packages/client/dist/cli.js login --url https://passman.subdomain.wtf
```

Choose a local passphrase, sign in or sign up with email, complete Clerk's verification, compare the full fingerprint and enter your terminal's approval code in the browser. Finish the CLI claim before proceeding. If the clone directory differs, adjust the first command. See [testing.md](../testing.md) for vault-loss and interrupted-login behavior.

Create a `testing` project in the website, then locally run:

```sh
node packages/client/dist/cli.js put --project testing --name TEST_KEY
```

Enter a synthetic value in the hidden prompt. Issue a read-only service credential on the website and follow the [SDK retrieval example](../testing.md#issue-a-read-credential-and-call-the-sdk). Confirm retrieval, then revoke the credential and confirm further reads fail. Keep the service credential outside shell history/model messages, and keep the private vault and passphrase on your machine.

Interactive Clerk signup/login/reverification, full authenticated production upload/retrieval, Mac installation, optional browser encryption, abuse protection, backups/restore and independent security review remain acceptance/release work. The earlier Agent37 development-instance run is documented separately. Passing infrastructure/configuration and denial checks does not complete these gates.
