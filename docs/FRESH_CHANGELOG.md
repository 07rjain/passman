# Fresh SDK/CLI changelog

## 1.0.0-alpha.1 — 2026-11-20

- First separate fresh SDK/CLI release: promptless local retrieval, saved scoped read credentials, account-specific custody, signed administrative writes, encrypted synchronization/restoration, code transfers and routine/compromise rotation.
- Self-contained GitHub archive exports `@passman/sdk`, `/admin`, `/transfers` and `/writer-replacement`; commands `passman` and `passman-v1`, with an explicit `--version`. Node.js 24 is required; fresh installers include a verified private runtime.
- Separate local custody and API/schema. Existing accounts/data are retained in the earlier workspace and are not automatically imported. Initialize a new fresh vault explicitly. Do not delete earlier keys while earlier values are still needed.
- Experimental alpha: native platform CI and hosted acceptance must pass before publication/deployment is marked verified. Provider rotation, production backup/restore and operational alerting remain operator responsibilities. See [the verification record](fresh-testing.md).

The macOS native CI fixture uses an explicitly unlocked temporary keychain and restores its previous keychain settings afterward. A successful build or package check alone is not native Keychain acceptance.

- Correct macOS file-keychain queries that returned `errSecParam` (-50) even with unlocked storage. Runtime interaction stays disabled; native CI also checks that locking the isolated keychain rejects reads/writes without a prompt.

- Correct Windows package-fixture command quoting and exercise installation in a directory containing spaces. The fixture continues to execute the installed npm CLI shim before native acceptance.
