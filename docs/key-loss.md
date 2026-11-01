# Key loss and exposure

**Losing every usable copy of your private key means Passman cannot recover the encrypted values.** Account login, email ownership, support, database backups and a newly generated key do not restore decryption. The MVP has no recovery/reset/private-key-transfer feature.

## Before loss

Protect the encrypted local vault file (`~/.keyman-mvp/vault.json`) and its passphrase. Any offline copy must stay private, access-controlled and separate from the passphrase. Copying a vault clones its decryption authority; it does not create an independently revocable machine identity. A formal supported backup/restore command and multi-machine transfer are not implemented.

A server database backup preserves ciphertext and metadata, not the missing client private key. Test operational restores separately from any protected local-vault backup exercise.

## After exposure

| What was exposed | Response |
| --- | --- |
| Read service token | Revoke it on the website and issue a replacement with minimum scope/expiry. Review activity for retrievals. |
| Upload token | Revoke the credential; it otherwise expires after 20 minutes. Inspect affected entries and revisions. |
| Unlocked vault/private key or whole client | Treat downloaded ciphertext and provider values as potentially compromised. Revoke service credentials and rotate affected credentials at each provider. |
| Provider value | Revoke/rotate at the provider. Passman revocation cannot invalidate a provider credential. |
| Server/database | Contain access, preserve available audit evidence, rotate infrastructure/service credentials, investigate hosted-input exposure and tampering. Server records alone cannot prove every action under full compromise. |

There is no existing-key replacement workflow for an account bound to a compromised private key. Do not describe a fresh account or key as recovery of old values. A deliberate replacement/migration design is still required. See [security.md](security.md) for server substitution/rollback and compromised-client boundaries.
