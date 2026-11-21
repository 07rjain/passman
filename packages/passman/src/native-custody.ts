import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { join, win32 } from "node:path";
import {
  canonicalOrigin,
  failure,
  id,
  PassmanError,
  validateAdministration,
  validateRuntime,
  type AdminMaterial,
  type RuntimeMaterial,
} from "@passman/protocol";
import {
  checkSelection,
  checkUpdate,
  checkAdminReplacement,
  checkRuntimeReplacement,
  UnixFileStore,
  type AdminCustody,
  type CustodyProfile,
  type RuntimeCustody,
  type VaultSelection,
} from "./custody.js";

// Helpers receive secrets through stdin, never process arguments or environment.
// None invokes an unlock prompt; a locked/unavailable keystore returns a typed failure.
const linuxHelper = String.raw`
import sys,json,dbus
data=json.load(sys.stdin)
def deny_locked():
 print('{"error":"VAULT_LOCKED"}');sys.exit(0)
bus=dbus.SessionBus()
service=dbus.Interface(bus.get_object('org.freedesktop.secrets','/org/freedesktop/secrets'),'org.freedesktop.Secret.Service')
_,session=service.OpenSession('plain',dbus.String('',variant_level=1))
attrs={'application':'passman.v1','slot':data['slot']}
unlocked,locked=service.SearchItems(attrs)
if locked: deny_locked()
if data['operation']=='delete':
 for item in unlocked:
  prompt=dbus.Interface(bus.get_object('org.freedesktop.secrets',item),'org.freedesktop.Secret.Item').Delete()
  if prompt!='/': deny_locked()
 print('null')
elif data['operation']=='read':
 if not unlocked:
  collection=service.ReadAlias('default')
  if collection!='/':
   properties=dbus.Interface(bus.get_object('org.freedesktop.secrets',collection),'org.freedesktop.DBus.Properties')
   if properties.Get('org.freedesktop.Secret.Collection','Locked'): deny_locked()
  print('null')
 else:
  if len(unlocked)!=1: raise RuntimeError('ambiguous')
  secret=service.GetSecrets(unlocked,session)[unlocked[0]]
  print(json.dumps(bytes(secret[2]).decode('utf-8')))
else:
 collection=service.ReadAlias('default')
 if collection=='/': raise RuntimeError('unavailable')
 properties=dbus.Interface(bus.get_object('org.freedesktop.secrets',collection),'org.freedesktop.DBus.Properties')
 if properties.Get('org.freedesktop.Secret.Collection','Locked'): deny_locked()
 obj=dbus.Interface(bus.get_object('org.freedesktop.secrets',collection),'org.freedesktop.Secret.Collection')
 props={'org.freedesktop.Secret.Item.Label':dbus.String('Passman'), 'org.freedesktop.Secret.Item.Attributes':dbus.Dictionary(attrs,signature='ss')}
 value=dbus.ByteArray(data['value'].encode('utf-8'))
 _,prompt=obj.CreateItem(props,dbus.Struct((session,dbus.ByteArray(b''),value,'text/plain'),signature='oayays'),True)
 if prompt!='/': deny_locked()
 print('null')
`;
const macHelper = String.raw`
ObjC.import('Foundation'); ObjC.import('Security');
var cf=ObjC.castRefToObject;
$.SecKeychainSetUserInteractionAllowed(false);
function failed(status) {
 if(status===-25308 || status===-25293) return JSON.stringify({error:'VAULT_LOCKED'});
 throw Error('unavailable');
}
function main() {
var data = JSON.parse($.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile,$.NSUTF8StringEncoding).js);
var q=$.NSMutableDictionary.alloc.init;
q.setObjectForKey(cf($.kSecClassGenericPassword),cf($.kSecClass));
q.setObjectForKey($('passman.v1'),cf($.kSecAttrService));
q.setObjectForKey($(data.slot),cf($.kSecAttrAccount));
// Security constants are CFStringRefs: NSDictionary requires their toll-free
// Objective-C objects. Use the default non-synchronizing file keychain with UI disabled.
if(data.operation==='delete') {
 var status=$.SecItemDelete(q); if(status!==0 && status!==-25300) return failed(status); return JSON.stringify(null);
} else if(data.operation==='read') {
 q.setObjectForKey($.NSNumber.numberWithBool(true),cf($.kSecReturnData));
 q.setObjectForKey(cf($.kSecMatchLimitOne),cf($.kSecMatchLimit));
 var result=Ref(); var status=$.SecItemCopyMatching(q,result);
 if(status===-25300) return JSON.stringify(null);
 if(status!==0) return failed(status);
 return JSON.stringify($.NSString.alloc.initWithDataEncoding(ObjC.castRefToObject(result[0]),$.NSUTF8StringEncoding).js);
} else {
 var update=$.NSMutableDictionary.alloc.init;
 update.setObjectForKey($(data.value).dataUsingEncoding($.NSUTF8StringEncoding),cf($.kSecValueData));
 var status=$.SecItemUpdate(q,update);
 if(status===-25300) {
  // Use the supported file-based login keychain; no app entitlement or iCloud synchronization.
  var add=q.mutableCopy; add.addEntriesFromDictionary(update); status=$.SecItemAdd(add,null);
 }
 if(status!==0) return failed(status); return JSON.stringify(null);
}
}
main();
`;
const windowsHelper = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Security
$d=[Console]::In.ReadToEnd()|ConvertFrom-Json
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$entropy=[Text.Encoding]::UTF8.GetBytes('passman.v1:'+$d.slot)
$root=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Passman-v1'
function Assert-Path($path) {
 $item=Get-Item -LiteralPath $path -Force
 if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'unavailable'}
 $acl=if($item.PSIsContainer){[IO.Directory]::GetAccessControl($item.FullName)}else{[IO.File]::GetAccessControl($item.FullName)}
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'unavailable'}
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid.Value -and $rule.IdentityReference.Value -ne 'S-1-5-18' -and $rule.IdentityReference.Value -ne 'S-1-5-32-544'){throw 'unavailable'}
 }
}
if(!(Test-Path -LiteralPath $root)) {
 if($d.operation -eq 'read' -or $d.operation -eq 'delete'){[Console]::Out.Write('null');exit}
 [IO.Directory]::CreateDirectory($root)|Out-Null
 $acl=New-Object Security.AccessControl.DirectorySecurity
 $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
 $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
 [IO.Directory]::SetAccessControl($root,$acl)
}
Assert-Path $root
$path=Join-Path $root ($d.slot+'.bin')
if($d.operation -eq 'delete') {
 if(Test-Path -LiteralPath $path){Assert-Path $path;Remove-Item -LiteralPath $path -Force}
 [Console]::Out.Write('null')
} elseif($d.operation -eq 'read') {
 if(!(Test-Path -LiteralPath $path)){[Console]::Out.Write('null');exit}
 Assert-Path $path
 $file=[IO.FileStream]::new($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
 try {
  if($file.Length -gt 200000){throw 'unavailable'}
  $bytes=New-Object byte[] $file.Length
  $position=0
  while($position -lt $bytes.Length){$count=$file.Read($bytes,$position,$bytes.Length-$position);if($count -eq 0){throw 'unavailable'};$position+=$count}
 }finally{$file.Dispose()}
 $plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,'CurrentUser')
 try{[Console]::Out.Write((ConvertTo-Json -Compress -InputObject ([Text.Encoding]::UTF8.GetString($plain))))}finally{[Array]::Clear($plain,0,$plain.Length)}
} else {
 if(Test-Path -LiteralPath $path){Assert-Path $path}
 $plain=[Text.Encoding]::UTF8.GetBytes($d.value)
 try{$bytes=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,'CurrentUser')}finally{[Array]::Clear($plain,0,$plain.Length)}
 $temp=Join-Path $root ([Guid]::NewGuid().ToString()+'.tmp')
 try{
  $fileAcl=New-Object Security.AccessControl.FileSecurity
  $fileAcl.SetOwner($sid);$fileAcl.SetAccessRuleProtection($true,$false)
  $fileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')))
  $file=[IO.FileStream]::new($temp,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$fileAcl)
  try{$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
  if(Test-Path -LiteralPath $path){[IO.File]::Replace($temp,$path,$null)}else{[IO.File]::Move($temp,$path)}
 }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force}}
 [Console]::Out.Write('null')
}
`;

async function invoke(data: unknown): Promise<unknown> {
  const command = helperCommand();
  const args =
    process.platform === "linux"
      ? ["-c", linuxHelper]
      : process.platform === "darwin"
        ? ["-l", "JavaScript", "-e", macHelper]
        : ["-NoProfile", "-NonInteractive", "-Command", windowsHelper];
  if (!command) return failure("STORAGE_UNAVAILABLE");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 10_000,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 200_000) child.kill();
      else chunks.push(chunk);
    });
    // Drain fixed-helper diagnostics without exposing plaintext or platform exceptions.
    child.stderr.resume();
    child.stdin.on("error", () => undefined);
    const unavailable = () => {
      try {
        failure("STORAGE_UNAVAILABLE");
      } catch (e) {
        reject(e);
      }
    };
    child.on("error", unavailable);
    child.on("close", (code) => {
      if (code !== 0 || size > 200_000) return unavailable();
      const bytes = Buffer.concat(chunks);
      try {
        const result: unknown = JSON.parse(bytes.toString("utf8"));
        if (
          result &&
          typeof result === "object" &&
          "error" in result &&
          result.error === "VAULT_LOCKED"
        )
          failure("VAULT_LOCKED");
        resolve(result);
      } catch (e) {
        if (e instanceof PassmanError) reject(e);
        else unavailable();
      } finally {
        bytes.fill(0);
        for (const chunk of chunks) chunk.fill(0);
      }
    });
    child.stdin.end(JSON.stringify(data));
  });
}
function helperCommand() {
  if (process.platform === "linux") return "/usr/bin/python3";
  if (process.platform === "darwin") return "/usr/bin/osascript";
  const root = process.env.SystemRoot;
  if (
    process.platform === "win32" &&
    root &&
    /^[A-Za-z]:\\Windows$/i.test(root)
  )
    return win32.join(
      root,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
  return undefined;
}
async function windowsLock<T>(
  slot: string,
  work: () => Promise<T>,
): Promise<T> {
  const command = helperCommand();
  if (!command) return failure("STORAGE_UNAVAILABLE");
  const script = String.raw`
