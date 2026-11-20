# Fresh SDK/CLI changelog

## 1.0.0-alpha.1 — 2026-11-20

- First separate fresh SDK/CLI release: promptless local retrieval, saved scoped read credentials, account-specific custody, signed administrative writes, encrypted synchronization/restoration, code transfers and routine/compromise rotation.
- Self-contained GitHub archive exports `@passman/sdk`, `/admin`, `/transfers` and `/writer-replacement`; commands `passman` and `passman-v1`, with an explicit `--version`. Node.js 24 is required; fresh installers include a verified private runtime.
- Separate local custody and API/schema. Existing accounts/data are retained in the earlier workspace and are not automatically imported. Initialize a new fresh vault explicitly. Do not delete earlier keys while earlier values are still needed.
- Experimental alpha: native platform CI and hosted acceptance must pass before publication/deployment is marked verified. Provider rotation, production backup/restore and operational alerting remain operator responsibilities. See [the verification record](fresh-testing.md).
