# Passman installation and releases

The public Passman SDK/CLI release is **0.3.1**, published on 2026-11-15 through the protected signing workflow. Client archives use a pinned publisher signature. The command is `passman`; the previous `keyman-mvp` command remains available. Packages use PolyForm Noncommercial 1.0.0; third-party licenses are included. This remains an experimental vault, not production security approval.

## Repository transition

Source and public client downloads live in `07rjain/passman`. Version 0.1.1 switches the installer to this public repository. The original release repository was renamed to `07rjain/keyman-2` and made private, causing unauthenticated installation to fail with 404. No earlier tag or asset is overwritten; the new release uses a new version and preserves local vault compatibility.

## Install, sign in, use

On macOS/Linux, arm64 or x64:

```sh
curl -fsSL https://passman.subdomain.wtf/install.sh | sh && . "$HOME/.local/share/passman/env"
passman login
```

The installer downloads the versioned client, verifies its pinned RSA-SHA256 publisher signature and archive checksum, fetches an official pinned Node.js 24 runtime and verifies its checksum, and activates the installation under `~/.local/share/passman`. The signed installer needs curl, tar, OpenSSL and a SHA-256 tool; it does not need existing Node/npm or sudo. The launcher is `~/.local/bin/passman`. The installer creates a managed environment file and adds it to Bash, Zsh and POSIX login configuration (`.bashrc`, `.profile`, the first existing Bash login profile and `${ZDOTDIR:-$HOME}/.zshrc`). It preserves existing settings and does not duplicate its block on reinstallation. The final part of the copied command loads that environment into the current terminal, so you can immediately use:

```sh
passman --version
passman login
passman put --project testing --name TEST_KEY
```

`signin` is an alias for `login`. Login defaults to `https://passman.subdomain.wtf`; `--url` still supports self-hosting. Existing vaults remain in `~/.keyman-mvp`, and their stored origin/key is preserved. A failed unlock never generates a replacement key. Create projects on the website before local uploads. Search/check use the privately configured `KEYMAN_SERVICE_KEY`; the CLI does not print provider values.

Client 0.3.1 requires `passman login` again when the 20-minute upload authorization expires. The unreleased CLI checks before secret input and starts browser reapproval automatically for interactive `put`, preserving the existing identity. `--no-browser` leaves opening the printed URL to you. Noninteractive `put` requires prior login and fails before reading the value if authorization is missing/expired. This does not change runtime SDK behavior or extend credential lifetimes.

A script piped into `sh` cannot change its parent terminal’s environment. If you ran the older install command, open a new terminal or run `. "$HOME/.local/share/passman/env"` once after rerunning the maintained installer. The commands above use Bash, Zsh or a POSIX-compatible shell; from another shell, run `bash` first. Symlinked, shared/writable or otherwise unsafe shell profile files are skipped with a warning and a manual activation command. Set `PASSMAN_NO_MODIFY_PATH=1` when running the installer to leave profiles untouched. The system Node installation and local vault are not modified. It refuses to replace an unrelated `passman` file, unexpected symlinks, or an already-installed version whose checksum differs. Network, checksum or version-check failures before activation leave the current version intact. Re-running the installer installs the latest published release. To select a specific release:

```sh
curl -fsSL https://passman.subdomain.wtf/install.sh | PASSMAN_VERSION=0.3.1 sh
```

`PASSMAN_INSTALL_DIR` and `PASSMAN_BIN_DIR` accept absolute custom paths. For a custom installation directory, use the exact activation command printed by the installer instead of the default environment-file path above. Older installed versions are retained, allowing explicit selection with the same installer; vault-format compatibility must be checked before downgrading across future format changes. Windows uses the [PowerShell installer](windows.md); Homebrew is not provided yet.

## npm and SDK

With Node.js 24/npm already installed, install the exact same self-contained package:

```sh
npm install -g https://github.com/07rjain/passman/releases/download/passman-v0.3.1/passman-0.3.1.tgz
passman login
```

For an application:

