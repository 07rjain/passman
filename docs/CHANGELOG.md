# Passman product and server changelog

This file records website/API/security and operational changes. Installable client versions belong in [SDK_CHANGELOG.md](SDK_CHANGELOG.md). Unreleased means implemented in source, not necessarily deployed. Server rollout records must include the deployed commit or deployment ID; never invent a client version for a server-only change.

## Unreleased

### Added

- Add a portable Passman agent skill for existing CLI/SDK workflows, with private-configuration guidance and skills.sh installation/discovery instructions. Track the local MCP adapter as future work; no client/API/vault behavior changes.

- Require future contributors/agents to preserve audit guarantees, maintain task-oriented documentation and changelogs, and verify migration prerequisites before automatically deployed pushes.

- Metadata-only audit history for setup, projects, credentials, secret operations and denials; no secret payloads or usable tokens are recorded.
- Account-scoped activity filters and pagination, signed/deduplicated Clerk session webhook ingestion, maintenance retention and explicit operator event reporting.
- Task-oriented documentation index, quickstart, reference, troubleshooting, key-loss and operational guides.

### Compatibility and upgrade

- Run additive database migration 2 and grant the existing runtime role audit SELECT/INSERT and identity-sequence USAGE before deploying. Health now requires version 2. Configure session webhooks and schedule retention separately; see [audit.md](audit.md).
- Existing client 0.1.1, vault/ciphertext formats and account identities are unchanged. No SDK release is required.

### Known limitations

- Audit records are not independent of a compromised server/DB administrator. External immutable export and automated alerts are not yet implemented.
- Local decryption/provider use are unobservable; failed Clerk sign-ins remain in Clerk Application Logs. Anonymous application events are bounded representatives, not complete traffic counts.

## 2026-11-01 — hosted configuration and acceptance

- Published immutable client 0.1.1 from `bbde134d4a2459e62fab24cf4d9442727b6e66a8`, fixing download availability after the former release repository became private. See the SDK changelog for client details.
- Configured the preserved database with a separate restricted runtime role; recorded setup under `e4eee87f92d40d6c768e66cb2913234a96a6f47c`.
- Documented two-account real browser/VM acceptance and scoped production Clerk keys to Production only in `185d5713ef7ef527c9be925dd9c74ebf21fc3ef6`. See the [manual report](manual-security-test-2026-11-01.md) for results, known boundaries and cleanup.

## 2026-10-31 — standalone repository transition

- Extracted the simplified MVP into `07rjain/passman`, retaining existing client/vault/API/database formats and dependency baseline.
- Added standalone contributor/security/license documentation, reproducible CI and Vercel Root Directory `apps/web` configuration.
- Preserved npm prebuild hooks so clean web builds compile core and generate the installer.

The prior multi-machine application and its history remain in [07rjain/keyman](https://github.com/07rjain/keyman). Older deployment reports are historical evidence, not current configuration instructions.
