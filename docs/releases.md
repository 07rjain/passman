# Passman installation and releases

Passman SDK and CLI share version **0.1.1**. The command is `passman`; the previous `keyman-mvp` command remains available. Packages use PolyForm Noncommercial 1.0.0; third-party licenses are included. This remains an experimental vault, not production security approval.

## Repository transition

Source and public client downloads live in `07rjain/passman`. Version 0.1.1 switches the installer to this public repository. The original release repository was renamed to `07rjain/keyman-2` and made private, causing unauthenticated installation to fail with 404. No earlier tag or asset is overwritten; the new release uses a new version and preserves local vault compatibility.

## Install, sign in, use

On macOS/Linux, arm64 or x64:

```sh
curl -fsSL https://passman.subdomain.wtf/install.sh | sh
~/.local/bin/passman login
```

The installer downloads the versioned client and an official pinned Node.js 24 runtime, verifies SHA-256 checksums, and activates the installation under `~/.local/share/passman`. It needs curl, tar and a SHA-256 tool; it does not need existing Node/npm or sudo. The launcher is `~/.local/bin/passman`. Add that directory to your shell PATH to use the shorter command:

```sh
export PATH="$HOME/.local/bin:$PATH"
passman --version
passman login
passman put --project testing --name TEST_KEY
```

`signin` is an alias for `login`. Login defaults to `https://passman.subdomain.wtf`; `--url` still supports self-hosting. Existing vaults remain in `~/.keyman-mvp`, and their stored origin/key is preserved. A failed unlock never generates a replacement key. Create projects on the website before local uploads. Search/check use the privately configured `KEYMAN_SERVICE_KEY`; the CLI does not print provider values.

The installer does not modify shell profiles, the system Node installation, or the local vault. It refuses to replace an unrelated `passman` file, unexpected symlinks, or an already-installed version whose checksum differs. Network, checksum or version-check failures before activation leave the current version intact. Re-running the installer installs the latest published release. To select a specific release:

```sh
curl -fsSL https://passman.subdomain.wtf/install.sh | PASSMAN_VERSION=0.1.1 sh
```

`PASSMAN_INSTALL_DIR` and `PASSMAN_BIN_DIR` accept absolute custom paths. Older installed versions are retained, allowing explicit selection with the same installer; vault-format compatibility must be checked before downgrading across future format changes. Windows and Homebrew are not provided yet.

## npm and SDK

With Node.js 24/npm already installed, install the exact same self-contained package:

```sh
npm install -g https://github.com/07rjain/passman/releases/download/passman-v0.1.1/passman-0.1.1.tgz
passman login
```

For an application:

```sh
npm install https://github.com/07rjain/passman/releases/download/passman-v0.1.1/passman-0.1.1.tgz
```

```js
import { KeymanClient, unlockIdentity } from "@07rjain/passman";

// Supply directory/passphrase/serviceKey through trusted local configuration.
const identity = await unlockIdentity(directory, passphrase);
const client = new KeymanClient({ identity, serviceKey, project: "testing" });
const value = await client.getSecret({ name: "TEST_KEY" });
// Use value in trusted application code; do not return it in model-facing output.
```

The archive bundles its exact runtime dependencies, includes ESM/TypeScript declarations and installs without contacting the npm registry for dependencies. The npm names `passman` and `passman-cli` belong to other projects; do not install those expecting this client. `@07rjain/passman` identifies this archive; npm-registry ownership/publication has not been established. The source workspace continues to use `@keyman-mvp/client` for compatibility.

## Version and changelog workflow

Record every user-visible client fix, feature or breaking change under Unreleased in [SDK_CHANGELOG.md](SDK_CHANGELOG.md). Before releasing:

```sh
npm run release:version -- patch
npm run check
npm run test:distribution
npm run release:build
```

Use patch for compatible fixes, minor for new functionality and pre-1.0 breaking behavior, and major for breaking behavior after 1.0. The version command refuses an empty Unreleased section, updates the client manifest and workspace lockfile, and promotes the notes to a dated release section. Review and commit the diff. SDK/CLI versions do not implicitly change the server protocol or vault format.

Release artifacts are created in ignored `ignore-docs/releases`. The npm archive includes only the built client, bundled runtime dependency trees, license and notices; it does not need server credentials or a database. `test:distribution` installs that archive offline in an independent consumer, checks runtime/types/version output and tests HTTPS installation, repeat installation, corrupted-package rejection and preservation of an existing vault. The installer test downloads the pinned official Node runtime and requires network access plus OpenSSL.

The manually dispatched **Passman release** workflow validates the requested version, runs checks and publishes `passman-vVERSION` at the workflow commit. Configure required reviewers on the `passman-release` GitHub environment to enforce a maintainer approval gate; the environment name alone does not enforce review. Ordinary pushes and pull requests do not publish releases. A maintainer may instead run `RELEASE_COMMIT=FULL_SHA node distribution/publish.mjs` after local checks with GitHub CLI authorization.

GitHub Releases stores the archive, checksum, version pointer and installer; the website serves the maintained installer. Never overwrite a release tag or its assets: publish a new version for corrections. Keep release credentials out of contributor/PR workflows. Native binaries, Homebrew, Windows, npm trusted publishing, signatures/provenance and an automated server-version compatibility matrix remain future work.

## Security boundary

Checksums detect corruption and mismatched files; a checksum downloaded from the same origin is not independent publisher authentication. This flow trusts the HTTPS website, GitHub release account and official Node distribution. A compromised installer/client update can read local secrets when used; this does not strengthen protection against client supply-chain compromise. No claim of code signing or OS-user isolation is made. Review the script or pin a reviewed version when appropriate.

## 0.1.0 verification record

Published [passman-v0.1.0](https://github.com/07rjain/keyman-2/releases/tag/passman-v0.1.0) from commit `ef3e081` on 2026-10-31. Root and MVP GitHub CI passed on Linux/macOS, including the distribution checks; the real PostgreSQL/Next.js/CLI integration also passed. A fresh Linux installation from the actual hosted installer and a global npm installation from the public GitHub archive both returned version 0.1.0. Installer tests exercised a version upgrade, retained the prior executable and preserved the existing vault. This verifies distribution, not a live human signup or independent security audit.

The 0.1.0 record above describes its original verification; those old assets are now private. Use the public 0.1.1 instructions for current installation.

## 0.1.1 verification record — 2026-11-01

Published [passman-v0.1.1](https://github.com/07rjain/passman/releases/tag/passman-v0.1.1) from commit `bbde134d4a2459e62fab24cf4d9442727b6e66a8`. Local `npm run check` and `npm run test:distribution` passed, including a new missing-release 404 case that preserves the active client and vault. The upgrade fixture selects a newer patch dynamically so it works after version bumps.

[MVP CI](https://github.com/07rjain/passman/actions/runs/41255160166) passed macOS/Linux checks and PostgreSQL integration. Vercel deployment `dpl_Dt8FNnkXYugUSnqm2JNyieTUnaX4` reached Ready. The public hosted installer returned 200 and matched the committed script. Anonymous fresh installation and reinstallation using `curl -fsSL https://passman.subdomain.wtf/install.sh | sh` both succeeded in isolated Linux installation directories, and the launcher returned `0.1.1`. The downloaded public archive matched the locally tested artifact's SHA-256. All four supported platform/runtime URLs returned 200. These results cover DIST-01/02/05/06/08/10 distribution behavior; they do not establish signup, database configuration or the user's own Mac setup.
