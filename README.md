# Passman

Encrypt and sign application secrets locally, store ciphertext in Passman, and retrieve plaintext in trusted application code without a vault-password prompt on ordinary reads.

The fresh **1.0.0-alpha.1** SDK/CLI and matching website are being prepared for publication. See [release status](docs/FRESH_CHANGELOG.md), [setup](docs/fresh-quickstart.md), and [actual verification](docs/fresh-testing.md). This is experimental software; begin with synthetic secrets.

## Install the fresh CLI

After the signed alpha release is published, on macOS/Linux:

```sh
curl -fsSL https://passman.subdomain.wtf/install-v1.sh | sh && . "$HOME/.local/share/passman/env"
export PASSMAN_ORIGIN=https://passman.subdomain.wtf
passman-v1 login
passman-v1 init
```

Windows uses `https://passman.subdomain.wtf/install-v1.ps1`; review and run the downloaded script in PowerShell. Both installers include a private Node.js 24 runtime and verify the pinned publisher signature/checksum. Native desktop storage requires an available OS keystore. Explicit protected file custody is available for headless Unix deployments.

`init` creates a new fresh vault. Create a project and enter values through the administrative CLI/SDK, or submit a pending value on the website and verify its exact value locally. Save a project-scoped service key once with `passman-v1 service-key save --default`. Later SDK reads use the saved credential and account-specific local key automatically.

## SDK

Node.js 24; ESM/TypeScript. After publication, install the self-contained archive:

```sh
npm install https://github.com/07rjain/passman/releases/download/passman-v1.0.0-alpha.1/passman-1.0.0-alpha.1.tgz
```

With the origin and local profile configured:

```js
import { connect } from "@passman/sdk";
const passman = await connect();
const value = await passman.getSecret({ project: "demo", name: "TOKEN" });
```

Pass `value` directly to its authorized consumer; keep it out of logs/model messages. SDK subpaths `/admin`, `/transfers` and `/writer-replacement` expose deliberate administrative operations. The normal runtime service key is read-only.

## Multiple machines and accounts

Provision a new machine once with an explicitly bootstrap-enabled service credential plus the vault password, or with an expiring code from an authorized source. Transfers exclude private signing authority. Several accounts' vaults coexist locally; the service credential selects the correct account automatically. Routine key versions synchronize without a password; compromise replacement requires explicit re-provisioning.

A runtime able to decrypt is trusted. Account-scoped keys do not provide cryptographic isolation between projects. Account login alone cannot decrypt a restoration package; login plus the vault password can restore full administration. If only read-only keys survive and the password is forgotten, administration cannot be recovered.

## Existing installations

The fresh API/schema and local custody are separate. Earlier data/keys remain available through `/legacy` and the earlier APIs; no automatic import is provided. Keep earlier vaults while those values are needed. See [earlier client releases](docs/releases.md).

## Develop

```sh
npm ci
npm run check
npm run test:fresh:isolated
npm run test:fresh:native
```

Integration tests need accessible Docker and use disposable PostgreSQL. See [deployment](docs/deployment.md), [engineering rules](docs/agent.md), [contributing](docs/CONTRIBUTING.md), and [security](docs/security.md). Platform, browser, production backup/restore and operational evidence are reported separately; source tests are not a security audit.

Source available under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use requires a separate license. Report vulnerabilities privately using [.github/SECURITY.md](.github/SECURITY.md).
