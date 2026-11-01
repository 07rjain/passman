# MVP working instructions

Read the repository-wide engineering standards in [docs/agent.md](docs/agent.md), then this MVP's [PRD](docs/PRD.md), [plan](docs/plan.md), and [accepted design decisions](docs/simplified-design.md).

- This is the standalone Passman repository. Work from its root; keep maintained documents in `docs/` and disposable artifacts in ignored `ignore-docs/`.
- The MVP specification is the target for this folder. Older multi-machine, dual-signature and root-recovery requirements describe the earlier application and must not be imported as MVP requirements automatically.
- The earlier application remains in the separate `07rjain/keyman` repository. Preserve existing vault/database formats and data; this repository extraction does not authorize any account migration/reset.
- Follow the shared standards for minimal architectural impact, strict input validation, established cryptographic libraries, meaningful tests, passing checks, documentation and credential hygiene.
- Keep provider values and usable private decryption keys off the server. Clearly distinguish recommended local input from the optional hosted input trust boundary.
- Runtime service credentials are read-only bearer tokens in the accepted target design; persist hashes and redact live tokens. Do not add a bearer fallback to the earlier API.
- No recovery or private-key transfer is included in the MVP. Do not imply raw SDK retrieval hides a value from arbitrary code or equivalent OS permissions.
- This folder now contains an experimental implementation. Use its own `npm run check` and isolated database integration command; checks from the former parent application do not verify it. Maintain the testing/deployment/security guides and distinguish fixture verification from live Clerk/Vercel acceptance or an independent audit.

## Feature regression requirements

- Use [docs/feature.md](docs/feature.md) before implementing a feature. Add/update its stable case IDs and meaningful tests, run the full applicable MVP regression suite, and record actual results and gaps. Extend the catalogue when adding capabilities; do not borrow coverage claims from the older application.
- Production Clerk cutover requires matched live frontend/issuer/verifier configuration and an explicit decision for existing vault/account bindings. Never silently merge by email or reset local keys/data.

## Client releases

- SDK and CLI share the version in `packages/client/package.json`. Record user-visible changes in `docs/SDK_CHANGELOG.md` under Unreleased as part of every relevant change.
- Prepare versions with `npm run release:version -- patch|minor|major`, then review the manifest/lockfile/changelog diff. For 0.x, breaking public behavior requires a minor bump; after 1.0 use a major bump. Never replace assets of an existing release.
- Before publication run `npm run check`, `npm run test:distribution`, and relevant database integration tests. Use `docs/releases.md` for the manual release procedure. Keep package versions distinct from vault/wire versions and preserve existing user identities on update.

## Audit and documentation requirements

- Follow the audit and documentation/changelog sections of [docs/agent.md](docs/agent.md) for every feature. Read [docs/audit.md](docs/audit.md) when changing operations or their instrumentation and maintain [the documentation index](docs/README.md).
- Preserve atomic mutation auditing, durable denials, redaction, tenant isolation and limited runtime privileges. Report local verification separately from production migration, webhook, retention and alert configuration.
- Website/API changes update [docs/CHANGELOG.md](docs/CHANGELOG.md); SDK/CLI changes update [docs/SDK_CHANGELOG.md](docs/SDK_CHANGELOG.md). Check deployment prerequisites before pushing to an automatically deployed branch.
