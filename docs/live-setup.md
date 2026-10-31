# Standalone deployment status

The standalone source is hosted in [07rjain/passman](https://github.com/07rjain/passman). A replacement Vercel project and custom domain are deployed as recorded below. Replacement Clerk/database configuration and a real signup remain pending. The owner subsequently requested deletion of the old Clerk resource; its deletion is recorded below. The hosted application is not yet a functioning vault deployment.

## Replacement setup checklist

- [x] Import the new repository into Vercel with Root Directory `apps/web`, Node.js 24 and the committed install/build commands.
- [ ] Reconnect the previous MVP database using its restricted runtime role, as selected by the owner. Verify its existing schema and preserve data; new Clerk identities receive separate account bindings without email-based merging or resets.
- [ ] Create/configure Clerk for the intended stable origin. Set matched frontend, issuer and public RSA verifier settings; any server-only backend credential must belong to the same instance.
- [ ] Obtain the replacement instance's exact DNS targets, verify DNS/certificates and preserve unrelated websites. Earlier DKIM/mail targets are instance-specific and must not be copied blindly.
- [ ] Complete ordinary browser email signup/verification and sign-in without a testing token. Inspect Protect decisions if blocked; recreating infrastructure does not guarantee a policy rejection disappears.
- [ ] Confirm health and denied-request behavior, then perform CLI approval, local encrypted upload, exact SDK retrieval, read-only enforcement and revocation.
- [ ] Record commits, client version, environment/platform, feature case IDs, actual results, cleanup and unresolved cases here.

See [deployment.md](deployment.md#fresh-standalone-deployment) for the concrete setup sequence and [feature.md](feature.md) for the full acceptance catalogue. Do not paste credentials, private keys or provider values into this record.

## Vercel project and public routing — 2026-10-31

- Created Vercel project `passman` (`prj_fxfNzGZtMlh3pzM3GQZ0Rw6uBoTI`), linked to `07rjain/passman` with `apps/web` as Root Directory, Node.js 24 and source files outside the Root Directory included.
- Deployed source commit `195e28468f200345cc2c5fa78ff023abd69d71b7` as `dpl_BGQTmXVJ4JnJqitZhXr2K4Q6Ymer`; Vercel reported Ready with aliases assigned. The repository's Linux/macOS/PostgreSQL CI for that commit completed successfully.
- Attached the verified custom domain `passman.subdomain.wtf`. Changed only its website CNAME to Vercel's recommended target, `05ced766eab694c4.vercel-dns-017.com`. Existing wildcard, Clerk/mail records, DMARC and unrelated website records were preserved. Old Clerk mail records are historical until a replacement instance's requirements are known.
- Configured Production `APP_ORIGIN=https://passman.subdomain.wtf`. No database URL, old Clerk credential or old account binding was silently copied into the new project. The owner selected a replacement Clerk application and reuse of the previous MVP database with its data preserved. Their credentials must be supplied privately and validated before those settings are applied.
- Actual HTTPS checks: `/` returned 200 and the missing-Clerk setup screen; `/install.sh` returned 200 with the installer script; `/api/health` returned 503 `UNAVAILABLE`, as expected without the required backend configuration. This is not a passing health/authentication check.
- Local Vercel project metadata is linked in ignored `.vercel/`. No customer key, provider plaintext or deployment credential was added to Git.

The initial private credential requests expired without submission. Subsequent Clerk integration checks are recorded below. The previous database runtime connection URL remains required privately; the existing database has not been modified. Replacing the Vercel project alone does not resolve the previous Clerk Protect policy rejection. Use the checklist above and record ordinary signup/email verification and the authenticated CLI/SDK workflow separately.

## Clerk integration recheck — 2026-10-31

- Vercel now contains `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in Production and Preview, saved as sensitive variables. Their presence does not establish the hidden backend key's instance. No secret value was retrieved or logged.
- Redeployed the current source as `dpl_9Vng6xH22rtYWkZhGaHSZjxb7emW`; Vercel reported Ready with aliases assigned. The custom-domain homepage returned 200, removed the missing-Clerk setup screen and served a `pk_live_` frontend key for `clerk.passman.subdomain.wtf`.
- The public Clerk environment reported production mode, and its JWKS returned 200 with RSA/RS256. However, its signing-key ID remains `ins_3LRD1sYQePusdG11jlVm2a4zBQb`, matching the historical instance. This does not verify that the requested replacement instance is active. Confirm the connected resource and replacement domain configuration before pinning its verifier. The Vercel token could not list Clerk Marketplace resources (403); no replacement resource identity is assumed.
- `DATABASE_URL`, `CLERK_ISSUER` and `CLERK_JWT_KEY` remain absent. `/api/health` returned 503 `UNAVAILABLE`; authenticated storage and the real signup/CLI/SDK journey remain unverified. The public JWT verifier can be configured after the intended instance/domain is confirmed; the application does not require a backend administrator key for session verification.
- No database mutation, account migration, Clerk policy change or DNS change was performed in this recheck. Preview's hidden key mode was not verified and must be checked separately before using previews.

## Signup reference investigation — 2026-10-31

- Correlated reference `JMlfn4nT` with the currently served production instance using its previously authorized backend credential for read-only investigation. Confirmed `protect.sign_up.blocked` followed by `sign_up.failed`, both for `sua_3LTPC65v0ZQ2v68hOL7Om0CgGG2`; the Protect payload reports `reason: policy`, decision `7c0ff16f-0c67-4810-aeb0-ef7843fbf310`. No signup password, email address, credential or full application-log export is included in this record.
- The public JWKS still matches the historical instance. The Vercel environment-variable update timestamps are unchanged from the earlier integration recheck; a replacement backend value cannot be verified from hidden sensitive variables.
- The served instance reports its production domain as `passman.subdomain.wtf`. The specific matched Protect rule is not identified by the event payload. The instance's requirements-check fields alone do not identify the rule that rejected this signup. Inspect the decision in the Production dashboard before changing protections; no rule was disabled or bypassed.
- The custom-domain homepage and Clerk public endpoints returned 200; health remains 503 with the database URL and explicit JWT verifier configuration absent. Those application configuration gaps are separate from the confirmed Clerk signup-policy rejection.
- No DNS, instance configuration, account binding or database changes were made during this investigation. Replacement domain verification and ordinary signup remain pending.

## Owner-requested Clerk resource deletion — 2026-10-31

- Identified the exact resource `clerk-aqua-crystal` (`ir_BKcB2mhMDaq1E6h2`) through Vercel's resource inventory. It had one connection, to the standalone Passman project. Disconnected that connection, verified no remaining connected projects, then deleted only this resource. Vercel returned 200 for deletion.
- Verified the deleted resource is absent from a fresh inventory, all other resource IDs remain present and the Passman project still exists. The historical Clerk backend key's instance lookup now returns 404. Domain reuse should be retried in the replacement app; this check did not attempt to claim the domain on another instance.
- Vercel removed the linked Clerk environment variables; only Production `APP_ORIGIN` remains. Existing deployment artifacts may still contain the old public frontend configuration until redeployed. Replacement keys, issuer/public verifier and the preserved database runtime URL remain pending.
- No PostgreSQL data, vault files, website domain, DNS records or unrelated resource was deleted. Old Clerk mail/DKIM DNS records remain until the replacement instance supplies its exact targets. This deletion does not migrate Clerk users or recover their existing ciphertext bindings.
- A directly managed replacement may be created in the owner's own Clerk workspace; applications in the Vercel-managed organization remain subject to Marketplace management. Set its production domain to `passman.subdomain.wtf`, verify exact DNS/certificates and supply matching production frontend/server settings. Email-only authentication requires no social OAuth credentials.

## Historical evidence

[The previous hosted setup and Clerk investigation](history/legacy-hosted-setup.md) records infrastructure/API checks and a Protect policy rejection on the former deployment. [Agent37 verification](agent37-verification.md) records the older development-instance CLI/SDK run. These records remain evidence for those particular runs; they are not passes for the replacement production application.
