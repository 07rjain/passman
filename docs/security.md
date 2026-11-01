# MVP security contract and limits

Status: experimental implementation, not an independent audit or production certification. This profile applies to the standalone Passman repository; it does not downgrade the older API or migrate its users. Use synthetic values until the live/platform and security-review gates are complete.

## Data and key ownership

One Clerk account has one immutable vault public key. Local setup generates an X25519 encryption key pair; the private JWK stays in the user's encrypted local file. The service stores its public JWK and SHA-256 fingerprint, never the usable private key or local passphrase. Re-login with the same key can renew administrative upload authorization; a different key cannot replace it. No multi-machine transfer, recovery kit, account-only reset or destructive empty-vault reset is implemented.

Projects and names are readable metadata. Optional service-credential project filters restrict API retrieval; they do not create separate cryptographic vaults. A stolen private vault key plus matching captured ciphertext enables offline decryption of that vault's records. A read token alone supplies ciphertext/metadata, not the missing private key. An authorized receiving application can copy plaintext.

## Value wire profile

The shared browser/Node module uses pinned `@hpke/core` with [RFC 9180 HPKE](https://www.rfc-editor.org/rfc/rfc9180.html), X25519/HKDF-SHA256/AES-256-GCM in base mode. Every seal generates an independent encapsulation; no user-managed per-project encryption key is introduced. Values are at most 65,536 UTF-8 bytes, including empty values through the local API.

An envelope has exactly `version: 1`, the suite label `HPKE-X25519-HKDF-SHA256-AES256GCM`, `keyId`, `enc`, and `ciphertext`. Bytes use canonical unpadded base64url. The encapsulation is 32 bytes; ciphertext includes the AEAD tag. The key fingerprint is SHA-256 of the UTF-8 compact JSON array `["keyman-mvp-vault-key",1,kty,crv,x]`, encoded base64url.

The HPKE `info` and AEAD additional data are the same fixed-order UTF-8 JSON array:

```text
["keyman-mvp-value",1,accountId,vaultId,projectId,projectName,secretName,revision]
```

The API supplies readable context alongside the envelope. Before decrypting, the SDK checks its locally pinned account/vault/key, requested project name and secret name. The AEAD authenticates the entire context, so wrong-account/project/name/revision swaps and ciphertext corruption fail. Public recipient keys are exportable because HPKE serializes them; imported private keys used for decryption are non-extractable Web Crypto keys. The encrypted on-disk JWK and the application's plaintext remain subject to local-host compromise.

**HPKE base mode is not writer authentication.** Anyone possessing the public key can construct a new valid ciphertext of their own chosen value. TLS and the honest server's authenticated write controls establish ordinary write authority. The MVP does not prove sender identity or latest-version freshness against an actively malicious server. Optimistic revisions prevent honest-server concurrent overwrite; they are not an independently witnessed anti-rollback log. Project renaming/rekeying would need deliberate context/version handling and is not implemented.

## Local identity file

The default directory is `~/.keyman-mvp` (owner-only `700`); `vault.json` is owner-only `600`. Reads reject symlinks at the file, wrong ownership, permissive modes and oversized files. New initialization refuses to overwrite an existing vault. Saves use a fresh salt/nonce and an atomic rename from an owner-only temporary file.

The file uses AES-256-GCM with a random 16-byte salt, 12-byte nonce, 16-byte authentication tag and additional data `keyman-mvp-local-vault-v1`. Its 32-byte key is derived with scrypt (`N=131072`, `r=8`, `p=1`, 256 MiB maximum memory); passphrases are at least 12 characters and at most 1,024 UTF-8 bytes. Public-key material, the private key, account binding and any temporary upload credential are encrypted together. Normal SDK unlock omits the upload credential; the administrative CLI explicitly requests it.

This protects a locked file with a strong passphrase, not an unlocked application or malware with equivalent OS permissions. Protected passphrase-file automation is not stronger than the permissions/storage of that passphrase file. No hardware-backed storage, broker isolation or memory-erasure guarantee is claimed. Node.js/macOS/Linux are the initial supported client targets; Windows custody is not validated.

## Authentication and approval

The application owns an expiring CLI/browser approval workflow; this is not a claim that Clerk implements an OAuth device grant. The start request contains only the public key. The service creates a random 256-bit claim secret and 48-bit human approval code, persists only their SHA-256 hashes and expires the transaction after ten minutes. The browser URL contains only a public random request ID, not either secret. The user compares the complete fingerprint and enters the code from the initiating terminal.

Clerk session JWTs authenticate human approval and account management. Verification pins the RSA public verifier, HTTPS issuer, authorized origin, nonempty session identity, signature and expiry. Administrative mutations require recent first-factor verification; the UI handles Clerk's reverification hint. Approval is atomic with immutable account-key registration. The initiating CLI claims it once using its high-entropy secret; a successful claim issues a 20-minute `kmu_` upload-only bearer credential. A lost completion response can be handled by re-running login with the same persisted key, not by generating a replacement key.

This is not per-request machine-signature authentication. The simpler design deliberately relies on bearer authorization for ciphertext APIs and possession of the private encryption key for decryption. Keep local/provider input outside hosted JavaScript when that trust boundary matters.

## Service credentials and API controls

Read credentials are `kmr_` plus 32 random bytes encoded base64url; upload credentials use `kmu_`. Both are received by the running API over HTTPS. Only SHA-256 hashes and public credential metadata persist in PostgreSQL. Read credentials last 1–90 days and may cover one project or all account projects. Upload credentials do not create projects, delete records or issue other credentials. Read credentials cannot invoke administrative upload/management routes. Revocation/expiry is checked from database state on each authentication; requests already authorized/in progress and previously copied values are not erased.

All database lookups bind the authenticated account; composite foreign keys reinforce account/project relationships. Uploads require the registered key ID and current expected revision, with account-row locking and an atomic increment/write. API errors are redacted static codes/messages. Body/response sizes are bounded, authenticated responses are `private, no-store`, client redirects are disabled and network calls time out. The Next adapter validates Host and canonicalizes only to configured `APP_ORIGIN`; forwarding headers do not select the trusted origin.

The API uses PostgreSQL rate counters rather than process-local state. They are a baseline, not a complete edge abuse strategy. Public setup buckets can be saturated, and invalid credential/connection attacks still require platform/IP controls and spending limits. Database state is authoritative across function instances; pooled connections are only an optimization.

## Browser and agent boundaries

The optional website input form encrypts before its normal upload using the public key. Its JavaScript can see the new plaintext. A compromised page can capture input or substitute a public key, as described in [W3C Web Crypto security considerations](https://www.w3.org/TR/webcrypto/#security-considerations). No private-key import or existing-value reveal is offered in the website. Local uploads pin the public key/account from the encrypted local profile before encryption.

The SDK's `getSecret` returns plaintext to the local application. A trusted task handler can use it and return only task output to a model. It must not return credentials, authentication headers, sensitive provider errors or raw stack traces. An arbitrary-code agent with equivalent vault/passphrase/file access can still obtain the value; a normal callback or this SDK does not isolate it. Provider/task adapters and stronger executor isolation remain separate work.

Loss of all usable private-key copies makes the corresponding data unrecoverable through Keyman. Clerk login, administrators, database backups and newly generated keys cannot decrypt it. Provider-side revocation/replacement is required after suspected key exposure. The old application and its keys remain separate; no automatic migration/import is implemented.

## Reporting vulnerabilities

Use [GitHub private vulnerability reporting](https://github.com/07rjain/passman/security/advisories/new). Include the affected revision, impact and a minimal synthetic reproduction. Do not publish sensitive details, credentials or private keys in public issues or pull requests. No response SLA or production support commitment is currently promised. If private reporting is unavailable, request an alternative private route without disclosing the details publicly.

## Windows key custody

Windows uses current-user SID/NTFS ACL validation rather than POSIX mode bits. Private files and directories reject shared Allow entries, non-owner SIDs and reparse points. New vault directories are made owner-only before writing private data. Local NTFS storage and Windows PowerShell are required; see [windows.md](windows.md). No cryptographic format, account recovery or OS-administrator isolation is added.
