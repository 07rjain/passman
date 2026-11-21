# Passman

## Fresh SDK 1.0.0-alpha.1

For the fresh SDK/CLI, follow [the fresh quickstart](https://github.com/07rjain/passman/blob/main/docs/fresh-quickstart.md). Use the pinned `/install-v1.sh` or `/install-v1.ps1` installer and `@passman/sdk`. Publication and live acceptance are tracked in [release status](https://github.com/07rjain/passman/blob/main/docs/FRESH_CHANGELOG.md); source examples alone do not establish that downloads are available.

On macOS/Linux after publication:

```sh
curl -fsSL https://passman.subdomain.wtf/install-v1.sh | sh && . "$HOME/.local/share/passman/env"
export PASSMAN_ORIGIN=https://passman.subdomain.wtf
passman login
passman init
```

Setup is explicit. `init` creates a new fresh vault; existing fresh accounts use `vault unlock` or `admin restore`. Never initialize a replacement key to repair a read failure. The installer exposes `passman`; npm installs also expose `passman-v1`. Keep earlier vaults while their earlier values are needed; no automatic migration occurs.

Create a project and values through the administrative CLI, then save a read service key once with `passman service-key save --default`. Ordinary reads select the credential's account and load its matching local key without a password prompt:

```js
import { connect } from "@passman/sdk";
const passman = await connect();
const value = await passman.getSecret({ project: "demo", name: "TOKEN" });
```

Pass the value directly to its authorized consumer; never include it in ordinary model messages or logs. A read service key cannot write values or restore signing authority. A missing local key requires explicit bootstrap or transfer; reads never create keys or open a browser. Website submissions remain pending until exact local verification. Read the quickstart for headless custody, transfer, multi-account selection, restoration and compromise response. Account login plus the vault password can restore administration; a forgotten password with only read-only keys surviving cannot.

The remainder of this page documents the earlier SDK/channel. Use it only for an explicitly earlier-client task; it does not describe the fresh alpha.

## Earlier SDK reference

> Passman stores encrypted application secrets and lets trusted local application code decrypt them. This guide helps an agent set up the CLI, find permitted secret names and integrate the Node.js SDK without putting secret values in its conversation.

Website: https://passman.subdomain.wtf/. Agent entry point: https://passman.subdomain.wtf/llms.txt. Complete documentation bundle: https://passman.subdomain.wtf/llms-full.txt.

Passman is experimental and source-available under PolyForm Noncommercial 1.0.0. Start with synthetic values. Names/project labels are readable; provider values are encrypted. The private decryption key stays in the user's local, passphrase-encrypted vault. The website cannot recover it.

## Start here

When a user asks to use Passman, fetch `/llms.txt`, then read the relevant linked guide or `/llms-full.txt` if the agent's context budget permits. Fetching docs does not grant access to a vault or permission to change credentials. Automatic discovery depends on the agent client; a user can explicitly say: "Read https://passman.subdomain.wtf/llms.txt and help me set up Passman for my application. Keep credentials and values out of chat."

Confirm the operating system, intended application, project and task. Check whether Passman and an existing local vault are already present. Preserve that vault and its account binding. Do not create a replacement identity to repair connectivity or a failed unlock. Use only the account/projects the user authorizes.

## Install the CLI and approve the local vault

On macOS/Linux (x64 or arm64), the stable installer selects the latest published signed client and includes a private Node.js runtime. It does not require sudo or an existing Node/npm installation. Review the installer under the user's normal installation policy:

```sh
curl -fsSL https://passman.subdomain.wtf/install.sh | sh && . "$HOME/.local/share/passman/env"
passman --version
passman login
```

The copied command activates PATH in the current Bash/Zsh/POSIX terminal; the installer also configures future terminals while preserving existing settings. With a custom install directory, source the exact environment-file path printed by the installer. See the [installation guide](https://github.com/07rjain/passman/blob/main/docs/releases.md#install-sign-in-use) for profile-edit opt-out and manual configuration.

On Windows 10/11 (x64 or arm64), use PowerShell 5.1+ and local NTFS storage. Download and review the script before running it; follow the organization's execution policy without disabling protections or running as Administrator:

```powershell
Invoke-WebRequest -Uri https://passman.subdomain.wtf/install.ps1 -OutFile "$env:TEMP\passman-install.ps1"
# Review the downloaded file before executing it.
& "$env:TEMP\passman-install.ps1"
& "$env:LOCALAPPDATA\Passman\bin\passman.cmd" --version
& "$env:LOCALAPPDATA\Passman\bin\passman.cmd" login
```

Have the user run interactive login in their own terminal, enter the vault passphrase privately, sign in through the website, compare the full terminal/browser fingerprint and enter the terminal approval code on the website. Never ask for a passphrase, approval code, service key or vault file in chat. `login --no-browser` leaves opening the approval page to the user.

The default vault directory is `~/.keyman-mvp` (`%USERPROFILE%\.keyman-mvp` on Windows). Login saves an encrypted identity, not a shared unlocked session. Each CLI/SDK process must unlock locally. A fresh machine/key cannot decrypt an existing account's values merely by signing in. Private-key transfer and account-only recovery are not implemented.

## Create a project and add a value

The user creates a project such as `sandbox` on the website. Add a synthetic value through the hidden local CLI prompt:

```sh
passman put --project sandbox --name TEST_API_KEY
```

Windows users run `& "$env:LOCALAPPDATA\Passman\bin\passman.cmd" put --project sandbox --name TEST_API_KEY` in PowerShell. Login issues a separate upload credential that lasts 20 minutes; renew it with login using the same vault. Existing entries require an intentional `--replace`. Do not overwrite, revoke or delete entries just to test a connection.

Client 0.3.2 can start browser reapproval automatically during interactive `put` before secret input; client 0.3.1 requires explicit login after expiry. The user must still compare the fingerprint/code and approve privately. Noninteractive `put` stops before reading a value if authorization is missing/expired: have the user run `passman login` with the same vault, then retry. `--no-browser` prints the approval URL without opening it. SDK calls never start browser approval.

Local input encrypts before upload. Optional website input exposes new plaintext to that page's JavaScript before encryption and is not safe against malicious website code. Neither setup nor value entry requires uploading the private key.

## Configure read access before searching or retrieving

For a user-authorized `.env` import, client/server 0.4.0 provides `passman import --project sandbox --file /absolute/private/project.env --dry-run`. Run the parser/importer directly; never read the private file into model/tool output. The preview exposes names/statuses only. Saving requires confirmation (or an already authorized `--yes`); defaults stop on existing names and empty selected values. Use skip/replace/allow-empty only according to the user’s requested policy. An unknown commit outcome must not be automatically retried. Version 0.4.0 is prepared, not yet published. See [the import guide](env-import.md).

The user creates an expiring, preferably project-scoped read service credential on the website. It is shown once. Configure `KEYMAN_SERVICE_KEY` through trusted private local configuration; do not put its value in commands, source, shell history, model messages or tool output. Login's upload credential does not grant read access.

Once privately configured, these commands return metadata only and still require local vault unlock:

```sh
passman search --project sandbox --query API
passman check --project sandbox --name TEST_API_KEY
```

`check` prints `Found` or `Not found`. `search` returns up to 50 names/revisions and a `nextCursor`; the CLI currently has no next-page flag, so use SDK pagination when needed. There is no CLI command that prints secret values. Read credentials cannot write secrets, create projects, revoke credentials or access account activity.

For noninteractive execution, the user can privately provision an owner-only passphrase file outside the repository/model-visible workspace, or use a trusted application-side unlock flow. `--passphrase-file /absolute/private/path` accepts a protected file; the program may read it directly, but the agent must not inspect its contents or print it. POSIX requires private ownership/modes and safe ancestors; Windows requires current-user NTFS ACLs, not chmod. If private unlock/read configuration is unavailable, ask the user to complete that local step rather than placing secrets in chat.

## Use secrets in trusted application code

The application SDK requires Node.js 24/npm. Install the published archive in the intended application directory; do not install unrelated npm packages called `passman` or `passman-cli`. The current immutable release is 0.3.2; consult the release guide for updates:

```sh
npm install https://github.com/07rjain/passman/releases/download/passman-v0.3.2/passman-0.3.2.tgz
```

The public import is `@07rjain/passman`; `@keyman-mvp/client` is an internal source-workspace name. This example is an integration fragment: `directory`, `passphrase` and `serviceKey` come from trusted private application configuration, not model-generated literals:

```js
import { KeymanClient, unlockIdentity, KeymanError } from "@07rjain/passman";

try {
  const identity = await unlockIdentity(directory, passphrase);
  const client = new KeymanClient({ identity, serviceKey, project: "sandbox" });
  const exists = await client.hasSecret({ name: "TEST_API_KEY" });
  if (exists) {
    const value = await client.getSecret({ name: "TEST_API_KEY" });
    // Pass value directly to the intended application/provider client.
    // Never print it or return it to the model, tracing or logs.
  }
} catch (error) {
  const code = error instanceof KeymanError ? error.code : "LOCAL_SETUP_FAILED";
  // Report only this safe code; never serialize the error/configuration.
}
```

Use `client.search({ query, after: nextCursor })` for subsequent metadata pages. `KeymanClient` has no mutation method. Administrative `uploadValue` is separately exported and needs upload authorization. Each application process unlocks the existing identity; importing the SDK does not create keys or open a browser.

## Agent integration

For clients that support Agent Skills, review and install the portable Passman instructions:

```sh
npx skills add 07rjain/passman --skill passman
```

This installs instructions only, not the CLI/SDK, credentials or an unlocked vault. Reload the client's skill discovery if required. Codex users can invoke `$passman`; other clients use their own skill mechanism. An example task is: "Use Passman to check whether sandbox/TEST_API_KEY exists and integrate it into my application without printing the value."

Prefer a task-specific application handler that uses the secret internally and returns only the intended result. SDK retrieval returns plaintext to the calling application: a raw `getSecret` tool would expose it to the agent/model. An agent with arbitrary code execution and equivalent OS permissions may still access local plaintext; instructions are not a security sandbox. No MCP server, shared unlock daemon or automatic secret injection is implemented.

## Failures and support

- `UNAUTHORIZED` / `FORBIDDEN`: check the privately supplied credential kind, scope, expiry and revocation. Do not print it or probe unrelated projects.
- `NOT_FOUND`: check the requested project/name; inaccessible resources can also be hidden by this response. Do not treat every failure as absence.
- `KEY_MISMATCH` or local unlock failure: preserve the existing vault; use its original key/passphrase. Never reset/delete it as a repair.
- `UNAVAILABLE`: check https://passman.subdomain.wtf/status and preserve local identity. The health check does not prove sign-in, email delivery or a complete vault operation.
- `RATE_LIMITED`: stop repeated attempts and retry later within service policy.
- `CONFLICT`: refresh metadata and retry only the deliberate replacement requested by the user.

Support: https://passman.subdomain.wtf/support. Public issues: https://github.com/07rjain/passman/issues/new. Include only safe error codes, OS/version and synthetic reproduction steps. Report vulnerabilities privately at https://github.com/07rjain/passman/security/advisories/new. Support is best-effort with no guaranteed response time.

Losing every usable private-key copy is unrecoverable through Passman, login or database backups. Revoking a credential stops future retrieval but cannot erase copied values/ciphertext. Rotate an exposed provider key at its provider. Keep private keys, passphrases, service credentials and provider values out of documentation, chats, URLs, logs and committed files.

## Essential guides

- [Quickstart](https://raw.githubusercontent.com/07rjain/passman/main/docs/quickstart.md): installation, local upload and private read configuration.
- [CLI/SDK reference](https://raw.githubusercontent.com/07rjain/passman/main/docs/reference.md): supported commands, methods and credential permissions.
- [Releases and SDK installation](https://raw.githubusercontent.com/07rjain/passman/main/docs/releases.md): current version, package import and signature verification.
- [Windows](https://raw.githubusercontent.com/07rjain/passman/main/docs/windows.md): PowerShell, launcher and NTFS requirements.
- [Agent skill](https://raw.githubusercontent.com/07rjain/passman/main/skills/passman/SKILL.md): portable agent instructions.
- [Agent usage reference](https://raw.githubusercontent.com/07rjain/passman/main/skills/passman/references/usage.md): SDK examples, pagination and redacted failures.
- [Security](https://raw.githubusercontent.com/07rjain/passman/main/docs/security.md): encryption, local-key and hosted-input boundaries.
- [Troubleshooting](https://raw.githubusercontent.com/07rjain/passman/main/docs/troubleshooting.md): setup and retrieval failures.
- [Key loss](https://raw.githubusercontent.com/07rjain/passman/main/docs/key-loss.md): preservation, recovery limits and exposure response.
- [Support](https://raw.githubusercontent.com/07rjain/passman/main/docs/support.md): safe public and private reporting.
