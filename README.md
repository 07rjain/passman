# Passman

An experimental encrypted key-value store for applications and agents. The website/API uses Next.js, Clerk and PostgreSQL; the local TypeScript SDK/CLI encrypts before upload and decrypts on your machine. Names remain readable, values remain encrypted, and the vault private key stays local. Use synthetic secrets until live acceptance and independent security review are complete.

This is the standalone source repository at [07rjain/passman](https://github.com/07rjain/passman), extracted from the former Keyman MVP. The older multi-machine application is not included. Existing vault, API and database formats are preserved; creating a new Clerk application does not migrate account bindings or recover old secrets.

## Develop

Use Node.js 24 and npm 11:

```sh
git clone https://github.com/07rjain/passman.git
cd passman
npm ci
npm run check
npm run test:distribution
```

Configure a separate test PostgreSQL database and Clerk settings using [deployment.md](docs/deployment.md) and [testing.md](docs/testing.md). `npm run dev` starts the website on port 3100. Integration tests require a disposable database named `keyman_mvp_test`; never point them at deployed data.

## Deploy on Vercel

Import `07rjain/passman` and select **`apps/web`** as the Root Directory with the Next.js preset and Node.js 24. Include source files outside the Root Directory. The checked-in settings run `cd ../.. && npm ci` for installation and `npm run build` for the app, compiling its shared core prerequisite automatically.

The replacement Vercel/Clerk/database configuration and targeted two-account live acceptance are recorded in the setup and manual-test reports. Broader platform checks, operational drills and independent review remain open. Follow [the fresh setup checklist](docs/deployment.md#fresh-standalone-deployment) and record new live results in [live-setup.md](docs/live-setup.md). Earlier provider/test evidence is historical and does not establish that a replacement Clerk instance can complete signup.

## Install the released client

For the currently hosted service:

```sh
curl -fsSL https://passman.subdomain.wtf/install.sh | sh
~/.local/bin/passman login
```

The public CLI/SDK release is **0.2.0** (source prepares security release **0.3.0**, pending signed publication), distributed publicly from `07rjain/passman`. The installer uses that repository because the earlier release repository is now private. Existing local vaults and earlier immutable assets are preserved. See [releases.md](docs/releases.md).

## Agent skill

Install portable instructions for agents with shell/code access:

```sh
npx skills add 07rjain/passman --skill passman
```

The skill uses the existing local CLI/SDK; it does not install Passman, unlock a vault or receive credentials. See [agent setup and registry discovery](docs/skills.md). MCP integration is future work.

For Windows, use the [PowerShell installation guide](docs/windows.md).

## Documentation

Start with the [documentation index](docs/README.md), [quickstart](docs/quickstart.md), [troubleshooting](docs/troubleshooting.md) and [key-loss policy](docs/key-loss.md).

- [Product requirements](docs/PRD.md) and [implementation plan](docs/plan.md)
- [Design decisions](docs/simplified-design.md) and [security profile](docs/security.md)
- [Feature/regression checklist](docs/feature.md) and [testing guide](docs/testing.md)
- [Deployment](docs/deployment.md) and [current setup status](docs/live-setup.md)
- [Historical Agent37 verification](docs/agent37-verification.md)
- [Contributor guide](docs/CONTRIBUTING.md) and [engineering instructions](docs/agent.md)
- [Project changelog](docs/CHANGELOG.md) and [SDK/CLI changelog](docs/SDK_CHANGELOG.md)
- [Installation and releases](docs/releases.md)

The license is [PolyForm Noncommercial 1.0.0](LICENSE). Commercial licensing terms remain future work. Internal workspace names (`@keyman-mvp/*`), the `keyman_mvp` database schema and `~/.keyman-mvp` vault directory remain unchanged for compatibility. The distributed package is `@07rjain/passman`; npm-registry publication is not established.

Maintain documentation in `docs/`. Put disposable artifacts in ignored `ignore-docs/`. Credentials, local vaults, provider plaintext, dependencies and build output must not be committed.
