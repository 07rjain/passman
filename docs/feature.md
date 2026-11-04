# Passman feature and regression checklist

This is the maintained feature/test catalogue for the standalone **Passman MVP**. It does not describe the older application in `07rjain/keyman`. Update it whenever a feature, permission, wire contract, storage format or supported platform changes. A checklist entry is an expected result, not proof that the test ran.

Current client release: 0.1.1. Authentication target: Clerk **production** for the hosted production app; development instances and reserved OTPs remain confined to isolated test environments. The [Agent37 report](agent37-verification.md) records the earlier development-instance run, not production authentication acceptance.

The historical [2026-10-31 production configuration record](history/legacy-hosted-setup.md#production-clerk-cutover--2026-10-31) establishes matching live frontend/issuer/verifier settings, DNS/TLS and live denial checks. It applies to the former Keyman deployment and does not close actual inbox/browser, reverification, signup CAPTCHA or the authenticated production client journey cases.

## How to use this for every feature

1. Identify the case IDs below affected by the feature and add IDs for new behavior. Include normal, invalid, interrupted and unauthorized requests.
2. Add meaningful automated coverage alongside the change. A regression test should fail with the original bug. Mark gaps honestly instead of claiming manual checks are automated.
3. Run the full MVP automated suite below for behavior changes, then repeat affected live/manual cases. Authentication, cryptography, authorization, enrollment, migration and release changes require the complete applicable live journey as well.
4. After tests pass, update user/API/configuration documentation, this catalogue and the appropriate changelog. SDK/CLI releases use [SDK_CHANGELOG.md](SDK_CHANGELOG.md) and semantic versions; never overwrite an existing release.
5. Attach a dated result record to the change: commit, client/server versions, environment, case IDs, actual result, evidence, cleanup and explicit skipped/blocked cases. Do not reuse an old green result as evidence for new code.

Documentation-only edits need documentation checks, not invented application tests. CI success does not establish real email delivery, browser behavior, backups or an independent audit.

## Required automated commands

From a clean clone with Node.js 24/npm 11:

```sh
npm ci
npm run check
npm run test:distribution
```

Run database integration against a **disposable local database named `keyman_mvp_test`**, with the test bootstrap role described in [testing.md](testing.md):

```sh
MVP_TEST_DATABASE_URL=postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/keyman_mvp_test npm run test:integration
```

`npm run check` includes repository-local documentation checks (`npm run docs:check`).

Never point integration tests at the deployed Neon database. `npm run check` covers formatting, builds, TypeScript, lint, unit tests and installed-package consumption. The distribution command additionally tests the self-contained release archive and installer. The dedicated MVP CI runs Linux/macOS checks and real PostgreSQL integration; see [the workflow](../.github/workflows/mvp.yml).

## Test evidence map

| Evidence | What it establishes | Limits |
| --- | --- | --- |
| [Crypto tests](../test/crypto.test.ts) | HPKE interoperability, context binding, wrong-key/tamper rejection, sizes/encoding | Does not audit the cryptography or establish an honest website |
| [Vault/client tests](../test/vault.test.ts) | Protected local file, unlock failures, client response bounds | Does not isolate same-OS-user malware |
| [Auth tests](../test/auth.test.ts) | Real verifier with signed fixture JWTs: key/issuer/origin/session/expiry/recent-auth checks | Does not log into a live Clerk production instance |
| [Workflow integration](../test/workflow.integration.ts) | Built Next.js, real PostgreSQL, actual CLI/SDK, isolation, conflicts, expiry/replay/revocation | Fixture JWTs; no real inbox or browser interactions |
| [Distribution checks](../distribution/check.mjs) | Offline archive consumption, SDK types/runtime, HTTPS installer, upgrade/tamper/missing-release/vault preservation and version tooling | Downloads a pinned Node runtime; does not validate every desktop configuration |
| [Agent37 verification](agent37-verification.md) | Independent Linux VM, actual release, genuine Clerk development sessions and live service operations | Development test OTPs, not production email or visual browser forms |
| [Production manual/adversarial run](manual-security-test-2026-11-01.md) | Two VMs, two existing production accounts with real browser/inbox verification, native approval/forms/reverification, CLI/SDK lifecycle and targeted attacks | Finite coverage; signup, destructive load/disaster drills, full platform matrix and independent audit remain unverified |
| [Standalone clone verification](testing.md#standalone-repository-verification--2026-10-31) | Independent source checkout, direct web prerequisite build, package/installer checks and disposable PostgreSQL workflow | Local Linux; replacement deployment/browser/inbox acceptance remains open |
| Manual acceptance below | Real platform/domain/provider/browser/operations behavior | Record actual results per run; no standing blanket pass |

## 1. Installation, updates and SDK distribution

| ID | Test and expected result | Verification |
| --- | --- | --- |
| DIST-01 | Public installer works as a normal user on supported macOS/Linux arm64/x64; no source checkout, existing Node/npm or sudo is needed | Distribution checks + platform smoke |
| DIST-02 | Private runtime and CLI start; `passman --version` matches the release/package/changelog | Distribution + installed npm archive |
| DIST-03 | `passman login` and `signin` use the hosted default; `--url` supports self-hosting without silently changing an existing vault's origin | Workflow + CLI smoke |
| DIST-04 | Help/version work without unlocking a vault; help matches supported commands | Packaging + CLI smoke |
| DIST-05 | Reinstallation and a newer version retain the encrypted vault and key identity; the previous executable is retained | Distribution + restart smoke |
| DIST-06 | Missing release, bad checksum, invalid version, failed download or failed version check does not replace the working client | Distribution + negative installer smoke |
| DIST-07 | Unmanaged `passman` files and unexpected symlinks are not overwritten; custom absolute paths including spaces work | Installer smoke; paths with spaces/quotes covered by distribution checks |
| DIST-08 | Exact archive installs through npm without registry dependencies; ESM exports and TypeScript declarations work in a separate consumer | Packaging + distribution checks |
| DIST-09 | Archive contains license/notices and built client/dependencies; no `.env`, vault, private key, server config or test credential is packaged | Packaging + distribution inspection |
| DIST-10 | Hosted installer points to an immutable tagged release; updates select a new version rather than overwriting old assets | Release smoke and GitHub release inspection |

## 2. Clerk authentication and production configuration

| ID | Test and expected result | Verification |
| --- | --- | --- |
| AUTH-01 | Production frontend uses `pk_live_`; issuer and RSA public verifier belong to that same verified production instance | Deployment inspection + live signup |
| AUTH-02 | Production domain/DNS/certificates, allowed origins and redirects work at the configured stable origin | Clerk dashboard + real browser |
| AUTH-03 | Open email signup verifies a real inbox; sign-in, sign-out and subsequent sign-in work | Real production browser/inbox; reserved test OTPs are not evidence |
| AUTH-04 | User A's workspace/one-time credential state is cleared when signing out or switching to B | Browser regression; currently manual |
| AUTH-05 | Invalid signature, wrong issuer/origin, missing session or expired JWT cannot authorize owner operations | Auth tests + integration |
| AUTH-06 | Stale authentication cannot mutate state; Clerk reverification resumes the intended action and cancellation does not submit it | Integration rejection + actual UI reverification |
| AUTH-07 | Bot protection stays enabled; sanctioned testing tokens are used only in isolated tests, not as a production login shortcut | Auth configuration + live negative case |
| AUTH-08 | Clerk key rotation updates the verifier deliberately; mismatched frontend/backend instances fail closed | Deployment rehearsal |
| AUTH-09 | Before changing Clerk instances, inspect existing user/vault bindings. Never match accounts solely by email, reset vaults, regenerate customer keys or delete ciphertext to make a cutover work | Mandatory operator/migration gate; not an automatic migration feature |
| AUTH-10 | Production and preview environments use their own matching auth settings/data; owner database credentials and test keys are absent from the production runtime | Deployment/configuration inspection |

## 3. Local setup and approval handshake

| ID | Test and expected result | Verification |
| --- | --- | --- |
| SETUP-01 | Initial login generates the private key locally, persists it before network setup, and uploads only the public key | Vault/workflow + live CLI |
| SETUP-02 | Terminal fingerprint matches the approval page; the user must enter that terminal's code and acknowledge the loss policy | Workflow/API + actual UI |
| SETUP-03 | Wrong code/fingerprint, unauthenticated approval, expired transaction and replayed claim are rejected | Workflow integration |
| SETUP-04 | Public browser URL contains only the request ID; claim credentials/private keys are not placed in URLs or routine logs | Workflow/transport inspection |
| SETUP-05 | Pending/unapproved setup cannot obtain upload authority; a successful one-time claim issues only a short-lived upload credential | Workflow + live CLI |
| SETUP-06 | Interrupted approval/claim retries with the same vault; a completed claim cannot be reused | Workflow + interruption rehearsal |
| SETUP-07 | Re-login with the same key preserves account/vault identity and renews upload authorization | Workflow + live CLI |
| SETUP-08 | A fresh key under an existing account is rejected; Clerk login alone does not replace/recover the old private key | Workflow + Agent37/live API |

## 4. Local vault and encryption

| ID | Test and expected result | Verification |
| --- | --- | --- |
| VAULT-01 | Directory/file are owner-only; wrong ownership, permissive modes, oversized files and file symlinks fail | Vault tests + supported-platform smoke |
| VAULT-02 | Wrong passphrase or tampered encrypted vault fails; initialization does not overwrite an existing vault | Vault tests |
| VAULT-03 | Correct manual unlock restores the original identity; ordinary SDK unlock omits upload authorization | Vault/client tests |
| VAULT-04 | Restart requires local unlock; encrypted identity survives restart and still decrypts previously uploaded values | Live machine restart |
| CRYPTO-01 | UTF-8 and empty values round-trip; independent encryption produces independent envelopes | Crypto tests |
| CRYPTO-02 | Wrong private key, altered ciphertext/envelope and noncanonical encoding fail | Crypto tests |
| CRYPTO-03 | Changing account, vault, project ID/name, secret name or revision breaks the encrypted context binding | Crypto tests + SDK checks |
| CRYPTO-04 | Local upload sends ciphertext; hosted retrieval contains no plaintext value or private decryption key | Workflow transport/persistence checks + live SDK |
| CRYPTO-05 | Names/labels remain readable metadata; values stay encrypted. A public recipient key does not prove writer identity or latest-record freshness | Protocol review; do not claim unsupported guarantees |

## 5. Projects and secret lifecycle

| ID | Test and expected result | Verification |
| --- | --- | --- |
| DATA-01 | Create/list a project; duplicate/invalid names fail without partial writes | Integration + website smoke |
| DATA-02 | Create a named value locally; SDK returns the exact value under the correct project/name | Integration + live CLI/SDK |
| DATA-03 | Replace requires deliberate authorization; revision increments; a stale/concurrent write conflicts without silently overwriting committed data | Integration + update smoke |
| DATA-04 | Secret deletion requires the matching account/project/revision; stale or cross-account deletion fails | Integration + Agent37/live API |
| DATA-05 | Search/existence/pagination return allowed metadata, not values; missing and inaccessible results do not enumerate another account | Integration + SDK smoke |
| DATA-06 | Same secret/project names in different accounts remain isolated; one account cannot issue credentials for another account's project | Integration + two-account live case |
| DATA-07 | Maximum sizes, invalid JSON/content type, malformed envelope and oversized response fail with bounded/redacted errors | Crypto/client/integration; extend boundary coverage with new fields |
| DATA-08 | Optional browser entry encrypts before upload and discloses its JavaScript trust boundary; it never imports a vault private key or reveals an existing value | Supported-browser manual case |
| DATA-09 | Truncated dashboard lists are indicated; SDK pagination remains usable for larger collections | Boundary integration/manual case; do not treat small fixtures as scale testing |

## 6. Service credentials and authorization

| ID | Test and expected result | Verification |
| --- | --- | --- |
| TOKEN-01 | New read credential is displayed once, has the chosen scope/expiry and is stored only as a hash | Integration + website smoke |
| TOKEN-02 | Missing, malformed, unregistered, expired or revoked credentials cannot retrieve records | Integration + live denial/revocation |
| TOKEN-03 | Project-scoped token cannot access another project; all-project scope stays inside its account | Integration + live scope checks |
| TOKEN-04 | Read credentials cannot upload, create projects, delete secrets or issue other credentials | Integration + live denied operations |
| TOKEN-05 | Temporary upload credentials expire/revoke and cannot obtain read/admin powers | Integration + lifecycle rehearsal |
| TOKEN-06 | Valid read key alone can fetch permitted ciphertext from another host, but does not supply a decryption private key. An unlinked SDK identity rejects retrieval; a wrong key cannot decrypt | Crypto/integration + live raw-response/SDK cases; no server machine-signature claim |
| TOKEN-07 | Revocation stops future authentication but cannot erase copied plaintext/ciphertext or revoke an exported provider key at its provider | Live API + documented threat boundary |
| TOKEN-08 | Unknown, expired, revoked and active bearer attempts consume durable per-token quota; rotating/malformed tokens share a bounded pre-lookup quota; forwarding headers cannot split it | Workflow PostgreSQL regression; execution pending, see testing record |
| TOKEN-08 | Credentials/values do not enter argv, normal logs, model-facing output or unredacted errors | CLI/transport inspection + negative-path checks |

## 7. Hosting, failures and operations

| ID | Test and expected result | Verification |
| --- | --- | --- |
| OPS-01 | Clean web build compiles core first; correct Node.js version, shared files and installer are included | CI + Vercel build |
| OPS-02 | Health is ready only with required configuration/schema/database; unavailable prerequisites fail closed | Integration + deployment smoke |
| OPS-03 | Canonical Host/origin is pinned; forged forwarding headers do not change trust; foreign browser origins are rejected | Integration + live API |
| OPS-04 | Private API responses are no-store; clients reject redirects and bound request/response size and duration | Integration/client tests |
| OPS-05 | Restricted runtime role can perform required table operations but cannot administer roles/databases or create schema objects | Real PostgreSQL role checks |
| OPS-06 | Repeating migration preserves data and identities; incompatible changes need a versioned migration and rollback plan | Integration + deployment rehearsal |
| OPS-07 | Outages, interrupted requests and retries do not silently regenerate a vault, broaden permissions or overwrite a newer value | Integration + fault rehearsal |
| OPS-08 | Edge/IP protection, DB counters, monitoring and spending limits are evaluated under realistic abuse/load | Operational rehearsal; current counters alone are not complete protection |
| OPS-09 | Encrypted database backup/restore and client-vault restore are rehearsed separately, including stale-data consequences | Operator drill; not established by normal unit tests |
| OPS-10 | Test secrets are removed, credentials revoked, test users removed and temporary VMs deleted; residual metadata is recorded | Teardown evidence |
| OPS-11 | A clean standalone clone installs/builds/tests/packages without files from the former parent repository; license, documentation checks and CI paths are local | Independent source snapshot + full checks |

## Complete live journey after security or release changes

- [ ] Use an isolated account/environment and synthetic values; record client/server commits and platform.
- [ ] Install the public package on a fresh machine as a normal user.
- [ ] Complete the appropriate real Clerk signup/sign-in and CLI approval. Production acceptance uses a real inbox and production credentials.
- [ ] Create two projects, upload a secret, retrieve its exact value, replace it, and verify stale-write rejection.
- [ ] Check search/existence/missing values and same-name isolation with a second account.
- [ ] Verify wrong-project, cross-account, read-token write/admin, missing-token and wrong-key denials.
- [ ] Restart and unlock the same vault; confirm exact retrieval.
- [ ] Reject a fresh key replacing the existing account vault; preserve the working key/data.
- [ ] Reinstall/update the client and exercise a failed update without losing vault identity.
- [ ] Revoke credentials and verify further reads fail; delete synthetic entries.
- [ ] Remove test accounts/temporary infrastructure and record any retained metadata.

Do not run destructive integration fixtures against production or bypass real authentication to mark this journey complete.

## Known exclusions and future features

Multi-machine private-key transfer, account-only recovery, project/account purge, `.env` bulk import, environment injection, unattended SDK mutation, Windows, Homebrew and npm-registry publication are not established features of this MVP. Add specifications, case IDs and automated coverage before advertising them. The older root application's feature set is not evidence of MVP support.

## Per-change result template

```text
Change / commit:
SDK version / server commit:
Environment / Clerk mode / platform:
Affected and new case IDs:
Automated commands and actual outcomes:
Live/manual case IDs and evidence:
Skipped / blocked cases and reasons:
Migrations / compatibility / rollback:
Test data and infrastructure cleanup:
Changelog and documentation updates:
```

## Audit regression cases

| ID | Required behavior | Evidence |
| --- | --- | --- |
| AUD-01 | Successful changes and audit rows commit together; audit failure rolls back the change | PostgreSQL integration |
| AUD-02 | Denial survives transaction rollback and exposes only a safe reason | PostgreSQL integration |
| AUD-03 | Accounts cannot view one another's activity; read tokens cannot administer it | API integration |
| AUD-04 | Activity and server diagnostics contain no values, private keys or bearer credentials | Redaction assertions |
| AUD-05 | Concurrent requests retain separate actor/resource/request identities | PostgreSQL integration |
| AUD-06 | Pagination/filtering have no overlapping IDs across older pages; invalid cursor rejected | API integration |
| AUD-07 | Signed session webhook retries deduplicate; forged/stale signatures fail | Signature + PostgreSQL integration |
| AUD-08 | Runtime cannot alter/delete audit history; maintenance retention deletes only expired events | PostgreSQL integration |
| AUD-09 | Anonymous attack events are bounded; audit outage returns unavailable | PostgreSQL integration |
| AUD-10 | Native browser activity filtering and pagination work on supported browsers | Manual browser acceptance pending |
| AUD-11 | Production webhook delivery, scheduled pruning and operator alerts work | Deployment acceptance pending |
| AUD-12 | Expired/revoked bearer denials retain one attributed representative per credential/minute/action/reason; successful authenticated events remain individual | Workflow PostgreSQL regression; execution pending, see testing record |

## Agent skill checks

| ID | Required behavior | Evidence |
| --- | --- | --- |
| SKILL-01 | Skill frontmatter, naming and portable references validate | Skill validator, GitHub dry-run and docs checks |
| SKILL-02 | Public repository skill is discoverable/installable without credentials | Isolated skills CLI installation |
| SKILL-03 | Instructions match actual CLI/SDK permissions, pagination and unlock behavior | Review against current implementation and existing SDK/CLI regression evidence |
| SKILL-04 | No supplied private credentials enter skill files or publication | Changed-file credential scan |
| SKILL-05 | Agent uses a secret for an approved task without printing it | Client-specific live acceptance pending; instructions are not isolation |

## Windows regression cases

| ID | Required behavior | Evidence |
| --- | --- | --- |
| WIN-01 | Current-user-only NTFS ACLs protect vault/private inputs; shared ACLs rejected | Native Windows unit tests |
| WIN-02 | Junction/reparse vault paths rejected; save/unlock preserves key identity | Native Windows unit tests |
| WIN-03 | Private Node runtime and managed launcher install/reinstall with spaces/Unicode paths | Native PowerShell installer checks |
| WIN-04 | Corrupt downloads fail without changing active version or vault | PowerShell installer checks |
| WIN-05 | Installed SDK encrypts/unlocks, rejects wrong passphrase and preserves vault format | Native installed-client checks |
| WIN-06 | Production browser approval and interactive hidden prompts work on Windows | Live acceptance pending |
| WIN-07 | Native ARM64 installer/runtime passes equivalent checks | ARM64 acceptance pending |
