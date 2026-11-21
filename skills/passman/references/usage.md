# Passman usage reference

The public CLI/SDK release is 0.3.2. Client 0.4.0 with environment-file import is prepared but not yet published; it requires matching server endpoints. This skill has its own metadata version; it does not change client or wire/vault versions. Source and maintained guides: [07rjain/passman](https://github.com/07rjain/passman).

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
npm install https://github.com/07rjain/passman/releases/download/passman-v0.3.2/passman-0.3.2.tgz
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

## Environment-file import

Requires client/server 0.4.0. Check `passman --version` before using these commands; 0.3.2 does not implement import. Publication and compatible server rollout are separate from installing this skill. The user must supply the intended project and protected local file path.

```sh
passman import --project production --file /absolute/private/project.env --dry-run
passman import --project production --file /absolute/private/project.env
```

The importer reads the protected file privately, validates the full UTF-8 dotenv document and previews only names/actions/counts. Never read or quote its contents in agent output. Limits are 64 KiB, 100 case-sensitive ASCII environment names and existing per-value/API bounds. Quotes/comments/export/multiline are supported; malformed lines, invalid UTF-8, binary controls and duplicate keys fail with redacted line/reason errors. References such as `${NAME}` and `$(command)` are literal, not expanded or executed. Syntax validity does not establish provider-key validity.

The normal command asks for `IMPORT` after preview. With user-authorized automation, use the privately provisioned `--passphrase-file` plus `--yes`. Local unlock and short-lived upload authorization remain required; interactive commands can start bound browser approval before file access, while noninteractive commands require prior login. Never ask for passphrases, approval codes or file contents in chat.

Existing names stop the entire import by default. Use `--skip-existing` to preserve existing values or `--replace` only for intended replacements; do not choose an overwrite merely to clear an error. Selected empty values require `--allow-empty` separately from confirmation. No entries are deleted because they are absent from the file.

For trusted application code, administrative `prepareEnvImport({identity, project, source, conflicts, allowEmpty})` returns a metadata-only `.preview` and a single-use `.commit()`. `readEnvFile(path)` reads protected bytes; `parseEnv(source)` returns plaintext entries and must never be logged or exposed to the model. Runtime `KeymanClient` has no import method and read credentials cannot write.

The commit encrypts locally and saves selected entries atomically. A conflict/denial requires a fresh preview. `ImportCommitError.outcome === "unknown"` means the response may have been lost after commit: do not automatically retry, add `--replace`, or claim nothing was saved. Inspect project metadata/revisions and obtain any needed direction for a deliberate retry. No values, file contents, tokens or raw errors belong in audit/tool output. The original file remains on disk.

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

Windows uses the per-user `.cmd` launcher and private NTFS ACLs rather than chmod. Follow the [Windows guide](https://github.com/07rjain/passman/blob/main/docs/windows.md). A separately generated Windows identity cannot recover an account bound to another private key.
