# Troubleshooting

Keep your current encrypted vault file. Reinstallation, repeated signup or generating a fresh key does not repair configuration or recover data.

| Symptom | Action |
| --- | --- |
| `passman: command not found` on macOS/Linux | Rerun the maintained installer, then open a new Bash/Zsh/POSIX login terminal or run `. "$HOME/.local/share/passman/env"` once in the current terminal. For a custom installation directory use the exact activation command printed by the installer. Unsafe/symlinked profiles are preserved with a warning; see [installation](releases.md#install-sign-in-use) for manual configuration and opt-out. |
| `UNAVAILABLE` before the approval URL | Check `/api/health`. Operators verify database connectivity, migration version 2, audit INSERT/sequence privileges, origin and Clerk verifier configuration. A new deployment needs a deliberate migration. |
| Local vault will not unlock | Check the passphrase, directory and owner-only permissions. Do not delete the file. There is no passphrase reset that recovers its private key. |
| `put` fails with `EXPIRED` after asking for a secret | Client 0.3.1 reads the value before checking upload expiry. Run `passman login` with the same vault, approve it, then retry `put`. Client 0.3.2 starts browser reapproval before value input in an interactive terminal; noninteractive use still requires prior login. Approval can also expire if you wait too long before submitting a value. |
| New upload authorization is already expired | Check your machine's date/time and automatic clock synchronization, then retry login with the same vault. The CLI stops without reading a value or replacing the saved identity; repeated approval is not a clock fix. |
| `UNAUTHORIZED` during upload | The server rejected the upload credential, which may be expired or revoked. Run `passman login` with the same vault and retry deliberately; uploads are not automatically replayed. |
| `KEY_MISMATCH` | This account is already bound to another key. Use its original vault; a new key cannot replace it. |
| Approval expired or wrong code | Restart login with the same vault. Use the new code and compare the complete fingerprint. Never approve another person's request. |
| Fresh verification required | Complete Clerk's reverification prompt, or cancel without applying the mutation. |
| Clerk security block with a reference | Inspect the exact production instance's Application Logs/Protect decision. Do not disable protections or expose passwords to diagnose it. |
| `UNAUTHORIZED` during retrieval | Check the credential, expiry, revocation and account. A read token cannot upload; an upload token cannot read. |
| Missing entry / `NOT_FOUND` | Check the exact project/name and read-credential scope. Cross-account and forbidden-project lookups intentionally do not expose resource existence. |
| `CONFLICT` | Refresh state; a duplicate or concurrent revision changed the operation. Replace deliberately rather than silently retrying an overwrite. |
| Activity unavailable | Sign in again. Operators check migration 2, audit SELECT/INSERT grants and fixed `audit.persistence_failed` diagnostic events. |

Provide the request ID, safe error code, timestamp and client version in a report. Never attach tokens, values, passphrases, private keys or an unredacted environment file. Use [private security reporting](../.github/SECURITY.md) for suspected vulnerabilities.
