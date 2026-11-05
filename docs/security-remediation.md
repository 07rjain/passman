# Security remediation — 2026-11-05

The security report examined `e5a942efe4f8c10529b07797fea372f4b05de039`. These changes preserve account identities, private keys, ciphertext, wire formats and schema versions. They do not reset or recover user vaults.

| Report finding | Source remedy | Regression evidence |
| --- | --- | --- |
| Invalid bearer counters roll back | Commit attempts before checking credentials; aggregate dead-token denial events | TOKEN-09, AUD-12 |
| Broad runtime database writes | Explicit table/column grants; immutable account/project bindings; owner-only migration state | OPS-12 |
| Shared enrollment starvation | Trusted-client admission before the deployment-wide ceiling | SETUP-10 |
| Repository writer bypasses release approval | Pinned RSA-SHA256 archive publisher; protected signing environment and source review | DIST-10 |
| Arbitrary poll counter allocation | Shared/client counters first; allocate individual counters only for live devices | SETUP-09 |
| Windows ACL/open race | Validate ACL and read through the same non-write/delete-shared handle; reject replaceable ancestors | WIN-07 |
| POSIX directory retargeting | Reject user aliases and writable/untrusted ancestors; use canonical validated vault paths | VAULT-05 |

The database finding's migration-state claim was broader than the actual deployment instructions: migrations already had SELECT-only runtime access. Account UPDATE/DELETE permissions were unnecessarily broad and are removed.

## Verification and rollout

Local Linux verification passed unit, type/lint/build and HTTPS distribution checks, including forged checksum/signature rejection and preserving existing installation/vault bytes. Real disposable PostgreSQL 16 integration passed with restricted column grants, ordinary CLI/SDK operations, durable bearer denial counters, bounded polling and per-client setup isolation. Windows and macOS CI must pass for the final commit; local Linux tests do not certify native Windows handles/ACLs.

Deployment order:

1. Review and merge the security change. Existing migration 2/audit prerequisites still apply. No new schema version is introduced.
2. Deploy the new API with the existing role. Vercel system variables must be enabled; client admission uses the platform-overwritten address header. Other HTTPS deployments require a trusted adapter and fail closed without one.
3. With the separate migration owner, set `MVP_RUNTIME_ROLE` and run `npm run db:grants`. Verify that the runtime cannot UPDATE/DELETE account bindings or modify migration/audit controls, and that a synthetic setup/upload/read/revocation workflow passes. Old API builds require account-row UPDATE locks and are incompatible with the tightened grants; roll forward to the matching API rather than weakening permissions.
4. Protect the `passman-release` environment with an owner reviewer and main-only deployment policy; store `PASSMAN_RELEASE_PRIVATE_KEY` only there. Protect `main` with owner code review and required CI. Repository administrators and the owner remain trusted. A release writer can still cause download failures, but cannot produce a valid publisher signature without the signing authority.
5. Publish a new immutable signed client release, then deploy the matching bootstrap installers. Existing unsigned assets are deliberately preserved; the new installer rejects them. Do not deploy the signed-only installer while the default release remains unsigned. No downgrade to checksum-only verification is provided.

The initial publisher key is pinned in `distribution/release-public.pem` and both installers. Rotation requires an owner-reviewed bootstrap/trust-anchor update and a new signed release. A downloaded bootstrap is still trusted code; verify its origin or retain a reviewed copy. Signing does not isolate customer keys from an owner-approved malicious client update.

Production rollout, final native CI, signed public-release acceptance and externally configured GitHub protection evidence must be recorded separately. Passing source tests alone does not close those operational steps.

## GitHub protections verified — 2026-11-05

The `passman-release` environment was configured with required reviewer `07rjain` and a deployment-branch policy limited to `main`. Its environment-only signing secret was installed without exposing key bytes in source/logs. Main now requires a pull request, one approving code-owner review, fresh approval after the last push, and successful Linux/macOS/Windows/integration jobs, with stale reviews dismissed and force-push/deletion disabled. Owner/admin bypass remains deliberately available to the trusted sole maintainer. CODEOWNERS becomes effective when this change is merged. Environment approval permits the owner to approve their own release because no second maintainer exists; ordinary repository writers cannot approve it.

Only `07rjain` held repository write/admin access when inspected. These settings protect future writer separation; they do not claim an independent two-person approval process or protection from a compromised owner/admin account.