```sh
npm install https://github.com/07rjain/passman/releases/download/passman-v0.3.1/passman-0.3.1.tgz
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

The manually dispatched **Passman release** workflow validates the requested version, runs checks and publishes `passman-vVERSION` at the workflow commit. Configure required reviewers on the `passman-release` GitHub environment to enforce a maintainer approval gate; the environment name alone does not enforce review. Ordinary pushes and pull requests do not publish releases. Every signed release requires `npm run release:sign` with the protected publisher private key; `publish.mjs` refuses missing/invalid signatures. Direct GitHub release write access alone cannot create archives accepted by the new installers. Do not copy the signing key into repository secrets, ordinary CI, local examples or pull-request workflows.

GitHub Releases stores the archive, checksum, version pointer and installer; the website serves the maintained installer. Never overwrite a release tag or its assets: publish a new version for corrections. Keep release credentials out of contributor/PR workflows. Native standalone binaries, Homebrew, npm trusted publishing, OS executable signing, provenance and an automated server-version compatibility matrix remain future work.

## Security boundary

The immutable historical 0.2.0 installer uses checksums only. Installers since 0.3.0 require a pinned RSA-SHA256 publisher signature over each versioned checksum manifest, checked before extraction/execution. A checksum downloaded from the same origin is not independent publisher authentication; the signing key must remain separate from ordinary release-write authority. This flow trusts the HTTPS website, GitHub release account and official Node distribution. A compromised installer/client update can read local secrets when used; this does not strengthen protection against client supply-chain compromise. The archive publisher signature does not imply OS-user isolation, OS executable signing, or protection from owner-approved malicious updates. Review the script or pin a reviewed version when appropriate.

## 0.1.0 verification record

Published [passman-v0.1.0](https://github.com/07rjain/keyman-2/releases/tag/passman-v0.1.0) from commit `ef3e081` on 2026-10-31. Root and MVP GitHub CI passed on Linux/macOS, including the distribution checks; the real PostgreSQL/Next.js/CLI integration also passed. A fresh Linux installation from the actual hosted installer and a global npm installation from the public GitHub archive both returned version 0.1.0. Installer tests exercised a version upgrade, retained the prior executable and preserved the existing vault. This verifies distribution, not a live human signup or independent security audit.

The 0.1.0 record above describes its original verification; those old assets are now private. Use the current public installation instructions above.

## 0.1.1 verification record — 2026-11-01

Published [passman-v0.1.1](https://github.com/07rjain/passman/releases/tag/passman-v0.1.1) from commit `bbde134d4a2459e62fab24cf4d9442727b6e66a8`. Local `npm run check` and `npm run test:distribution` passed, including a new missing-release 404 case that preserves the active client and vault. The upgrade fixture selects a newer patch dynamically so it works after version bumps.

[MVP CI](https://github.com/07rjain/passman/actions/runs/41255160166) passed macOS/Linux checks and PostgreSQL integration. Vercel deployment `dpl_Dt8FNnkXYugUSnqm2JNyieTUnaX4` reached Ready. The public hosted installer returned 200 and matched the committed script. Anonymous fresh installation and reinstallation using `curl -fsSL https://passman.subdomain.wtf/install.sh | sh` both succeeded in isolated Linux installation directories, and the launcher returned `0.1.1`. The downloaded public archive matched the locally tested artifact's SHA-256. All four supported platform/runtime URLs returned 200. These results cover DIST-01/02/05/06/08/10 distribution behavior; they do not establish signup, database configuration or the user's own Mac setup.

## Changelog requirements

Every user-visible change includes an Unreleased entry in the appropriate changelog after tests pass. Website/API changes go in [CHANGELOG.md](CHANGELOG.md); SDK/CLI changes go in [SDK_CHANGELOG.md](SDK_CHANGELOG.md). Client releases include version/date, user impact, compatibility/migration notes and known limits; server rollout records identify the deployed commit or deployment ID. Keep historical evidence dated, reconcile current guides and never relabel a planned feature as deployed.

## 0.2.0 verification record — 2026-11-01

