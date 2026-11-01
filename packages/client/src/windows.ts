import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
const execute = promisify(execFile);

// POSIX mode bits do not enforce Windows access. Validate NTFS ACLs by SID.
export async function windowsPrivatePath(location: string, createAcl = false) {
  const payload = Buffer.from(
    JSON.stringify({ location: path.resolve(location), createAcl }),
  ).toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
try {
 $p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
 $item = Get-Item -LiteralPath $p.location -Force
 $drive = New-Object System.IO.DriveInfo ([IO.Path]::GetPathRoot($item.FullName))
 if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'Unsupported filesystem' }
 $current = $item
 while ($null -ne $current) {
  if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are unsupported' }
  if ($current -is [IO.FileInfo]) { $current = $current.Directory } else { $current = $current.Parent }
 }
 $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
 if ($p.createAcl) {
  if ($item.PSIsContainer) {
   $acl = New-Object Security.AccessControl.DirectorySecurity
   $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  } else {
   $acl = New-Object Security.AccessControl.FileSecurity
   $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
  }
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $item.FullName -AclObject $acl
 }
 $acl = Get-Acl -LiteralPath $item.FullName
 if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Wrong owner' }
 $found = $false
 foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq 'Allow') {
   if ($rule.IdentityReference.Value -ne $sid.Value) { throw 'Shared access' }
   if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0) { $found = $true }
  }
 }
 if (!$found) { throw 'Missing owner access' }
} catch { exit 1 }
`;
  await execute(
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
    { windowsHide: true, timeout: 15000, maxBuffer: 16384 },
  );
}
