# Contributing to Passman

Read [agent.md](agent.md), [PRD.md](PRD.md), [plan.md](plan.md) and [feature.md](feature.md) first. Define the behavior and acceptance criteria, trace existing boundaries, and choose a focused change. Preserve vault/account/ciphertext formats and avoid unrelated refactoring.

Use Node.js 24/npm 11 and the committed lockfile:

```sh
npm ci
npm run check
npm run test:distribution
```

`check` runs formatting, builds, types, lint, unit tests, installed-package consumption and documentation checks. `npm run format` applies formatting. Test database changes and authorization behavior with the real PostgreSQL workflow in [testing.md](testing.md); the integration database must be disposable and named `keyman_mvp_test`.

Add meaningful regression tests for behavior changes. Investigate failures; never weaken assertions, bypass authorization or reduce security checks merely to obtain a passing result. Once checks pass, update the affected guides, examples, feature cases and changelog. Report real results and explicit gaps, distinguishing fixture tests from real Clerk email/browser acceptance.

Keep required documentation in `docs/`, local experiments in ignored `ignore-docs/`, and credentials out of source, logs, examples and package artifacts. CI for untrusted code must not receive deployment or release credentials. Use synthetic secrets in tests.

Describe each contribution's concrete problem, final behavior, validation and compatibility/security implications. SDK/CLI changes require notes in [SDK_CHANGELOG.md](SDK_CHANGELOG.md); other changes use [CHANGELOG.md](CHANGELOG.md). Follow [releases.md](releases.md) for intentional immutable publication. A normal push is not a request to publish a package or deploy infrastructure.

Report vulnerabilities through the private route in [security.md](security.md#reporting-vulnerabilities), not public issues. Contributions use the root [PolyForm Noncommercial license](../LICENSE); commercial terms remain a maintainer decision.
