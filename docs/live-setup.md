# Standalone deployment status

The MVP is moving to [07rjain/passman](https://github.com/07rjain/passman). The owner will retire the earlier Vercel and Clerk resources and configure replacements. No replacement deployment, Clerk instance or real signup is established by this repository extraction.

## Replacement setup checklist

- [ ] Import the new repository into Vercel with Root Directory `apps/web`, Node.js 24 and the committed install/build commands.
- [ ] Configure a separate test PostgreSQL database/runtime role and run the additive migration with its separate owner connection. Reusing a database requires an explicit account-binding decision; never reset or merge existing data silently.
- [ ] Create/configure Clerk for the intended stable origin. Set matched frontend, issuer and public RSA verifier settings; any server-only backend credential must belong to the same instance.
- [ ] Obtain the replacement instance's exact DNS targets, verify DNS/certificates and preserve unrelated websites. Earlier DKIM/mail targets are instance-specific and must not be copied blindly.
- [ ] Complete ordinary browser email signup/verification and sign-in without a testing token. Inspect Protect decisions if blocked; recreating infrastructure does not guarantee a policy rejection disappears.
- [ ] Confirm health and denied-request behavior, then perform CLI approval, local encrypted upload, exact SDK retrieval, read-only enforcement and revocation.
- [ ] Record commits, client version, environment/platform, feature case IDs, actual results, cleanup and unresolved cases here.

See [deployment.md](deployment.md#fresh-standalone-deployment) for the concrete setup sequence and [feature.md](feature.md) for the full acceptance catalogue. Do not paste credentials, private keys or provider values into this record.

## Historical evidence

[The previous hosted setup and Clerk investigation](history/legacy-hosted-setup.md) records infrastructure/API checks and a Protect policy rejection on the former deployment. [Agent37 verification](agent37-verification.md) records the older development-instance CLI/SDK run. These records remain evidence for those particular runs; they are not passes for the replacement production application.
