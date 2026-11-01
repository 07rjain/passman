# Troubleshooting

Keep your current encrypted vault file. Reinstallation, repeated signup or generating a fresh key does not repair configuration or recover data.

| Symptom | Action |
| --- | --- |
| `UNAVAILABLE` before the approval URL | Check `/api/health`. Operators verify database connectivity, migration version 2, audit INSERT/sequence privileges, origin and Clerk verifier configuration. A new deployment needs a deliberate migration. |
| Local vault will not unlock | Check the passphrase, directory and owner-only permissions. Do not delete the file. There is no passphrase reset that recovers its private key. |
| `KEY_MISMATCH` | This account is already bound to another key. Use its original vault; a new key cannot replace it. |
| Approval expired or wrong code | Restart login with the same vault. Use the new code and compare the complete fingerprint. Never approve another person's request. |
| Fresh verification required | Complete Clerk's reverification prompt, or cancel without applying the mutation. |
| Clerk security block with a reference | Inspect the exact production instance's Application Logs/Protect decision. Do not disable protections or expose passwords to diagnose it. |
| `UNAUTHORIZED` during retrieval | Check the credential, expiry, revocation and account. A read token cannot upload; an upload token cannot read. |
| Missing entry / `NOT_FOUND` | Check the exact project/name and read-credential scope. Cross-account and forbidden-project lookups intentionally do not expose resource existence. |
| `CONFLICT` | Refresh state; a duplicate or concurrent revision changed the operation. Replace deliberately rather than silently retrying an overwrite. |
| Activity unavailable | Sign in again. Operators check migration 2, audit SELECT/INSERT grants and fixed `audit.persistence_failed` diagnostic events. |

Provide the request ID, safe error code, timestamp and client version in a report. Never attach tokens, values, passphrases, private keys or an unredacted environment file. Use [private security reporting](../.github/SECURITY.md) for suspected vulnerabilities.
