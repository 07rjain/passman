# Fresh SDK/CLI changelog

## 1.0.0-alpha.1 — 2026-11-20

Prepared 2026-11-20; [published as a signed prerelease](https://github.com/07rjain/passman/releases/tag/passman-v1.0.0-alpha.1) on 2026-11-21 from `a94215b36469717b2bf83b56c15caf60b3f627e8`. Linux/macOS/Windows release acceptance passed. The fresh API and updated landing page are live; public signature/checksum, hosted installers and an isolated installed Linux SDK were verified. [Rollout evidence](fresh-testing.md#signed-alpha-publication-and-hosted-rollout--2026-11-21).

- First separate fresh SDK/CLI release: promptless local retrieval, saved scoped read credentials, account-specific custody, signed administrative writes, encrypted synchronization/restoration, code transfers and routine/compromise rotation.
- Self-contained GitHub archive exports `@passman/sdk`, `/admin`, `/transfers` and `/writer-replacement`; commands `passman` and `passman-v1`, with an explicit `--version`. Node.js 24 is required; fresh installers include a verified private runtime.
- Separate local custody and API/schema. Existing accounts/data are retained in the earlier workspace and are not automatically imported. Initialize a new fresh vault explicitly. Do not delete earlier keys while earlier values are still needed.
- Experimental alpha: native platform CI and hosted acceptance must pass before publication/deployment is marked verified. Provider rotation, production backup/restore and operational alerting remain operator responsibilities. See [the verification record](fresh-testing.md).

The macOS native CI fixture uses an explicitly unlocked temporary keychain and restores its previous keychain settings afterward. A successful build or package check alone is not native Keychain acceptance.

- Correct macOS file-keychain queries that returned `errSecParam` (-50) even with unlocked storage. Runtime interaction stays disabled; native CI also checks that locking the isolated keychain rejects reads/writes without a prompt.

- Correct Windows package-fixture command quoting and exercise installation in a directory containing spaces. The fixture continues to execute the installed npm CLI shim before native acceptance.

- Cast Security `CFStringRef` query constants to their toll-free Objective-C objects before constructing macOS Keychain dictionaries; raw references produced `errSecParam` for otherwise valid queries.

- Compare Windows custody owner/access identities by canonical SID values and add synthetic-only native-helper diagnostics to the Windows acceptance runner.

- Use .NET ACL APIs in Windows custody so PowerShell 7's inherited module search path cannot break the Windows PowerShell helper's ACL checks. DPAPI encryption and owner/access validation remain required.

- Pass a genuine null backup path to .NET's atomic Windows file replacement; PowerShell's ordinary `$null` becomes an invalid empty path. Native acceptance explicitly replaces and reloads a saved credential.

- Point the fresh landing/support/agent guides to the matching alpha setup and release, use the installer's `passman` command, and include origin/account configuration in onboarding.
