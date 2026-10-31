# Standalone deployment status

The standalone source is hosted in [07rjain/passman](https://github.com/07rjain/passman). A replacement Vercel project and custom domain are deployed as recorded below. Replacement Clerk/database configuration and a real signup remain pending; the current setup screen is not a functioning vault deployment.

## Replacement setup checklist

- [x] Import the new repository into Vercel with Root Directory `apps/web`, Node.js 24 and the committed install/build commands.
- [ ] Configure a separate test PostgreSQL database/runtime role and run the additive migration with its separate owner connection. Reusing a database requires an explicit account-binding decision; never reset or merge existing data silently.
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
- Configured Production `APP_ORIGIN=https://passman.subdomain.wtf`. No database URL, old Clerk credential or old account binding was silently copied into the new project. The owner is choosing fresh/reused resources before those settings are applied.
- Actual HTTPS checks: `/` returned 200 and the missing-Clerk setup screen; `/install.sh` returned 200 with the installer script; `/api/health` returned 503 `UNAVAILABLE`, as expected without the required backend configuration. This is not a passing health/authentication check.
- Local Vercel project metadata is linked in ignored `.vercel/`. No customer key, provider plaintext or deployment credential was added to Git.

Clerk/database resource choice is required to finish setup. Replacing the Vercel project alone does not resolve the previous Clerk Protect policy rejection. Use the checklist above and record ordinary signup/email verification and the authenticated CLI/SDK workflow separately.

## Historical evidence

[The previous hosted setup and Clerk investigation](history/legacy-hosted-setup.md) records infrastructure/API checks and a Protect policy rejection on the former deployment. [Agent37 verification](agent37-verification.md) records the older development-instance CLI/SDK run. These records remain evidence for those particular runs; they are not passes for the replacement production application.
