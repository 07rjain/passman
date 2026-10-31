#!/bin/sh
set -eu
umask 077
fail() { printf '%s\n' "Passman: $*" >&2; exit 1; }
# Version 0.1.0 remains published in the original repository. Switch this URL
# when the first new version is published from 07rjain/passman; never replace 0.1.0.
base=${PASSMAN_DOWNLOAD_BASE:-https://github.com/07rjain/keyman/releases}
case "$base" in https://*) ;; *) fail 'Downloads must use HTTPS.';; esac
for tool in curl tar mktemp uname awk grep cat mv mkdir; do command -v "$tool" >/dev/null 2>&1 || fail "Missing required tool: $tool"; done
if command -v sha256sum >/dev/null 2>&1; then hash() { sha256sum "$1" | awk '{print $1}'; }; else command -v shasum >/dev/null 2>&1 || fail 'SHA-256 verification requires shasum or sha256sum.'; hash() { shasum -a 256 "$1" | awk '{print $1}'; }; fi
fetch() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 180 "$1" -o "$2"; }
case "$(uname -s)" in Darwin) platform=darwin;; Linux) platform=linux;; *) fail 'Supported platforms: macOS and Linux. Windows support is not yet available.';; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;; *) fail 'Supported CPUs: arm64 and x64.';; esac
root=${PASSMAN_INSTALL_DIR:-"$HOME/.local/share/passman"}
bin=${PASSMAN_BIN_DIR:-"$HOME/.local/bin"}
case "$root:$bin" in *'
'*) fail 'Installation paths must not contain newlines.';; esac
case "$root" in /*) ;; *) fail "Installation directory must be absolute.";; esac
case "$bin" in /*) ;; *) fail "Command directory must be absolute.";; esac
[ ! -L "$root" ] && [ ! -L "$bin" ] || fail 'Installation directories must not be symlinks.'
mkdir -p "$root/versions" "$bin"
work=$(mktemp -d "$root/.install.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
version=${PASSMAN_VERSION:-}
if [ -z "$version" ]; then fetch "$base/latest/download/latest.txt" "$work/latest"; version=$(cat "$work/latest"); fi
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail 'Invalid release version.'
archive="passman-$version.tgz"
fetch "$base/download/passman-v$version/$archive" "$work/package.tgz"
fetch "$base/download/passman-v$version/$archive.sha256" "$work/package.sha256"
expected=$(awk -v file="$archive" '$2 == file {print $1}' "$work/package.sha256")
printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{64}$' || fail 'Invalid release checksum.'
[ "$(hash "$work/package.tgz")" = "$expected" ] || fail 'Release checksum mismatch; current installation was not changed.'
if [ -e "$root/versions/$version" ]; then
 [ -f "$root/versions/$version/installed.sha256" ] && [ "$(cat "$root/versions/$version/installed.sha256")" = "$expected" ] || fail 'Version already exists with different contents; refusing replacement.'
else
 node_version=24.22.2
 node_archive="node-v$node_version-$platform-$arch.tar.gz"
 fetch "https://nodejs.org/dist/v$node_version/$node_archive" "$work/node.tgz"
 fetch "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" "$work/node.sha256"
 node_hash=$(awk -v file="$node_archive" '$2 == file {print $1}' "$work/node.sha256")
 printf '%s\n' "$node_hash" | grep -Eq '^[0-9a-f]{64}$' || fail 'Invalid Node.js checksum.'
 [ "$(hash "$work/node.tgz")" = "$node_hash" ] || fail 'Node.js checksum mismatch.'
 mkdir "$work/release"
 tar -xzf "$work/package.tgz" -C "$work/release"
 tar -xzf "$work/node.tgz" -C "$work"
 mv "$work/node-v$node_version-$platform-$arch" "$work/release/runtime"
 "$work/release/runtime/bin/node" "$work/release/package/dist/cli.js" --version | grep -Fx "$version" >/dev/null || fail 'Installed CLI failed its version check.'
 printf '%s\n' "$expected" > "$work/release/installed.sha256"
 mv "$work/release" "$root/versions/$version"
fi
"$root/versions/$version/runtime/bin/node" --input-type=module - "$root" "$bin" "$version" <<'NODE'
import {symlinkSync,renameSync,writeFileSync,lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
const [root,bin,version]=process.argv.slice(2);
for(const file of [path.join(root,'current'),path.join(bin,'passman')]) {
 try {const stat=lstatSync(file);if(file.endsWith('/current')&&!stat.isSymbolicLink())throw Error('Existing current path is not a managed symlink');if(file.endsWith('/passman')&&(!stat.isFile()||stat.isSymbolicLink()||!readFileSync(file,'utf8').startsWith('#!/bin/sh\n# Managed by the Passman installer.\n')))throw Error('Existing command is not a regular file');}catch(e){if(e.code!=='ENOENT')throw e;}
}
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const link=path.join(root,'current.new-'+process.pid);
symlinkSync(path.join(root,'versions',version),link);renameSync(link,path.join(root,'current'));
const launcher=path.join(bin,'.passman-'+process.pid);
writeFileSync(launcher,'#!/bin/sh\n# Managed by the Passman installer.\nexec '+quote(path.join(root,'current/runtime/bin/node'))+' '+quote(path.join(root,'current/package/dist/cli.js'))+' "$@"\n',{mode:0o700,flag:'wx'});
renameSync(launcher,path.join(bin,'passman'));
NODE
printf '\nPassman %s installed. Your vault was not changed.\n' "$version"
printf 'Sign in: %s/passman login\n' "$bin"
case ":$PATH:" in *":$bin:"*) ;; *) printf 'Add the command to PATH: export PATH="%s:$PATH"\n' "$bin";; esac
printf 'Update by running this installer again. Use PASSMAN_VERSION to select a specific version.\n'
