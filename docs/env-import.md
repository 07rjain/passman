# Import a .env file

Available in prepared client **0.4.0** and the matching server update. The latest published client remains 0.3.2 until the signed release workflow completes. This guide describes the implemented CLI and administrative SDK interface.

## Validate, preview, confirm

Create the destination project on the website, then use a protected UTF-8 file on your machine:

```sh
passman import --project Explorer --file /absolute/private/project.env --dry-run
passman import --project Explorer --file /absolute/private/project.env
```

Each command unlocks the existing local vault. If upload authorization is missing/expired, interactive commands start the existing fingerprint/code browser approval before reading the file; `--no-browser` leaves URL opening to you. A noninteractive process requires prior `passman login` with the same vault and privately provisioned unlock material.

The complete file is parsed before any import-context request. The preview prints key names, actions, counts, empty-value markers and literal-reference warnings. It never prints values, source lines or the raw file. `--dry-run` saves no values; it still requires authorization and requests account-scoped metadata, which is audited. It returns a failure when conflicts or unacknowledged empty values would block import. A normal interactive import requires typing `IMPORT` after preview. Cancelling saves no values.

File permission checks match other private CLI inputs: owner-only regular files inside a private directory with safe ancestors, no user-controlled symlinks/reparse points. POSIX normally uses file mode `600` and directory `700`; Windows requires current-user NTFS ACLs. The importer does not change permissions automatically. A typical shared/readable project directory may need a separately protected input location.

For authorized automation, privately provision the existing passphrase file and explicitly confirm saving with `--yes`:

```sh
passman import --project Explorer --file /absolute/private/project.env --passphrase-file /absolute/private/passphrase --yes
```

Never put actual passphrases or file contents into commands, source control or agent messages. Do not use shell `source`, `eval`, expansion or an agent reading the file into tool output.

## Conflicts and empty values

Existing names stop the whole import by default. Choose one policy deliberately:

```sh
passman import --project Explorer --file /absolute/private/project.env --skip-existing
passman import --project Explorer --file /absolute/private/project.env --replace
```

`--skip-existing` preserves existing entries and imports only new names. `--replace` deliberately replaces existing entries using their previewed revisions. The flags cannot be combined. Entries not named in the file are unaffected. Duplicate names inside the file always fail, regardless of policy; names are case-sensitive.

An empty selected value such as `API_KEY=` blocks saving unless `--allow-empty` is supplied. This is separate from `--yes`, which confirms the overall mutation. Empty entries that are skipped do not require acknowledgement. A batch containing only skipped entries performs no write.

## Supported syntax and limits

The file is limited to **65,536 bytes and 100 entries**. Names follow `[A-Za-z_][A-Za-z0-9_]*`, up to 256 ASCII characters. Values also retain the existing 65,536-byte per-value limit; the complete encrypted request must fit the existing 120,000-byte API limit. Large inputs are rejected, never split into partially committed batches.

Supported syntax is a documented dotenv subset, not a shell script:

```dotenv
# Synthetic examples only
export EXAMPLE_TOKEN=synthetic-token
EXAMPLE_URL=https://example.test/?a=1&b=2
EXAMPLE_LABEL="text with # and = characters"
EXAMPLE_MULTILINE='first line
second line'
EXAMPLE_REFERENCE=${EXAMPLE_TOKEN}
```

- Blank lines, comments, an initial UTF-8 BOM and Windows CRLF are accepted; line endings normalize to LF. Bare CR, invalid UTF-8, unpaired Unicode surrogates and raw binary control characters are rejected.
- Unquoted values are trimmed; `#` begins a comment. Quote a value containing a literal `#` or meaningful surrounding whitespace. Only the first assignment `=` separates the name from its value.
- Single and double quotes support multiline values. Single-quoted content is literal. Double quotes decode `\n`, `\r`, `\t`, `\"` and `\\`; other escape sequences are preserved. Trailing non-comment text after a closing quote is invalid.
- `${NAME}`, `$NAME` and `$(command)` are stored literally and flagged in the preview. Nothing is expanded or executed. Applications expecting dotenv expansion must account for this explicitly.
- Missing assignments, invalid names, duplicate keys and unclosed quotes reject the complete import. Errors contain line numbers and fixed reason codes, without source/value echoes; at most 20 syntax issues are returned.

Validation establishes file syntax and size, not that a provider credential is active or correct. The importer leaves the original file untouched; importing does not remove the plaintext copy or rotate provider credentials.

## Atomicity, authorization and failures

Values are encrypted locally using the existing pinned vault/account/project/name/revision context. The original file and provider plaintext never enter an API request. Runtime read credentials cannot import; `KeymanClient` remains read-only.

`POST /api/upload/import-context` accepts only project/name metadata and returns the pinned public vault binding plus current revisions. `POST /api/upload/import` accepts at most 100 encrypted entries. The server validates the entire request, account/key/project, still-active upload authority after lock waits and all selected revisions. It saves all selected entries and one metadata-only `secret.import` audit event in a single transaction. A conflict or audit failure rolls everything back. No schema migration or new database grants are needed; the existing migration 2 and restricted runtime grants remain prerequisites.

A concurrent write/delete can invalidate a preview. Refresh it and review the requested policy; never silently force a stale replacement. Authorization remains 20 minutes, including while you review the preview. If it expires, log in with the same vault and preview again.

A connection drop, timeout or malformed response **after submission can leave the outcome unknown** even though the database transaction itself is atomic. The client does not retry, and each prepared SDK plan allows only one commit attempt. Inspect project metadata/revisions before deliberately retrying; do not assume that an error proves nothing was saved. No persistent idempotency receipt/resume mechanism is claimed.

## Administrative SDK

The following is an integration fragment for trusted local application code. `directory`, `passphrase`, `envFile` and the user's `approved` decision are provided privately by the caller. Use the 0.4.0 package after publication, or the locally built archive from `npm run release:build` during development.

```js
import { unlockIdentity, readEnvFile, prepareEnvImport } from "@07rjain/passman";

const identity = await unlockIdentity(directory, passphrase, {
  administrative: true,
});
const source = await readEnvFile(envFile);
try {
  const plan = await prepareEnvImport({
    identity,
    project: "Explorer",
    source,
    conflicts: "error", // Or an explicitly chosen "skip" / "replace".
    allowEmpty: false,
  });
  // Only plan.preview is safe for metadata output. Obtain the user's decision.
  if (approved && plan.preview.ready) {
    const result = await plan.commit();
    // result contains names/revisions and skipped names, never values.
  }
} finally {
  source.fill(0);
}
```

`prepareEnvImport` never opens a browser or renews authorization; application code must establish administrative access separately. `parseEnv(source)` is also exported for local validation, but its entries **contain plaintext values**: never log or return them to a model. `EnvImportError` exposes safe line/reason issues. `ImportCommitError` exposes a redacted `code` and `outcome` (`not-applied` or `unknown`); ordinary authorization/context failures remain `KeymanError`. Previews are metadata snapshots; editing a preview cannot change the captured commit policy or values. JavaScript strings and equivalent OS access are not isolated or guaranteed erased by zeroing the input byte buffer.

## Rollout

Publish the new signed client and deploy the matching additive API update before asking users to import. Older clients retain existing login/put/read behavior; older servers do not support the new import endpoints and must not be used as an implicit per-entry fallback. The production signed-release guard may hold deployment until 0.4.0 is publicly available. Preserve prior release assets, vaults, account bindings and wire format 1. See [releases](releases.md), [deployment](deployment.md) and [testing](testing.md) for verification limits.
