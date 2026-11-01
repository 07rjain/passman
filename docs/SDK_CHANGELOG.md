# Passman SDK and CLI changelog

The SDK and CLI share one semantic version. This changelog covers the installable client, not the server protocol version. Release entries describe user-visible behavior; unreleased changes belong under Unreleased.

## Unreleased

## 0.2.0 — 2026-11-01

- Add Windows x64/arm64 installation with a private Node.js runtime, HTTPS/checksum verification, version selection and a managed per-user command. Windows requires local NTFS storage and Windows PowerShell 5.1+; no administrator installation is needed.
- Protect Windows vaults/private input files with current-user SID/NTFS ACL validation instead of unsupported POSIX mode checks. Reject shared ACLs and reparse points; preserve manual unlock and existing encryption/vault formats.
- Open Windows browser approval without a command shell. Add Windows native CI and installed-client/installer acceptance; existing macOS/Linux behavior remains supported.

## 0.1.1 — 2026-11-01

- Move source/package metadata and release downloads to the public `07rjain/passman` repository. Fix installation returning 404 after the original release repository became private; preserve the earlier immutable release without republishing it.
- Explain failed downloads and verify that unavailable releases leave the working client and vault intact. No vault/API format change.

## 0.1.0 — 2026-10-31

- Add the `passman` command, `login`/`signin`, version/help output and the hosted-service default. Preserve the existing `keyman-mvp` command and local vault format/path.
- Package the CLI and typed ESM SDK together with locked runtime dependencies, installable without a source checkout or npm-registry publication.
- Add a macOS/Linux arm64/x64 installer with a private Node.js 24 runtime, checksum verification, version selection and atomic activation. Re-running the installer updates the client without modifying the vault.
- Include the PolyForm Noncommercial 1.0.0 license and third-party license notices. This remains an experimental client; no recovery or compromised-host isolation is added.
