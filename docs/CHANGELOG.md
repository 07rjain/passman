# Passman changelog

## Unreleased

- Create the standalone Vercel project from this repository, attach `passman.subdomain.wtf` and update its website CNAME while preserving unrelated DNS. Record the setup-screen/installer responses and the expected unavailable API while Clerk/database resource selection is pending.

- Extract the simplified MVP into the standalone `07rjain/passman` repository, preserving SDK/vault/API/database formats and the current dependency baseline.
- Include repository-local license, engineering/contribution/security documentation, documentation checks and Linux/macOS/PostgreSQL CI without relying on the former parent repository.
- Preserve explicit npm `prebuild` hooks in the standalone configuration so the default Vercel app build compiles core and generates the installer. Verify a clean external checkout, package/installer checks and the real disposable-PostgreSQL workflow.
- Update Vercel instructions to Root Directory `apps/web` and separate the fresh deployment checklist from historical hosted/Clerk evidence.
- Point package source metadata and future release publishing at the new repository. Preserve existing immutable 0.1.0 downloads at the original release location until a new client release is published.

Client releases and compatibility notes are maintained in [SDK_CHANGELOG.md](SDK_CHANGELOG.md). The prior multi-machine application and its changelog remain in [07rjain/keyman](https://github.com/07rjain/keyman).
