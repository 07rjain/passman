# Passman agent skill

The portable [Passman skill](../skills/passman/SKILL.md) teaches a shell/code-capable agent to use the existing CLI/SDK. It adds no runtime server, credential store or decryption mechanism. Skill metadata version 0.1.1 is separate from client 0.2.0; neither vault nor API format changes.

## Install

Review the skill and its license first. With Node.js/npm, install using the skills CLI:

```sh
npx skills add 07rjain/passman --skill passman
```

Choose your agent and destination when prompted. Restart/reload skill discovery if your client requires it. This installs instructions, not the Passman CLI/SDK. Then follow [quickstart.md](quickstart.md) for CLI installation/login and privately provision a scoped read credential. Each process still needs local unlock; login does not create a shared unlocked session.

Example request: “Use Passman to check whether production/OPENAI_API_KEY exists and update my application to use it without printing the value.” Codex users can explicitly invoke `$passman`. Other clients use their own skill discovery mechanism.

## Registry discovery

The intended directory is [skills.sh](https://skills.sh/docs/faq). Its documented discovery process uses public GitHub skills and real `skills add` installation telemetry, not a separate registration/upload form. Publishing the repository skill and verifying a real isolated installation is the submission path. Directory appearance and search indexing may be delayed; do not claim a listing is live until observed. GitHub's `agent-skills` repository topic also aids discovery.

Review third-party installation tooling and pin a reviewed CLI version for automated checks. Installing this skill should not receive real vaults, passphrases, service keys or provider values. Respect the repository's PolyForm Noncommercial license; registry discovery does not change commercial permissions or imply a security audit.

## Safety and maintenance

Keep the skill self-contained: installation copies its directory, not this entire repository. References needed by the agent live within the skill folder; maintained product guides remain in `docs/`. Update skill metadata version, relevant guides and the product changelog when instructions change. Run the skill-creator validator, `gh skill publish --dry-run`, documentation/format checks and an isolated skills CLI installation; review installed content before using it with credentials. Do not add tests that merely match instruction wording.

The skill avoids plaintext tool results, but cannot isolate an agent with arbitrary code execution and equivalent OS permissions. It cannot revoke copied values or recover a lost private key. See [security.md](security.md) and [key-loss.md](key-loss.md).

## Future MCP integration

MCP is deferred, not implemented. The planned local TypeScript/stdin-stdout server wraps the same SDK and supports search, existence checks, status and optional raw retrieval/decryption after existing login. Service keys stay in private configuration; private keys stay local. A separate manual unlock design is required rather than implying login leaves a persistent unlocked vault.

Raw `get_secret` returns plaintext to the MCP client and normally the model/history/tracing. Require an explicit disclosure setting, disabled by default. Prefer task-specific tools that use values internally and return task output. Read credentials remain read-only; management tools require separate authorization. Define project/destination restrictions, redacted diagnostics, lifecycle/lock behavior and audit coverage before implementation. MCP itself does not isolate arbitrary agent code or equivalent OS permissions.

## Initial verification — 2026-11-01

The skill-creator validator and GitHub skill publication dry-run passed. Skills CLI 1.7.4 installed the local skill into an isolated project's Codex skill directory; the installed entrypoint and portable reference were verified. Documentation/link, lint, formatting and diff checks passed. These checks do not establish behavioral compliance by every agent or guarantee that secrets remain hidden from arbitrary code. After publication, a real `skills@1.7.4 add 07rjain/passman --skill passman --agent codex --yes --copy` installation in a second isolated project succeeded; all three installed skill files matched the source. The repository has the `agent-skills` topic. The [skills.sh detail page](https://skills.sh/07rjain/passman/passman) returned HTTP 200 with Passman content. Search ranking and other client behavior remain separate checks.
