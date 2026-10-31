# Agent37 VM verification — Passman 0.1.0

Historical run against the earlier `07rjain/keyman` deployment. Repeat live acceptance after the standalone Vercel/Clerk setup; these results do not certify the replacement.

Date: 2026-10-31. Target: https://passman.subdomain.wtf and the public `passman-v0.1.0` GitHub release. This is independent client verification, not a security audit or production approval.

## Environment

Provisioned a new Agent37 full Ubuntu VM in the US with 2 vCPU, 4 GB RAM and 12 GB disk. The VM reported Ubuntu 26.04, Linux 7.0.0-38-generic, x86-64. Created a separate unprivileged `passmantest` account (UID 1001); installation and client checks ran as that user. No repository checkout, local build output, existing vault or customer credential was transferred to the VM.

The public installer installed Passman 0.1.0 with its private Node.js v24.22.2 runtime. The released SDK archive was installed independently through npm. Agent37's control credential stayed on the controlling machine and was not included in VM shell commands.

## Passed on the real VM

- Public website installer completed and the installed command reported 0.1.0.
- Re-running the installer completed and retained the working 0.1.0 command.
- A deliberately unavailable release (`9.9.9`) failed without changing the installed command or encrypted vault bytes.
- The independent SDK script passed eleven assertions: owner-only vault directory/file permissions; private key absent from the plaintext on-disk JSON; wrong-passphrase rejection; correct unlock restoring the original key; actual HPKE encryption/decryption; wrong-project context rejection; unlinked SDK identity rejection; live database-backed health; unauthenticated console denial; unauthenticated secret-read denial; and rejection of a well-formed but unregistered service credential.

These are actual processes and network calls on the provisioned VM. Encryption checks used synthetic values and local keys; anonymous API checks targeted the hosted service. They are separate from the earlier local fixtures and CI results in [releases.md](releases.md).

## Authenticated checks passed

The installed CLI and published SDK completed seventeen additional checks against the hosted application:

1. Reserved development email verification completed and Clerk issued a real signed session.
2. The live API accepted that genuine Clerk JWT.
3. The installed `passman login` generated a local identity, received authenticated approval and claimed it once.
4. The installed CLI encrypted and uploaded a synthetic value without printing it.
5. The published SDK retrieved the hosted ciphertext and decrypted the exact original value.
6. Search, existence and missing-name behavior worked.
7. A project-scoped read key could not read another project in the same account.
8. Direct retrieval with the read key returned ciphertext without the provider plaintext.
9. The read key could not use the administrative upload route.
10. A fresh, unlinked local identity could not use SDK retrieval with that valid read key.
11. A fresh machine key could not replace the account's existing vault (`409 KEY_MISMATCH`).
12. The denied replacement preserved the original identity's secret access.
13. A second real Clerk test account could not read/delete the first account's secret or issue a credential scoped to its project.
14. Equal project names in different accounts stayed isolated; attempted cross-account deletion left the original value readable.
15. After an actual Agent37 VM restart, the same encrypted vault unlocked and retrieved the exact original value.
16. Revoking the read key made subsequent SDK retrieval fail with `UNAUTHORIZED`.
17. All synthetic secret entries were deleted and all test credentials were revoked.

Both test accounts and their local identities existed on the same independent VM. This is not a claim of successful private-key transfer or two-host sharing; the current MVP intentionally refuses a fresh key for an existing account.

## Clerk test boundary

Clerk initially returned `403 action_blocked` to automated signup. Its official short-lived testing token then authorized the test traffic without disabling signup protections. The backend development key was validated against the deployed instance's public verifier and stayed on the controlling machine; only the testing token was transferred privately to the VM. The two reserved `+clerk_test` accounts used Clerk's documented development verification code, so no emails were sent.

Clerk generated the sessions; the tests did not mint substitute JWTs or bypass Keyman's verifier. These tests exercised authentication/approval APIs and the real CLI/SDK, not the visual browser form or actual email delivery. Interactive Mac use, production Clerk configuration and independent security review remain open.

A valid MVP read credential can fetch authorized ciphertext from another host. The unlinked SDK denial above is not server-side machine-proof enforcement. Decryption requires the original private key; the application does not promise hardware isolation or protection against a fully compromised client.

## Cleanup and remaining limits

The synthetic secret entries were deleted, all test read/upload credentials revoked, both reserved Clerk users deleted, and VM `1alhlt0570` deleted successfully to end its billing. Temporary local Clerk key/testing-token files were removed. The existing Agent37 account credential was not changed.

Empty synthetic Keyman account/project metadata and revoked credential records remain in the database: the MVP has no project/account purge API. No provider value remains in those test entries. Pending enrollment records expire normally. No customer's vault, account or provider credential was used or altered.

All checks in this run passed after enabling Clerk's sanctioned test mechanism. No application code fix was needed. This is an independent Linux client acceptance run, not a browser UI test, penetration test, load test, disaster-recovery exercise or production audit. See [testing.md](testing.md) for remaining acceptance work.
