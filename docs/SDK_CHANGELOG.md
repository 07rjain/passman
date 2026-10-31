# Passman SDK and CLI changelog

The SDK and CLI share one semantic version. This changelog covers the installable client, not the server protocol version. Release entries describe user-visible behavior; unreleased changes belong under Unreleased.

## Unreleased

- Move source/package metadata and future release tooling to `07rjain/passman`. Keep immutable 0.1.0 downloads at the original release location until the next release; no vault/API format change or new publication is included.

## 0.1.0 — 2026-10-31

- Add the `passman` command, `login`/`signin`, version/help output and the hosted-service default. Preserve the existing `keyman-mvp` command and local vault format/path.
- Package the CLI and typed ESM SDK together with locked runtime dependencies, installable without a source checkout or npm-registry publication.
- Add a macOS/Linux arm64/x64 installer with a private Node.js 24 runtime, checksum verification, version selection and atomic activation. Re-running the installer updates the client without modifying the vault.
- Include the PolyForm Noncommercial 1.0.0 license and third-party license notices. This remains an experimental client; no recovery or compromised-host isolation is added.
