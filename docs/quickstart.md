# First successful retrieval

Use a synthetic value. Passman is experimental. Supported clients: macOS/Linux arm64/x64 and [Windows x64/arm64](windows.md), Node.js 24 for the SDK. The installer provides its own runtime for the CLI.

## Install and sign in

```sh
curl -fsSL https://passman.subdomain.wtf/install.sh | sh && . "$HOME/.local/share/passman/env"
passman login
```

The copied command enables `passman` in this terminal; the installer also configures future Bash/Zsh/POSIX login shells. If you used the older command, rerun the installer and open a new terminal or load `. "$HOME/.local/share/passman/env"` once. Use the [installation guide](releases.md#install-sign-in-use) for custom paths, managed profiles or another shell.

Choose a local passphrase of at least 12 characters. Sign in at the printed website URL, compare the complete fingerprint with your terminal, enter the terminal's approval code and acknowledge key loss. Wait for the CLI to confirm linking. Keep the encrypted `~/.keyman-mvp/vault.json` file and its passphrase separately protected. Neither Clerk nor Passman can recover a lost private key.

## Create a project and add a value

Create `sandbox` on the website, then run:

```sh
passman put --project sandbox --name TEST_API_KEY
```

Enter a synthetic value in the hidden local prompt. Local input is preferred: encryption happens before upload. Upload authorization lasts 20 minutes. In client 0.3.1, renew it with `passman login` using the same vault. Client 0.3.2 automatically starts browser reapproval during interactive `put` before asking for a secret; compare the fingerprint/code as during login. `--no-browser` prints the approval URL without launching it. Noninteractive use requires prior login and stops before reading a value when authorization is missing/expired. Replacements require `--replace`. Optional website input exposes new values to the page's scripts before encryption.

## Create read access before searching or retrieving

Create an expiring read credential on the website, scoped to `sandbox`. It is shown once. Upload authorization from `login` cannot perform reads. Configure `KEYMAN_SERVICE_KEY` privately before using `check`, `search` or the SDK; never put a live key into source control, command history or model messages.

For an interactive macOS/Linux terminal, use Bash (run `bash` first if your normal shell is zsh). This reads the credential without echoing it or storing its value in shell history:

```bash
read -r -s -p 'Read service key (hidden): ' KEYMAN_SERVICE_KEY
printf '\n'
export KEYMAN_SERVICE_KEY
passman check --project sandbox --name TEST_API_KEY
passman search --project sandbox
```

Each CLI process still asks you to unlock the local vault. Windows users should follow [private read-credential configuration](windows.md#use-secrets) before the equivalent metadata commands.

## Use the SDK

With Node.js 24 installed, add the current immutable SDK archive to your application:

```sh
npm install https://github.com/07rjain/passman/releases/download/passman-v0.3.2/passman-0.3.2.tgz
```

The public package imports as `@07rjain/passman`. Use the example in the [release guide](releases.md#npm-and-sdk), supplying the existing vault directory, locally entered passphrase and scoped read credential from trusted application configuration. The [source-checkout example](../examples/retrieve.mjs) instead uses the workspace package name and the private environment settings described in [testing.md](testing.md#issue-a-read-credential-and-call-the-sdk); it is not a standalone installed-package command.

Your application unlocks the existing local identity and calls `getSecret({ name: "TEST_API_KEY" })`. It receives plaintext: use it locally, without printing or returning it to an agent conversation. `search()` and `hasSecret()` provide metadata-only lookups. No CLI command prints provider values.

Finish by revoking the read credential and checking that further retrieval fails. Revocation does not erase values or ciphertext already copied. See [key loss and exposure](key-loss.md).

For help, check [service status](https://passman.subdomain.wtf/status) and [support and feedback](support.md). Do not delete or regenerate a working local vault to retry setup.
