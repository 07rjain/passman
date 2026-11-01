$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('passman-windows-test-' + [Guid]::NewGuid())
[IO.Directory]::CreateDirectory($fixture) | Out-Null
$env:PASSMAN_INSTALL_DIR = Join-Path $fixture "install space-é's"
$version = (Get-Content -LiteralPath (Join-Path $repo 'packages/client/package.json') -Raw | ConvertFrom-Json).version
$env:PASSMAN_VERSION = $version
$env:PASSMAN_DOWNLOAD_BASE = 'https://release-fixture.test/releases'
$script:tamper = $false
# Only release downloads are intercepted; Node.zip and its checksum use actual HTTPS downloads.
function DownloadFixture($Url, $Destination) {
    if ($Url.StartsWith($env:PASSMAN_DOWNLOAD_BASE)) {
        if ($script:tamper -and $Url.EndsWith('.tgz')) { [IO.File]::WriteAllText($Destination,'corrupt'); return }
        $name = ([Uri]$Url).Segments[-1]
        Copy-Item -LiteralPath (Join-Path $repo "ignore-docs/releases/$name") -Destination $Destination
    } else { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination }
}
try {
    $text = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'install.ps1'))
    # Replace the download function only in this isolated fixture. Production script is unchanged.
    $text = $text.Replace('function Download([string]$Url, [string]$Destination) {','function RealDownload([string]$Url, [string]$Destination) {')
    $installer = [scriptblock]::Create($text.Replace('Download "','DownloadFixture "'))
    & $installer
    $launcher = Join-Path $env:PASSMAN_INSTALL_DIR 'bin/passman.cmd'
    $actual = & $launcher --version
    if ($LASTEXITCODE -ne 0 -or $actual -ne $version) { throw 'Windows launcher/version failed' }
    $vault = Join-Path $fixture 'vault'
    $env:PASSMAN_TEST_VAULT = $vault
    $consumer = Join-Path $env:PASSMAN_INSTALL_DIR "versions/$version/package/windows-test.mjs"
    [IO.File]::WriteAllText($consumer, @'
import assert from 'node:assert/strict';
import {initializeIdentity,unlockIdentity,saveIdentity,KeymanClient} from './dist/index.js';
import {encryptValue} from '@keyman-mvp/core';
const dir=process.env.PASSMAN_TEST_VAULT;
const profile=await initializeIdentity(dir,'synthetic-windows-passphrase','https://passman.test');
await saveIdentity(dir,'synthetic-windows-passphrase',profile);
assert.deepEqual(await unlockIdentity(dir,'synthetic-windows-passphrase'),profile);
await assert.rejects(unlockIdentity(dir,'synthetic-wrong-passphrase'));
profile.vault={id:crypto.randomUUID(),accountId:crypto.randomUUID(),publicKey:profile.publicKey,keyId:profile.keyId};
await saveIdentity(dir,'synthetic-windows-passphrase',profile);
const context={version:1,accountId:profile.vault.accountId,vaultId:profile.vault.id,projectId:crypto.randomUUID(),project:'windows',name:'KEY',revision:1};
const envelope=await encryptValue('synthetic-provider-value',profile.publicKey,context);
const client=new KeymanClient({identity:await unlockIdentity(dir,'synthetic-windows-passphrase'),serviceKey:'kmr_'+'a'.repeat(43),project:'windows',transport:async()=>Response.json({context,envelope})});
assert.equal(await client.getSecret({name:'KEY'}),'synthetic-provider-value');
console.log('Windows encrypted vault and SDK retrieval passed; values omitted.');
'@)
    $node = Join-Path $env:PASSMAN_INSTALL_DIR "versions/$version/runtime/node.exe"
    & $node $consumer
    if ($LASTEXITCODE -ne 0) { throw 'Installed encrypted-vault acceptance failed' }
    $before = (Get-FileHash -LiteralPath (Join-Path $vault 'vault.json')).Hash
    & $installer
    if ((& $launcher --version) -ne $version) { throw 'Reinstall failed' }
    $script:tamper = $true
    $failed = $false
    try { & $installer } catch { $failed = $true }
    if (!$failed -or (& $launcher --version) -ne $version) { throw 'Tamper must preserve active version' }
    if ((Get-FileHash -LiteralPath (Join-Path $vault 'vault.json')).Hash -ne $before) { throw 'Installer modified vault' }
    Write-Host 'Windows install, reinstall, checksum rejection, encrypted vault and identity preservation passed.'
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force
    Remove-Item Env:PASSMAN_INSTALL_DIR,Env:PASSMAN_VERSION,Env:PASSMAN_DOWNLOAD_BASE,Env:PASSMAN_TEST_VAULT -ErrorAction SilentlyContinue
}
