# First successful retrieval

Use a synthetic value. Passman is experimental. Supported clients: macOS/Linux arm64/x64 and [Windows x64/arm64](windows.md), Node.js 24 for the SDK. The installer provides its own runtime for the CLI.

## Install and sign in

```sh
curl -fsSL https://passman.subdomain.wtf/install.sh | sh
~/.local/bin/passman login
```

Choose a local passphrase of at least 12 characters. Sign in at the printed website URL, compare the complete fingerprint with your terminal, enter the terminal's approval code and acknowledge key loss. Wait for the CLI to confirm linking. Keep the encrypted `~/.keyman-mvp/vault.json` file and its passphrase separately protected. Neither Clerk nor Passman can recover a lost private key.

## Create a project and add a value

Create `sandbox` on the website, then run:

```sh
~/.local/bin/passman put --project sandbox --name TEST_API_KEY
~/.local/bin/passman check --project sandbox --name TEST_API_KEY
~/.local/bin/passman search --project sandbox
```

Enter a synthetic value in the hidden local prompt. Local input is preferred: encryption happens before upload. Upload authorization lasts 20 minutes; renew it with `login` using the same vault. Replacements require `--replace`. Optional website input exposes new values to the page's scripts before encryption.

## Use the SDK

Create an expiring read credential on the website, scoped to `sandbox`. It is shown once. Store it privately, never in source control, command history or model messages. Install the versioned package using the [release guide](releases.md); use the runnable [SDK example](../examples/retrieve.mjs) and the imports/options in [testing.md](testing.md#issue-a-read-credential-and-call-the-sdk).

Your application unlocks the existing local identity and calls `getSecret({ name: "TEST_API_KEY" })`. It receives plaintext: use it locally, without printing or returning it to an agent conversation. `search()` and `hasSecret()` provide metadata-only lookups. No CLI command prints provider values.

Finish by revoking the read credential and checking that further retrieval fails. Revocation does not erase values or ciphertext already copied. See [key loss and exposure](key-loss.md).
