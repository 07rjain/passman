# Passman documentation

Passman is an experimental, source-available encrypted secret store. Start with synthetic values. Independent security review and operational release checks remain open.

## Use Passman

1. [Install, sign in and retrieve your first secret](quickstart.md).
2. [CLI commands, SDK methods and permissions](reference.md).
3. [Troubleshoot setup, authentication and retrieval](troubleshooting.md).
4. [Understand key loss and respond to exposure](key-loss.md).
5. [Understand account activity and audit coverage](audit.md).

- [Use Passman with an agent skill](skills.md); MCP is deferred.

- [Windows installation and local protection](windows.md).

## Understand the security model

- [Security profile and encryption](security.md).
- [Architecture and accepted design decisions](simplified-design.md).
- [Requirements](PRD.md) and [implementation plan](plan.md).

## Develop and operate

- [Contribute](CONTRIBUTING.md) and [engineering standards](agent.md).
- [Testing commands](testing.md) and [feature regression catalogue](feature.md).
- [Deploy](deployment.md), [operate and restore](operations.md), [release clients](releases.md).
- [Server/product changelog](CHANGELOG.md) and [SDK/CLI changelog](SDK_CHANGELOG.md).

## Evidence and status

The [current setup record](live-setup.md) and [2026-11-01 manual security exercise](manual-security-test-2026-11-01.md) describe finite live checks, not certification. The [earlier Agent37 report](agent37-verification.md) and [legacy deployment record](history/legacy-hosted-setup.md) are historical evidence, not instructions for current configuration.

Documentation distinguishes implemented behavior, configured infrastructure, observed test results and planned features. A checked-in feature is not automatically deployed. Losing every usable private-key copy is unrecoverable through Passman, regardless of account login or database backups.

- [Security remediation and rollout](security-remediation.md): seven-finding fixes, compatibility and verification gates.
