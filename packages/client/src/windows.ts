import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
const execute = promisify(execFile);

// POSIX mode bits do not enforce Windows access. Validate NTFS ACLs by SID.
async function windowsOperation(
  location: string,
  createAcl: boolean,
  readMax?: number,
) {
  const payload = Buffer.from(
    JSON.stringify({
      location: path.resolve(location),
      createAcl,
      readMax: readMax ?? null,
    }),
  ).toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$stage = 'PATH'
$stream = $null
try {
 $p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
 $item = Get-Item -LiteralPath $p.location -Force
 $drive = [System.IO.DriveInfo]::new([IO.Path]::GetPathRoot($item.FullName))
 if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'Unsupported filesystem' }
 $current = $item
 while ($null -ne $current) {
  if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are unsupported' }
  if ($current -is [IO.FileInfo]) { $current = $current.Directory } else { $current = $current.Parent }
 }
 $stage = 'IDENTITY'
 $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
 # Reject ancestors that another unprivileged identity can rename or control.
 $trusted = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
 $parent = if ($item -is [IO.FileInfo]) { $item.Directory } else { $item.Parent }
 while ($null -ne $parent) {
  $parentAcl = [IO.Directory]::GetAccessControl($parent.FullName)
  if ($trusted -notcontains $parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'Unsafe parent owner' }
  foreach ($rule in $parentAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
   if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
   $unsafe = [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
   if ($rule.AccessControlType -eq 'Allow' -and $trusted -notcontains $rule.IdentityReference.Value -and ($rule.FileSystemRights -band $unsafe) -ne 0) { throw 'Unsafe parent access' }
  }
  $parent = $parent.Parent
 }
 $stage = 'CREATE_ACL'
 if ($p.createAcl) {
  if ($item.PSIsContainer) {
   $acl = [Security.AccessControl.DirectorySecurity]::new()
   $acl.SetSecurityDescriptorSddlForm('O:' + $sid.Value + 'D:P(A;OICI;FA;;;' + $sid.Value + ')')
  } else {
   $acl = [Security.AccessControl.FileSecurity]::new()
   $acl.SetSecurityDescriptorSddlForm('O:' + $sid.Value + 'D:P(A;;FA;;;' + $sid.Value + ')')
  }
  $stage = 'SET_ACL'
  if ($item.PSIsContainer) { [IO.Directory]::SetAccessControl($item.FullName,$acl) } else { [IO.File]::SetAccessControl($item.FullName,$acl) }
 }
 $stage = 'VERIFY_ACL'
 $sections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner
 if ($null -ne $p.readMax) {
  if ($item.PSIsContainer) { throw 'Expected file' }
  # No write/delete sharing. ACL validation and reading use this exact handle.
  $stream = [IO.FileStream]::new($p.location,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $acl = $stream.GetAccessControl()
 } else {
  $acl = if ($item.PSIsContainer) { [IO.Directory]::GetAccessControl($item.FullName,$sections) } else { [IO.File]::GetAccessControl($item.FullName,$sections) }
 }
 if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { $stage = 'WRONG_OWNER'; throw 'Wrong owner' }
 $found = $false
 foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq 'Allow') {
   if ($rule.IdentityReference.Value -ne $sid.Value) { $stage = 'SHARED_ACCESS'; throw 'Shared access' }
   if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0) { $found = $true }
  }
 }
 if (!$found) { $stage = 'MISSING_OWNER_ACCESS'; throw 'Missing owner access' }
 if ($null -ne $stream) {
  if ($stream.Length -gt $p.readMax) { throw 'Input too large' }
  $bytes = New-Object byte[] ([int]$stream.Length)
  $offset = 0
  while ($offset -lt $bytes.Length) {
   $count = $stream.Read($bytes,$offset,$bytes.Length-$offset)
   if ($count -eq 0) { throw 'Incomplete read' }
   $offset += $count
  }
  [Console]::Out.Write([Convert]::ToBase64String($bytes))
  [Array]::Clear($bytes,0,$bytes.Length)
 }
} catch { [Console]::Error.WriteLine('WINDOWS_ACL_' + $stage + '_' + $_.Exception.GetType().Name); exit 1 } finally { if ($null -ne $stream) { $stream.Dispose() } }
`;
  const result = await execute(
    path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { windowsHide: true, timeout: 15000, maxBuffer: 200000 },
  );
  return result.stdout;
}

export async function windowsPrivatePath(location: string, createAcl = false) {
  await windowsOperation(location, createAcl);
}
export async function windowsReadPrivateFile(location: string, max: number) {
  if (!Number.isInteger(max) || max < 0 || max > 100000)
    throw new Error("Invalid private input limit");
  const encoded = await windowsOperation(location, false, max);
  return Buffer.from(encoded, "base64").toString("utf8");
}
