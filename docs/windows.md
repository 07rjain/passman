# Passman on Windows

Windows support starts with client 0.2.0. Supported target: Windows 10/11 x64 or arm64, Windows PowerShell 5.1 or newer, and local fixed-drive NTFS storage. The installer needs HTTPS access and the Windows `tar.exe` utility. It installs per-user without administrator access or an existing Node/npm installation. Native ARM64 acceptance is separate from x64 CI.

## Install and sign in

In PowerShell, download and review the installer, then run it:

```powershell
Invoke-WebRequest -Uri https://passman.subdomain.wtf/install.ps1 -OutFile "$env:TEMP\passman-install.ps1"
# Review the downloaded file before executing it.
& "$env:TEMP\passman-install.ps1"
& "$env:LOCALAPPDATA\Passman\bin\passman.cmd" login
```

If local policy blocks downloaded scripts, follow your organization's approved script-review/signing process. Do not disable machine-wide execution policy or run as Administrator. The installer is not Authenticode signed; restrictive enterprise policies may require administrator-approved distribution. Do not enter vault passwords or service keys into the chat.

For the current PowerShell session:

```powershell
$env:Path = "$env:LOCALAPPDATA\Passman\bin;" + $env:Path
passman --version
passman login
```

For future terminals, add `%LOCALAPPDATA%\Passman\bin` to your **user** Path through Windows Environment Variables, then reopen the terminal. The installer does not modify your profile or persistent Path. Rerun it to update. `PASSMAN_VERSION` selects a released version; the prepared signed-only installer requires a signed release (0.3.0+), while the existing public 0.2.0 installer remains checksum-only; `PASSMAN_INSTALL_DIR` selects an absolute local installation root. `PASSMAN_BIN_DIR` is Unix-only.

The CLI opens browser approval using Windows' URL handler. Compare the full fingerprint, enter the terminal's code in the website and acknowledge key loss. `--no-browser` leaves browser opening to you. Every new process still needs manual local unlock; login is not a shared unlocked session.

## Use secrets

Create a project and a scoped read credential on the website. Configure `KEYMAN_SERVICE_KEY` through trusted private configuration, without putting its value in command history or model output. Then use `passman search --project PROJECT` or `passman check --project PROJECT --name KEY`. Local uploads use `passman put` with login's separate 20-minute upload token. No CLI command prints provider values.

The SDK's versioned npm archive works with Node.js 24 on Windows; see [releases.md](releases.md). Application code decrypts locally and can access plaintext. The [agent skill](skills.md) uses the same behavior on Windows; use the `.cmd` launcher if Passman is not on Path.

## Local protection and compatibility

Vaults remain at `%USERPROFILE%\.keyman-mvp\vault.json`, with the same encrypted format as macOS/Linux. New vault directories receive a protected current-user-only ACL inherited by vault files. Existing directories/files must be owned by the current user's SID and have no Allow entries for other identities. The client rejects overly broad ACLs rather than silently fixing an existing directory. It invokes built-in Windows PowerShell without profiles to inspect ACLs; policy restrictions or unavailable ACL support fail closed.

ACL validation and reading use the same open file handle without write/delete sharing. Ancestors that unprivileged identities can delete or control are rejected.

Private passphrase/value files must use the same owner-only ACL protection. Use a dedicated private directory, never a shared repository folder. POSIX `chmod 600` is not a Windows protection mechanism. FAT/exFAT, network shares, reparse points/junctions and redirected/synchronized vault locations are unsupported. Windows administrators and equivalent-user malware can still take over the machine; ACLs do not provide that isolation. The installer rejects command metacharacters in custom installation paths.

Updates preserve the vault. Losing every private-key copy is unrecoverable. Creating a fresh key on Windows does not grant access to a vault registered on a Mac: private-key transfer/recovery remains unimplemented. Do not reset an account or replace a private key to troubleshoot an installation.

## Verification

Native Windows CI exercises crypto/SDK/vault tests, ACL rejection, junction rejection, owner-only file access, installed-package checks, and PowerShell installation/reinstallation/checksum failure with an actual private Node runtime. Installer tests use synthetic release data and real Node HTTPS downloads; they are not live Clerk/browser acceptance. Actual production login, interactive hidden input and native ARM64 testing remain separate acceptance checks.

## Verified release — 2026-11-01

[Passman 0.2.0](https://github.com/07rjain/passman/releases/tag/passman-v0.2.0) is published. [Cross-platform CI](https://github.com/07rjain/passman/actions/runs/41320353014) passed Windows x64, macOS, Linux and PostgreSQL integration. Native Windows checks include shared-ACL/junction rejection, owner-only input files, encrypted vault updates, installer reinstallation, checksum failure and installed SDK decryption.

The separate [public Windows acceptance run](https://github.com/07rjain/passman/actions/runs/41320715002) downloaded the actual hosted installer, verified it matched source, installed the public GitHub archive with the official private Node runtime, exercised SDK retrieval/decryption using a synthetic encrypted response, reinstalled and rejected an unavailable version while preserving the active command and vault. It used no real user credentials or production vault. The runner was Windows x64; native ARM64 and interactive production Clerk/browser/terminal acceptance remain pending.

Elevated Windows tokens can create files owned by the Administrators group despite a private parent directory. The client explicitly assigns owner-only security to each exclusively created vault file before writing it; existing files still fail validation if ownership or sharing is wrong.
