# Keyman — Engineering and Contributor Instructions

These instructions apply to agents and contributors working anywhere in this repository. Read [PRD.md](PRD.md) for product requirements and [plan.md](plan.md) for architecture, delivery milestones, and security acceptance criteria. Current user instructions take precedence when they explicitly change the intended work; keep the documents aligned with accepted decisions.

Passman is the standalone simplified MVP formerly developed in the `mvp/` folder of [07rjain/keyman](https://github.com/07rjain/keyman). This repository contains the website/API, local SDK/CLI, tests and maintained documentation. The earlier multi-machine application is not part of this repository and its requirements must not be imported automatically.

Passman uses PolyForm Noncommercial 1.0.0 in the root `LICENSE`. Commercial licensing terms and production approval remain future work; do not describe this license as OSI open source.

## 1. Work from the problem and preserve the architecture

Before changing code:

1. Identify the user problem, required behavior, and reason the feature is needed.
2. Trace the existing path and relevant module boundaries, contracts, tests, and security invariants.
3. Define observable acceptance criteria, including applicable failure and abuse cases.
4. Choose the smallest maintainable change that satisfies the requirement within the existing architecture.
5. State any compatibility, migration, or threat-model consequences before implementing them.

Prefer extending an existing appropriate abstraction over adding a parallel mechanism. Avoid speculative frameworks, generic layers, microservices, broad refactors, or new dependencies without a demonstrated need. Small changes should have proportionate plans.

The goal is minimal architectural impact, not the fewest possible lines. Do not patch around a broken invariant or create security exceptions to avoid a necessary fix. When a boundary genuinely needs to change, explain why, compare reasonable alternatives, record a short architecture decision, and include compatibility/migration steps. Architecture must not be overhauled as a side effect of unrelated work.

Keep changes focused. Preserve unrelated work and public behavior outside the requested scope. Do not add features merely because they may be useful later.

## 2. Required development workflow

For each code change:

1. Establish the expected behavior and affected contracts.
2. Add or update meaningful tests for that behavior. A bug fix should normally include a regression test that fails against the previous behavior.
3. Implement the focused change using existing conventions and boundaries.
4. Run the relevant tests and required quality checks. Investigate and fix failures; never weaken assertions, skip checks, hide errors, or reduce security validation merely to get a green result.
5. Once checks pass, update the affected documentation, examples, configuration instructions, and changelog/release notes as appropriate.
6. Verify the documentation matches the tested final behavior. If documenting reveals a code change is needed, make it and rerun the affected checks.
7. Review the diff for scope, correctness, credential exposure, backward compatibility, and clarity.
8. Report what changed, what was checked, and any remaining limitation honestly.

A code change is not finished while its required checks fail or its affected behavior is undocumented. If a prerequisite prevents verification, report the exact gap instead of claiming success. Do not claim implementation, deployment, or security validation from a plan or mockup.

Documentation-only changes require appropriate structural, link, example, and consistency checks. They do not need invented application tests. Do not create tests that only mirror implementation details or assert that source text exists.

## 3. Code quality and module boundaries

- Use the repository's established toolchain and conventions. The SDK, CLI, website and API use TypeScript on Node.js 24. Preserve the pinned toolchain unless a change is justified and tested.
- Use strict typing. Validate external input at trust boundaries; TypeScript types do not validate network requests, configuration, IPC messages, or database content at runtime.
- Keep functions and modules cohesive. Choose explicit names, straightforward control flow, and clear ownership of side effects.
- Avoid unsafe casts, unexplained `any`, global mutable state, hidden initialization, and implicit account/machine switching. Justify narrow exceptions where necessary.
- Use typed, actionable, redacted errors. Do not swallow failures or silently substitute insecure fallbacks.
- Centralize authorization, protocol canonicalization, and crypto operations in their designated modules. Avoid subtly different copies in routes, SDKs, and UI code.
- Keep network, local-vault and crypto responsibilities explicit. The SDK decrypts locally in the caller process. SDK import and ordinary requests must not generate keys or open a browser; login/setup is explicit.
- Respect versioned contracts between API, CLI, SDK and vault formats. Do not use a shared type definition as a substitute for wire compatibility or runtime validation.
- Add a dependency only when its benefit justifies maintenance, security, licensing, size, and platform costs. Prefer maintained established implementations. Commit the chosen lockfile and use reproducible installs.
- Make migrations explicit, versioned, tested, and compatible with the deployment sequence. Do not silently reset databases or user identities.

## 4. Security invariants

Preserve the [accepted design](simplified-design.md) and [implemented security profile](security.md):

- Generate the X25519 vault private key locally and keep it out of the server, Clerk, URLs, logs, model output and source control. Store it in the existing passphrase-encrypted, owner-only local vault.
- Encrypt provider values before upload, preferably through trusted local input. The optional hosted form encrypts in the browser, whose JavaScript can read new plaintext input. Never imply that this form remains safe under malicious website code.
- Keep names and project labels readable; use the established HPKE profile with account/vault/project/name/revision context. Do not invent cryptography or silently change existing ciphertext/vault formats.
- Clerk authenticates human sessions. Pin the public JWT verifier, issuer and application origin; require recent verification for sensitive operations. No test identity or bypass may enter production.
- Runtime service credentials are read-only bearer tokens. Persist hashes, enforce expiry/revocation/account/project/operation boundaries and redact usable credentials. Administrative upload credentials are separately scoped and short-lived.
- One immutable vault public key is bound to each account. No machine roster, delegation, recovery, reset or private-key transfer is implemented. A new Clerk instance or fresh local key does not recover existing ciphertext.
- Account and project authorization must be enforced on every applicable endpoint. Organizational projects do not replace account isolation or explicit credential scopes.
- The SDK returns plaintext to the authorized application. Equivalent OS permissions, a compromised client/update or an arbitrary-code agent may expose it. Do not claim model isolation from raw retrieval.
- Provider values, private keys, passwords, authorization headers and usable credentials must never appear in logs, telemetry, fixtures, committed environment files or package artifacts. Use synthetic values for testing.
- Fail closed on unavailable authorization or key checks. Do not weaken Protect rules, JWT checks or tests merely to obtain a successful signup/test; investigate the matched failure and document any deliberate change.
- Revocation stops future retrieval; it cannot erase copied credentials. A suspected provider-key exposure requires provider-side rotation.

## 5. Testing expectations

Select tests according to risk and behavior:

- **Unit:** policy intersections, validation, error behavior, version/state transitions, and canonical protocol inputs.
- **Cryptographic interoperability:** standard test vectors, serialization, recipient/context binding, tamper rejection, and supported-platform compatibility.
- **Integration:** API/database transactions, tenancy, token hashes, expiry/revocation, setup races and migrations.
- **End to end:** initialization, browser approval, project setup, local secret entry, SDK retrieval, read-only scopes, revocation, interruption and key loss.
- **Abuse cases:** wrong account/project/key, forged or stale JWTs, read credentials used for writes, expired/replayed setup claims, revoked credentials and altered ciphertext/context.
- **Packaging:** install and consume the published package artifact, its runtime exports and TypeScript declarations, and the documented supported runtimes/platforms.
- **Operations:** container health, deployment/migration ordering, encrypted backup/restore, redacted observability, and safe shutdown where affected.

Use real PostgreSQL in tests for transaction, constraint, and database authorization semantics; mocks alone do not establish those guarantees. Keep ordinary tests deterministic and independent of live provider credentials. Test macOS/Linux paths for components that claim support on both platforms.

Run formatting, linting, type checking, relevant suites, builds, and package checks through the repository scripts once those scripts exist. Before that, do not invent commands or report nonexistent checks as passing. CI must reproduce required checks before merge/release. Narrow local checks are useful during development; the full affected suite and required CI checks must pass before completion.

## 6. Documentation and public-source standards

After the code checks pass, update the documentation that the change affects:

- README and installation/quickstart instructions.
- Public API/SDK contracts, examples, error behavior, runtime/platform support, and migration notes.
- CLI help and configuration/environment-variable references.
- Threat model, protocol/architecture decisions, trust boundaries, and security limitations.
- Vercel/self-hosting instructions, migrations, backups, restore, and operational runbooks.
- Changelog entries for user-visible behavior and release changes.

Maintain the root `README.md`, `.github/SECURITY.md` reporting entry point and contribution/security/changelog documents in `docs/`. Before the first public software release, complete those guides, establish the release process and private vulnerability-reporting channel, and add the maintainer-selected root `LICENSE`. Do not assume the repository is licensed until a license has actually been chosen and added. Do not invent vulnerability-reporting contact details.

Keep maintained product/engineering/security documentation in `docs/`. Standard repository entry points such as `README.md` and `AGENTS.md` stay at the root. Put disposable scratch notes, generated previews, and superseded prototypes in the ignored `ignore-docs/` directory; do not exclude the only copy of a required specification or operational guide.

Public examples must be runnable against the documented interface, use synthetic placeholders, and avoid unsupported security claims. Explain why decisions exist where that helps future maintainers; avoid comments that merely restate the code.

Use semantic versioning for published packages. Treat breaking API/protocol/configuration changes explicitly, document migration paths, and test the package artifact rather than only importing workspace source. Document module format and supported Node.js versions. Keep public SDKs separated from internal server modules and secrets. Require manual local vault unlock; do not silently enable automatic unlock.

## 7. Deployment and supply chain

- The current target is Next.js on Vercel, Clerk and a separate Neon PostgreSQL database. In this standalone repository select `apps/web` as Vercel's Root Directory; follow [deployment.md](deployment.md).
- Keep runtime database privileges restricted, require TLS for remote connections and retain a separate migration owner. Never run destructive integration tests against deployed data.
- Keep deployment/admin secrets in the provider's secret facilities. Customer private decryption keys and provider plaintext must not be uploaded at all.
- Recreating Clerk changes user IDs; replacing infrastructure is not a vault/account migration. Never merge by email or silently reset keys/data.
- Untrusted contributor workflows must not receive production credentials or release publishing rights. Ordinary checks use synthetic credentials and a disposable database.
- Use the manual immutable release workflow with least privilege. Never replace assets of an existing SDK release. Keep install/upgrade integrity checks and local-vault preservation tests.
- Establish monitoring, spending/abuse controls and encrypted backup/restore drills before production approval. Passing a build or recreating an instance does not establish successful live signup.

## 8. Definition of done

A change is complete when its intended behavior and relevant failure cases are covered, the implementation preserves the architecture and security invariants, required checks pass, affected documentation reflects the tested behavior, and the final diff contains no unrelated changes or exposed credentials.

Record any unfinished prerequisite or known limitation explicitly. Professional work means producing verifiable outcomes, not describing unrun tests or assuming a secure implementation from a library name.
