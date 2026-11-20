# Passman product requirements

Fresh alpha source is now implemented in separate packages/routes/schema. [Fresh setup](fresh-quickstart.md) documents the working interfaces; [verification](fresh-testing.md) records synthetic tests and remaining native/browser/operational acceptance. No publication/deployment or old-data migration is implied.


Status: experimental standalone implementation, extracted from the former Keyman MVP into [07rjain/passman](https://github.com/07rjain/passman). The implementation and vault/API/database formats are preserved. Replacement Vercel/Clerk/database configuration is deployed and basic setup checks pass; targeted two-account browser/VM acceptance is recorded in the manual security report; wider release validation remains open. Follow the [design decisions](simplified-design.md), [plan](plan.md) and [current setup checklist](live-setup.md). Historical infrastructure and VM checks do not establish acceptance for a newly created Clerk instance.

## Purpose

Store generic named secret values encrypted on a service and retrieve/decrypt them locally through a library. Keep setup and normal use simple, with human account authentication, local vault encryption material and read-only application service credentials.

## MVP requirements

### From-scratch replacement requirements — confirmed 2026-11-20, not implemented

Latest user decisions: website secret **submission only**, pending trusted local verification of exact name/value, with no website activation/update/overwrite/delete. Administrative CLI/SDK support creation, activation, update and deletion, including headless/CI through separately provisioned administrative credentials and local write authority. Show a read-only inventory of registered installations and logical deployments with last-seen and active/inactive status, not a census of physical key copies. See [the draft](fresh-design.md) and [consolidated security review](fresh-design-security-review.md).

The [fresh design draft](fresh-design.md) is the source for the new product. No legacy SDK, ciphertext, key-value or vault-format compatibility/migration is required. It supersedes the 2026-11-19 proposal; existing deployed data is not deleted by this decision.

Use one versioned account-wide vault key, website-issued read-only service credentials with optional expiry/non-expiry, and locally configured automatic decryption without read approvals or password prompts. A service key alone lists authorized projects/names and fetches ciphertext; matching local key material is needed only for plaintext. Intentional plaintext retrieval by applications/models is allowed; accidental logs remain redacted. Runtime SDKs cannot mutate secrets.

Several accounts' vault keys may coexist on one installation. Each account's ordinary key copies are identical across machines; neither new machines nor new service keys generate another vault key. The chosen service credential identifies the account automatically, and the SDK selects local material by origin/account/vault/key version without asking users to choose a decryption key. Cross-account metadata/key substitution, trial decryption with another account's key and a global last-used-key fallback are forbidden. Deliberate key rotation is separate from ordinary synchronization.

Support an explicit SDK transfer-code path between machines, carrying the selected account's existing vault/decryption material and authenticated identifying/context details. The receiver installs the same key under that account's namespace. Do not copy source service keys, vault passwords, management sessions or other accounts' material. This supplements automatic password-based sync; it is not a per-read approval. The user selected long high-entropy copy/paste codes with expiry and one recipient claim; short manually typed codes are excluded. Allow safe bounded resumption of that same interrupted claim. Exact encoding/transport/claim semantics are draft engineering work.

The JavaScript/TypeScript SDK and CLI target desktop/headless Windows, Linux and macOS, Linux containers/servers and ordinary Node.js cloud functions; edge runtimes are deferred. Use protected OS/deployment storage for unattended startup. Password bootstrap requires management login or explicit service-key bootstrap permission; normal runtime keys may refresh their encrypted keyring but cannot download the password wrapper. Transfer claims require both the complete code and the recipient's same-account service credential. Account login plus vault password restores full administrative writer authority as well as decryption after local loss; runtime sync material cannot decrypt administrative recovery packages. If the password is forgotten and only read-only keys survive, administration is unrecoverable: no read-key/login/support promotion or writer-root replacement bypass. Existing authorized reads can continue without constituting administrative recovery. No server plaintext escrow is allowed.

The website encrypts new submissions without a private decryption/writer key and leaves them pending. Trusted local clients verify exact intent and activate signed records. Default plaintext reads reject unsigned/pending values and API-supplied writer-root replacement, including on fresh clients. The draft proposes public-recipient encryption with separate local writer signatures and a writer-signed runtime keyring anchored in authenticated bootstrap state. Website sessions cannot activate/update/delete, mint equivalent native authority alone or use project cascades/renames as a bypass. Global replay/omission limits remain explicit; project API scopes do not provide per-project cryptographic isolation.

### Earlier implementation requirements — historical compatibility baseline only

The remaining sections describe the existing implementation and its release evidence. They do not impose immutable keys, manual unlock, website value entry, migration support or no-recovery rules on the from-scratch replacement.

- Support CLI/administrative-SDK `.env` import: validate the full UTF-8 file (64 KiB/100 entries), preview names without values, require explicit conflict/empty-value decisions and confirm the save. Encrypt locally and atomically commit all selected revisions plus an aggregate audit event; runtime credentials remain read-only. A lost commit response is an unknown outcome, with no automatic retry. See [import specification](env-import.md).

- Implemented stack: Next.js/TypeScript on Node.js 24, Clerk session JWT verification, Neon-compatible PostgreSQL, and an independent TypeScript SDK/CLI workspace. Target hosting is Vercel, with committed install/build commands and a default app build that compiles its shared prerequisite; no running server/database is created merely by building.
- Use open email signup for early testers, with email verification enabled. Invite-only access and GitHub sign-in are not required for this rollout. The API trusts verified sessions from the configured Clerk instance; public signup is not an allowlist of early testers.
- Explicit local setup/login generates private key material locally and registers the public encryption key after bound Clerk authentication.
- Reject replaceable local vault/input paths and bind Windows input ACL verification to the read handle. Preserve existing vault data during updates.
- Protect the local private key with a passphrase-encrypted file; do not upload it to Keyman or Clerk.
- Prefer local administrative entry/encryption/upload of values. Optional website entry encrypts before normal upload but must disclose that hosted JavaScript can access the input.
- Store readable names and encrypted values. Use established authenticated/hybrid encryption with bound record/account context.
- Organize entries by project/name. Projects are organizational namespaces; account isolation and endpoint authorization remain security requirements.
- Support website project creation, entry replacement/deletion and read-credential issuance/revocation. Local `login` issues a 20-minute upload-only credential; CLI `put` and the separately exported administrative `uploadValue` helper use it. The runtime `KeymanClient` has no mutation method; read credentials never receive write privileges implicitly.
- Interactive CLI `put` renews missing/expired upload authorization through the existing bound browser approval before reading the secret, preserving the same key/account/origin and honoring `--no-browser`. Noninteractive `put` stops with login guidance before value input. Renewal is attempted once; failed approval or already-expired new authorization stops safely. Ordinary SDK calls never open a browser or renew credentials.
- Issue high-entropy, read-only bearer service credentials with expiry/revocation; persist only hashes. The API receives usable tokens during authentication and must redact them.
- Apply least-privilege runtime database grants, preserving immutable account key bindings and migration state. Partition public admission by a trusted deployment-provided client address before shared limits.
- Commit bearer attempt quotas independently of authentication outcomes, bound rotating candidates before credential lookup, and retain bounded attributed evidence of repeated expired/revoked denials. See [security.md](security.md) for thresholds and shared-quota availability limits.
- Support programmatic search, retrieval, local decryption and typed/redacted errors. Application code receives plaintext; avoid returning it to model-facing tool results.
- Keep credentials, private keys and sensitive errors out of model prompts, logs, telemetry and source control.
- Provide no account-only recovery, support override or private-key sharing in the MVP. Loss of every usable private-key copy makes affected ciphertext unrecoverable.

## Client installation and versioning

- Introduce the local-key model on a responsive public landing page with platform-specific installation, a realistic SDK example, existing Clerk sign-in and clear key-loss/browser-input limits. Use a matching Passman mark for browser and Apple touch icons. Decorative artwork must not process customer data or imply a cryptographic guarantee.
- Make the public pages and authenticated dashboard usable from 320px through desktop, including approval, long metadata, credentials and account activity. Provide canonical/social sharing metadata, discoverable support, a single expandable “Contact us” control for call, website and email links in public footers and a public point-in-time readiness page based on the existing health check; it must distinguish unknown results from confirmed readiness and must not imply incident history, monitoring or authentication acceptance.
- Provide macOS/Linux arm64/x64 and Windows x64/arm64 installers, `passman login` with the hosted default, and a typed Node.js SDK installable from a versioned package archive without cloning the repository.
- Include a private Node.js 24 runtime in the installer experience; do not require sudo or modify existing system Node installations or vault identities.
- Make `passman` available by name after macOS/Linux installation: persist PATH for Bash/Zsh/POSIX login shells while preserving existing settings, and activate the current terminal in the copied installation command. Preserve manual configuration and an opt-out for managed shell profiles.
- Gate production promotion of signed installers on verified public signed-client availability, so a source merge cannot strand new installations.
- Authenticate installer archives using a pinned publisher signature; protect signing authority and reviewed bootstrap source independently of GitHub release-write access.
- Version the SDK/CLI together using semantic versions, maintain a changelog, verify downloaded checksums and publish immutable release assets. See [releases.md](releases.md). Windows installation is documented in [windows.md](windows.md); Homebrew distribution remains deferred.

## Explicit limits and exclusions

The initial model has one immutable vault public key per Clerk account and no machine roster/delegation. Same-key re-login renews local upload authorization. A fresh key cannot replace the old one; a destructive empty-vault reset is not implemented. Projects use one account's vault key, although a read credential may filter its API access to one project.

The optional website-input path does not preserve new-input confidentiality against a malicious website/server. A compromised client or arbitrary-code agent with equivalent vault access may obtain plaintext. Neither read-token revocation nor deletion erases downloaded ciphertext or copied provider keys.

Multi-machine private-key transfer, browser-to-local-port bridging, broader unattended SDK mutation and optional provider/task adapters are future work. The SDK/store remains provider-independent. Do not describe the prior application's machinery as implemented in this MVP.

A future Node.js 26.x upgrade is tracked in the [implementation plan](plan.md). Validate compatibility, encryption/vault behavior, SDK/CLI, packaging, integration and deployment before updating the current Node.js 24 baseline.

## Acceptance

Maintain and execute the applicable cases in [feature.md](feature.md) for every new feature. The hosted production target must use the verified Clerk production instance; development-mode acceptance is not evidence of real production email/browser behavior. Before switching instances, preserve any existing account/vault bindings through an explicit migration decision.

Before release, verify the encryption/credential/authorization/loss/agent-output cases in [simplified-design.md](simplified-design.md), document the supported interfaces and demonstrate a clean setup-to-retrieval workflow. A migration from the earlier application requires its own explicit plan and data-preservation checks.

## Audit trail

The [audit guide](audit.md) defines metadata-only event coverage, transaction/failure behavior, account-scoped activity, signed session webhooks and maintenance retention. Migration 2, restricted runtime grants and separate webhook configuration are required for rollout. Local decryption, provider usage and Clerk failed-sign-in details are outside the application event stream. Immutable external export and automated alert delivery remain follow-up work.

## Agent skill and deferred MCP

Expose public `/llms.txt` setup/usage guidance and a complete documentation index, plus a generated `/llms-full.txt` snapshot for agents that need the full text. Keep them usable without authentication, link them from public pages and regenerate them from maintained public documentation during web build/development. Explain private setup, credential scopes, manual unlock, safe application use, support and recovery limits. Discovery depends on agent capabilities; these documents grant no access and add no autonomous execution or MCP service.

The [Passman skill](skills.md) provides portable instructions for local CLI metadata lookup and SDK retrieval/use without printing values. Public GitHub distribution uses the skills.sh discovery/install workflow; instructions do not grant access or create an unlocked session. Keep private credentials outside skill content/model output. Skill metadata is versioned separately from the client.

MCP remains future work: a local stdio adapter may wrap the SDK after login with privately configured service credentials and manual local unlock. Search/existence/status are metadata-only; raw retrieval/decryption would expose plaintext to the MCP client/model and requires explicit opt-in, disabled by default. Preserve read-only credentials, separate management authorization and the same local-key/OS-user limitations. See [the detailed scope](skills.md#future-mcp-integration).