Published [passman-v0.2.0](https://github.com/07rjain/passman/releases/tag/passman-v0.2.0) from fully checked commit `9ffd9b6e4c1e5e513dd5bd13ca41860900628222`. Newer commit `3669632d756257389ce41f3002f9fb619034300a` adds the public Windows acceptance workflow without changing client/core sources or installers. Both cross-platform CI runs passed; see [the latest run](https://github.com/07rjain/passman/actions/runs/41320353014). No existing release asset was replaced.

Archive SHA-256: `477a953b06b331f1760bb0f552c872c0647a8485cffd18d61802199f91e84f2c`. The public archive matched the locally tested bytes. Local build/unit/package/distribution/docs checks passed. Windows CI used native NTFS ACL tests and installed SDK decryption; [actual public Windows installation](https://github.com/07rjain/passman/actions/runs/41320715002) passed fresh install, reinstall, unavailable-release preservation and synthetic SDK retrieval/decryption. The hosted PowerShell installer returned 200 and matched source. Anonymous Linux installation/reinstallation from the real hosted shell installer both returned 0.2.0.

Actual public 0.1.1 and 0.2.0 SDK archives were also exercised in an isolated Linux process: 0.1.1 created a synthetic vault; 0.2.0 unlocked/saved it with the original key; 0.1.1 could unlock the resulting file. No account, key or ciphertext migration is introduced. This is format compatibility evidence, not recovery or machine-sharing support.

Native ARM64, interactive Windows production login/hidden prompts and independent security review remain distinct gates. See [windows.md](windows.md). The manual `Windows published client acceptance` workflow can repeat the actual public-download checks after future releases; it uses synthetic local data and no Clerk/provider credentials.

## Signed-release transition

### 0.3.0 evidence — 2026-11-14

Signed [passman-v0.3.0](https://github.com/07rjain/passman/releases/tag/passman-v0.3.0) was published on 2026-11-05 from `3d996de598b299a4ab2497a6ad896049a7cfa293` through the [protected release workflow](https://github.com/07rjain/passman/actions/runs/42026452044). Read-only verification on 2026-11-14 confirmed that the latest pointer selects 0.3.0, the checksum manifest verifies against the pinned publisher key and the public archive matches that signed manifest. Both hosted installer scripts matched source. The signing environment has an owner-review gate and branch policy; administrators remain trusted.

The later website commit `6d92d164ed7e085bbc7b2fc8d2be523a8db937f7` passed [all four native/integration checks](https://github.com/07rjain/passman/actions/runs/43502992027). That CI includes installed-package and installer fixture verification; it is distinct from fresh ordinary-user signup, Mac interactive acceptance or a new live vault round trip. No existing release asset was replaced and no new client version was published during this read-only check.

### Deployment and trust boundary

Follow [the remediation rollout](security-remediation.md). The production build guard verifies the public default version, publisher signature and archive before copying the new installers. Merge source after CI, publish the signed archive through the protected workflow, then redeploy Vercel; older unsigned releases stay immutable and are intentionally rejected by the new installers. The default GitHub release pointer is not an authentication mechanism: it selects a version whose exact manifest must independently verify. Review/pin a version when installing; the pointer can still be withheld or redirected to an already signed version by a release writer. Existing installed clients are not silently updated.

Protect the signing environment with an owner reviewer and main-only deployment policy, and protect main/bootstrap changes with CODEOWNERS plus required review/checks. The environment name by itself enforces nothing. Administrators who can change these policies remain trusted. The publisher key cannot protect a bootstrap installer replaced outside this reviewed boundary.

## 0.3.1 verification record — 2026-11-15

Published [passman-v0.3.1](https://github.com/07rjain/passman/releases/tag/passman-v0.3.1) from main commit `237124eaf16acf1c85494e4f9c11ab41fcd93cde` through the [protected release workflow](https://github.com/07rjain/passman/actions/runs/43672957706). The release workflow passed native Windows package/installer acceptance, Linux source/distribution checks and publisher signing. [All four required PR checks](https://github.com/07rjain/passman/actions/runs/43672536042) passed before merge, including native macOS/Zsh, Windows and disposable PostgreSQL integration. The sole maintainer’s admin override was used for the separate-review requirement after CI; no protection settings were changed.

The public default pointer selects 0.3.1. Anonymous downloads matched the pinned publisher signature and signed manifest, and both published installers matched source. Archive SHA-256: `46e0ff016001803d0c7a249272e192da300d9d98fafb16db4dbf24fcf0128ebb`. Fresh Linux installation with a private runtime, current-terminal PATH activation, new Bash command discovery, reinstallation and unavailable-release preservation passed in isolated directories. The installed SDK encrypted/unlocked a synthetic vault, denied a wrong passphrase and decrypted a synthetic response without printing values. Existing release assets, account bindings and vault formats were preserved.

The initial production build remained blocked until publication, as designed. This verification-record update triggers a new build after publication; its deployment status must be verified separately. No real signup, browser approval or native Mac interactive installation is claimed by the release fixture checks.
