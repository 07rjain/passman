# Passman product requirements

Status: experimental standalone implementation, extracted from the former Keyman MVP into [07rjain/passman](https://github.com/07rjain/passman). The implementation and vault/API/database formats are preserved. Replacement Vercel/Clerk/database configuration is deployed and basic setup checks pass; targeted two-account browser/VM acceptance is recorded in the manual security report; wider release validation remains open. Follow the [design decisions](simplified-design.md), [plan](plan.md) and [current setup checklist](live-setup.md). Historical infrastructure and VM checks do not establish acceptance for a newly created Clerk instance.

## Purpose

Store generic named secret values encrypted on a service and retrieve/decrypt them locally through a library. Keep setup and normal use simple, with Clerk human authentication, a local vault encryption key pair and read-only application service credentials.

## MVP requirements

- Implemented stack: Next.js/TypeScript on Node.js 24, Clerk session JWT verification, Neon-compatible PostgreSQL, and an independent TypeScript SDK/CLI workspace. Target hosting is Vercel, with committed install/build commands and a default app build that compiles its shared prerequisite; no running server/database is created merely by building.
- Use open email signup for early testers, with email verification enabled. Invite-only access and GitHub sign-in are not required for this rollout. The API trusts verified sessions from the configured Clerk instance; public signup is not an allowlist of early testers.
- Explicit local setup/login generates private key material locally and registers the public encryption key after bound Clerk authentication.
- Reject replaceable local vault/input paths and bind Windows input ACL verification to the read handle. Preserve existing vault data during updates.
- Protect the local private key with a passphrase-encrypted file; do not upload it to Keyman or Clerk.
- Prefer local administrative entry/encryption/upload of values. Optional website entry encrypts before normal upload but must disclose that hosted JavaScript can access the input.
- Store readable names and encrypted values. Use established authenticated/hybrid encryption with bound record/account context.
- Organize entries by project/name. Projects are organizational namespaces; account isolation and endpoint authorization remain security requirements.
- Support website project creation, entry replacement/deletion and read-credential issuance/revocation. Local `login` issues a 20-minute upload-only credential; CLI `put` and the separately exported administrative `uploadValue` helper use it. The runtime `KeymanClient` has no mutation method; read credentials never receive write privileges implicitly.
- Issue high-entropy, read-only bearer service credentials with expiry/revocation; persist only hashes. The API receives usable tokens during authentication and must redact them.
- Apply least-privilege runtime database grants, preserving immutable account key bindings and migration state. Partition public admission by a trusted deployment-provided client address before shared limits.
- Commit bearer attempt quotas independently of authentication outcomes, bound rotating candidates before credential lookup, and retain bounded attributed evidence of repeated expired/revoked denials. See [security.md](security.md) for thresholds and shared-quota availability limits.
- Support programmatic search, retrieval, local decryption and typed/redacted errors. Application code receives plaintext; avoid returning it to model-facing tool results.
- Keep credentials, private keys and sensitive errors out of model prompts, logs, telemetry and source control.
- Provide no account-only recovery, support override or private-key sharing in the MVP. Loss of every usable private-key copy makes affected ciphertext unrecoverable.

## Client installation and versioning

- Provide macOS/Linux arm64/x64 and Windows x64/arm64 installers, `passman login` with the hosted default, and a typed Node.js SDK installable from a versioned package archive without cloning the repository.
- Include a private Node.js 24 runtime in the installer experience; do not require sudo or modify existing system Node installations or vault identities.
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

The [Passman skill](skills.md) provides portable instructions for local CLI metadata lookup and SDK retrieval/use without printing values. Public GitHub distribution uses the skills.sh discovery/install workflow; instructions do not grant access or create an unlocked session. Keep private credentials outside skill content/model output. Skill metadata is versioned separately from the client.

MCP remains future work: a local stdio adapter may wrap the SDK after login with privately configured service credentials and manual local unlock. Search/existence/status are metadata-only; raw retrieval/decryption would expose plaintext to the MCP client/model and requires explicit opt-in, disabled by default. Preserve read-only credentials, separate management authorization and the same local-key/OS-user limitations. See [the detailed scope](skills.md#future-mcp-integration).
