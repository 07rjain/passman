# Security remediation — 2026-11-05

The security report examined `e5a942efe4f8c10529b07797fea372f4b05de039`. These changes preserve account identities, private keys, ciphertext, wire formats and schema versions. They do not reset or recover user vaults.

| Report finding | Source remedy | Regression evidence |
| --- | --- | --- |
| Invalid bearer counters roll back | Commit attempts before checking credentials; aggregate dead-token denial events | TOKEN-09, AUD-12 |
| Broad runtime database writes | Explicit table/column grants; immutable account/project bindings; owner-only migration state | OPS-12 |
| Shared enrollment starvation | Trusted-client admission before the deployment-wide ceiling | SETUP-10 |
| Repository writer bypasses release approval | Pinned RSA-SHA256 archive publisher; protected signing environment and source review | DIST-12 |
| Arbitrary poll counter allocation | Shared/client counters first; allocate individual counters only for live devices | SETUP-09 |
| Windows ACL/open race | Validate ACL and read through the same non-write/delete-shared handle; reject replaceable ancestors | WIN-08 |
| POSIX directory retargeting | Reject user aliases and writable/untrusted ancestors; use canonical validated vault paths | VAULT-05 |

The database finding's migration-state claim was broader than the actual deployment instructions: migrations already had SELECT-only runtime access. Account UPDATE/DELETE permissions were unnecessarily broad and are removed.

## Verification and rollout

Local Linux verification passed unit, type/lint/build and HTTPS distribution checks, including forged checksum/signature rejection and fail-closed production release gating and preserving existing installation/vault bytes. Real disposable PostgreSQL 16 integration passed with restricted column grants, ordinary CLI/SDK operations, durable bearer denial counters, bounded polling and per-client setup isolation. Windows and macOS CI must pass for the final commit; local Linux tests do not certify native Windows handles/ACLs.

Deployment order:

1. Review and merge the security change after native CI passes. Existing migration 2/audit prerequisites still apply. No new schema version is introduced. Automatic production builds fail closed until the public default client is at least the source version, has a valid publisher signature and its archive matches that signature. Vercel keeps the previous healthy deployment live while this guard blocks promotion.
2. Publish the new immutable signed client from the protected main-branch release workflow with owner approval. Existing unsigned assets remain unchanged. This publication is the prerequisite for serving the new bootstrap installers; no checksum-only fallback is provided. Local/CI/preview builds use fixtures and do not need a public release.
3. Trigger the production rebuild. The build independently checks the public default version, signed manifest and archive before it copies the new installers. Deploy the matching API with the existing database role. Enable Vercel system variables; other HTTPS deployments need a trusted adapter and fail closed without one.
4. With the separate migration owner, set `MVP_RUNTIME_ROLE` and run `npm run db:grants`. Verify the forbidden SQL and a synthetic setup/upload/read/revocation workflow. Older API builds require account-row UPDATE locks and must not remain active after tightening grants; roll forward to the matching API rather than weakening permissions.
5. Repeat real public installation on Linux/Windows and a synthetic production round trip. Keep the protected main-only signing environment, CODEOWNERS review and required CI in place. Repository administrators and the owner remain trusted. A release writer can cause download failures but cannot generate a valid publisher signature without the signing authority.

The initial publisher key is pinned in `distribution/release-public.pem` and both installers. Rotation requires an owner-reviewed bootstrap/trust-anchor update and a new signed release. A downloaded bootstrap is still trusted code; verify its origin or retain a reviewed copy. Signing does not isolate customer keys from an owner-approved malicious client update.

Production rollout, final native CI, signed public-release acceptance and externally configured GitHub protection evidence must be recorded separately. Passing source tests alone does not close those operational steps.

## GitHub protections verified — 2026-11-05

The `passman-release` environment was configured with required reviewer `07rjain` and a deployment-branch policy limited to `main`. Its environment-only signing secret was installed without exposing key bytes in source/logs. Main now requires a pull request, one approving code-owner review, fresh approval after the last push, and successful Linux/macOS/Windows/integration jobs, with stale reviews dismissed and force-push/deletion disabled. Owner/admin bypass remains deliberately available to the trusted sole maintainer. CODEOWNERS becomes effective when this change is merged. Environment approval permits the owner to approve their own release because no second maintainer exists; ordinary repository writers cannot approve it.

Only `07rjain` held repository write/admin access when inspected. These settings protect future writer separation; they do not claim an independent two-person approval process or protection from a compromised owner/admin account.

## Native CI evidence

[GitHub CI](https://github.com/07rjain/passman/actions/runs/41955334230) passed Linux, macOS, Windows and disposable PostgreSQL integration for `7394f93f647fb4ffd63c4ef24340a1725a84c7d0`, including the native Windows handle/ancestor regressions and installed-client signature fixture. The subsequent production-release gate passed its local distribution regressions and rejected the actual older public release; its combined final CI remains a separate required check before merge. Documentation validation also rejects duplicate stable regression IDs.
