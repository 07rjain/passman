# Passman usage reference

The public CLI/SDK release is 0.1.1. This skill has its own metadata version; it does not change client or wire/vault versions. Source and maintained guides: [07rjain/passman](https://github.com/07rjain/passman).

## CLI metadata lookup

After local login, the user privately configures `KEYMAN_SERVICE_KEY`. Interactive commands prompt again for the vault passphrase:

```sh
passman search --project production --query OPENAI
passman check --project production --name OPENAI_API_KEY
```

A noninteractive process can inherit the read token privately and use an existing owner-only passphrase file:

```sh
passman check --project production --name OPENAI_API_KEY --passphrase-file /absolute/private/passman-passphrase
```

Only the path appears in this command, never the passphrase. Do not create the file with a literal secret in an agent command or inspect it with a tool. The user provisions private inputs outside the conversation. `check` prints `Found`/`Not found`; errors are distinct failures. `search` returns up to 50 names/revisions and `nextCursor`; CLI search currently has no next-page flag. Use SDK `search({ query, after: nextCursor })` for subsequent pages.

## Application SDK

Install in the intended application's directory with Node.js 24/npm:

```sh
npm install https://github.com/07rjain/passman/releases/download/passman-v0.1.1/passman-0.1.1.tgz
```

Use the published package name `@07rjain/passman`. Do not install unrelated npm packages named `passman` or `passman-cli`. `@keyman-mvp/client` is only the repository's internal workspace name.

The following is an integration fragment: `directory`, `passphrase` and `serviceKey` are privately configured by trusted application code, not literal secrets supplied by the model.

```js
import { KeymanClient, unlockIdentity, KeymanError } from "@07rjain/passman";

try {
  const identity = await unlockIdentity(directory, passphrase);
  const client = new KeymanClient({
    identity,
    serviceKey,
    project: "production",
  });
  const exists = await client.hasSecret({ name: "OPENAI_API_KEY" });
  if (!exists) {
    // Report that the permitted name is absent. Do not silently change credentials.
  } else {
    const value = await client.getSecret({ name: "OPENAI_API_KEY" });
    // Configure/use the existing provider client with value inside this process.
    // Return only the task's intended output, never value or authorization headers.
  }
} catch (error) {
  const code = error instanceof KeymanError ? error.code : "LOCAL_SETUP_FAILED";
  // Surface only code/status. Never serialize error, config, headers or the value.
}
```

For file-based trusted configuration, `readPrivateFile(passphraseFile, 1024)` is exported by the SDK. Strip only a trailing newline from the passphrase; never print it. The repository's [retrieval example](https://github.com/07rjain/passman/blob/main/examples/retrieve.mjs) demonstrates a complete local flow (its internal import is for repository contributors; external applications use `@07rjain/passman`). Do not assume the skill installer also installs the SDK or configures/unlocks the vault.

## Management and failures

Create projects and read credentials on the website. `passman put --project PROJECT --name KEY` prompts for a value locally and requires the login-issued upload token; replacements require `--replace`. Website entry is optional: its JavaScript can see newly entered values before encryption. A read token never gains write authority.

| Failure | Response |
| --- | --- |
| `UNAUTHORIZED` | Check privately configured read-token kind, scope, expiry and revocation; do not print it |
| `NOT_FOUND` | Check exact project/name; inaccessible resources can also be hidden behind this response |
| `KEY_MISMATCH` or local unlock failure | Preserve the vault; use its original key/passphrase; no reset-based recovery |
| `UNAVAILABLE` | Check service health and operator configuration; preserve local identity |
| `CONFLICT` | Refresh metadata and retry only the requested deliberate replacement |
| `RATE_LIMITED` | Stop repeated attempts; wait/retry within service policy |

Clerk login alone does not decrypt data. Account access plus a fresh key cannot recover an old private key. No machine roster, private-key transfer, recovery, raw-value CLI output or shared unlock daemon is implemented.
