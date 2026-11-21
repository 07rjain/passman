# CLI, SDK and permissions

Prepared client 0.4.0 adds `import --project NAME --file PATH [--dry-run] [--skip-existing | --replace] [--allow-empty] [--yes]`. Administrative SDK exports include `parseEnv`, `readEnvFile`, `prepareEnvImport`, `EnvImportError`, `ImportCommitError` and preview/result types. Runtime `KeymanClient` stays read-only. See [complete import syntax and failure semantics](env-import.md); matching server endpoints are required and this version is not yet published.

The SDK/CLI version is tracked in [SDK_CHANGELOG.md](SDK_CHANGELOG.md). Internal `@keyman-mvp/*` source names and `~/.keyman-mvp` paths are retained for compatibility; the public product is Passman.

| Command | Purpose |
| --- | --- |
| `passman login` / `signin` | Unlock or create a local vault; complete bound browser approval |
| `passman put --project NAME --name KEY` | Encrypt locally and upload with short-lived upload authorization |
| `passman put --project NAME --name KEY --replace` | Replace deliberately with optimistic revision checks |
| `passman import --project NAME --file PATH --dry-run` | Validate and preview names without saving (prepared 0.4.0) |
| `passman import --project NAME --file PATH` | Confirm an atomic encrypted import (prepared 0.4.0) |
| `passman search --project NAME --query TEXT` | List permitted metadata |
| `passman check --project NAME --name KEY` | Check existence without printing its value |
| `passman --version` / `--help` | Display version or command help |

Optional configuration: `--url ORIGIN`, `--directory PATH`, `--no-browser`, `--passphrase-file PATH`, `--value-file PATH`. Existing vault origins/identities are not silently changed. Input files must be owner-only regular files; values are exact UTF-8 contents, not shell code. See [testing.md](testing.md) for limits and runnable interfaces.

| Actor/credential | Allowed behavior |
| --- | --- |
| Clerk human session | View workspace/activity; manage projects, encrypted entries and read credentials; mutations require recent verification |
| Read service credential | Retrieve ciphertext, search and existence checks within account/project scope; no writes or activity access |
| Local upload credential | Upload context and encrypted writes, for 20 minutes; no runtime reads or account administration |
| Local private key | Decrypt locally; never sent to the server |

`KeymanClient` exposes `getSecret`, `search` and `hasSecret`. It has no mutation method. The separately exported `uploadValue` helper is administrative and requires upload authorization. Error handling uses redacted `KeymanError.code`; do not log entire HTTP headers or SDK configuration. See [examples](../examples/retrieve.mjs).

Projects organize entries; they are not separate encryption-key domains. A fresh machine/key cannot access existing ciphertext merely by signing in. Multi-machine private-key transfer, recovery, `.env` import and environment injection are not implemented.

The activity API is documented in [audit.md](audit.md). Encryption and request contracts are described in [security.md](security.md).

Windows installation, NTFS ACL requirements and the `.cmd` launcher are documented in [windows.md](windows.md).