$ErrorActionPreference='Stop'
$slot=[Console]::In.ReadLine()
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$mutex=New-Object Threading.Mutex($false,('Global\Passman-v1-'+$sid+'-'+$slot))
$held=$false
try {
 try{$held=$mutex.WaitOne(5000)}catch [Threading.AbandonedMutexException]{$held=$true}
 if(!$held){throw 'unavailable'}
 [Console]::Out.WriteLine('ready');[Console]::Out.Flush()
 [Console]::In.ReadLine()|Out-Null
}finally{if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}
`;
  const child = spawn(
    command,
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, timeout: 20_000 },
  );
  child.stderr.resume();
  child.stdin.on("error", () => undefined);
  let ended = false;
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => {
      ended = true;
      resolve();
    }),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      let text = "";
      child.stdout.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
        if (text.includes("ready")) resolve();
      });
      const bad = () => reject(new Error("Native custody lock unavailable"));
      child.once("error", bad);
      child.once("exit", bad);
      child.stdin.write(slot + "\n");
    });
    return await work();
  } catch (e) {
    if (e instanceof PassmanError) throw e;
    return failure("STORAGE_UNAVAILABLE");
  } finally {
    child.stdin.end("release\n");
    await Promise.race([closed, delay(1000)]);
    if (!ended) child.kill();
    await closed;
  }
}

/** OS-protected desktop storage. No fallback to plaintext files. */
export class NativeStore {
  readonly #locks =
    process.platform === "win32"
      ? undefined
      : new UnixFileStore(join(homedir(), ".passman-v1-native-locks"));
  #slot(profile: string, selection: VaultSelection) {
    if (!id.safeParse(selection.accountId).success) failure("INVALID_REQUEST");
    return createHash("sha256")
      .update(
        JSON.stringify([
          "passman.v1",
          profile,
          canonicalOrigin(selection.origin),
          id.parse(selection.accountId),
        ]),
      )
      .digest("hex");
  }
  async read(
    profile: CustodyProfile,
    selection: VaultSelection,
  ): Promise<unknown> {
    const result = await invoke({
      operation: "read",
      slot: this.#slot(profile, selection),
    });
    if (result === null) return undefined;
    if (typeof result !== "string" || Buffer.byteLength(result) > 100_000)
      return failure("STORAGE_UNAVAILABLE");
    try {
      return JSON.parse(result) as unknown;
    } catch {
      return failure("STORAGE_UNAVAILABLE");
    }
  }
  async write(
    profile: CustodyProfile,
    selection: VaultSelection,
    value: unknown,
    accept: (current: unknown) => boolean | Promise<boolean>,
  ) {
    const work = async () => {
      if (!(await accept(await this.read(profile, selection)))) return;
      const text = JSON.stringify(value);
      if (Buffer.byteLength(text) > 100_000) failure("STORAGE_UNAVAILABLE");
      await invoke({
        operation: "write",
        slot: this.#slot(profile, selection),
        value: text,
      });
    };
    if (this.#locks)
      await this.#locks.write(profile, selection, {}, async () => {
        await work();
        return false;
      });
    else await windowsLock(this.#slot(profile, selection), work);
  }
  async remove(profile: CustodyProfile, selection: VaultSelection) {
    const work = async () => {
      await invoke({
        operation: "delete",
        slot: this.#slot(profile, selection),
      });
    };
    if (this.#locks)
      await this.#locks.write(profile, selection, {}, async () => {
        await work();
        return false;
      });
    else await windowsLock(this.#slot(profile, selection), work);
  }
  async recoverLock(profile: CustodyProfile, selection: VaultSelection) {
    if (!this.#locks) return false;
    return this.#locks.recoverLock(profile, selection);
  }
}

export class NativeRuntimeCustody implements RuntimeCustody {
  readonly store = new NativeStore();
  async loadRuntime(selection: VaultSelection) {
    const input = await this.store.read("runtime", selection);
    if (input === undefined) return undefined;
    const material = await validateRuntime(input);
    checkSelection(material.anchor, selection);
    return material;
  }
  async saveRuntime(input: RuntimeMaterial) {
    const material = await validateRuntime(input);
    await this.store.write(
      "runtime",
      material.anchor,
      material,
      async (current) => {
        if (current === undefined) return true;
        const old = await validateRuntime(current);
        return checkUpdate(old, material);
      },
    );
  }
  async replaceRuntime(
    previous: RuntimeMaterial,
    replacement: RuntimeMaterial,
  ) {
    const material = await validateRuntime(replacement);
    await this.store.write(
      "runtime",
      material.anchor,
      material,
      async (current) =>
        checkRuntimeReplacement(
          current === undefined ? undefined : await validateRuntime(current),
          previous,
          material,
        ),
    );
  }
}
export class NativeAdminCustody implements AdminCustody {
  readonly store = new NativeStore();
  async loadAdmin(selection: VaultSelection) {
    const input = await this.store.read("admin", selection);
    if (input === undefined) return undefined;
    const material = await validateAdministration(input);
    checkSelection(material.runtime.anchor, selection);
    return material;
  }
  async saveAdmin(input: AdminMaterial) {
    const material = await validateAdministration(input);
    await this.store.write(
      "admin",
      material.runtime.anchor,
      material,
      async (current) => {
        if (current === undefined) return true;
        const old = await validateAdministration(current);
        return checkUpdate(old.runtime, material.runtime);
      },
    );
  }
  async replaceAdmin(previous: AdminMaterial, replacement: AdminMaterial) {
    const material = await validateAdministration(replacement);
    await this.store.write(
      "admin",
      material.runtime.anchor,
      material,
      async (current) =>
        checkAdminReplacement(
          current === undefined
            ? undefined
            : await validateAdministration(current),
          previous,
          material,
        ),
    );
  }
}
/** An explicit operator-selected POSIX location; used by CLI file mode. */
export const defaultFileDirectory = () => join(homedir(), ".passman-v1");
