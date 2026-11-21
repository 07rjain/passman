import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
assert.equal(process.platform, "darwin", "Use this runner only on macOS");
const security = (...args) =>
  execFileSync("/usr/bin/security", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const parsePaths = (text) =>
  text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.trim()));
const previousDefault = parsePaths(
  security("default-keychain", "-d", "user"),
)[0];
const previousSearch = parsePaths(security("list-keychains", "-d", "user"));
const directory = await mkdtemp(path.join(tmpdir(), "passman-keychain-test-"));
const keychain = path.join(directory, "synthetic.keychain-db");
// Disposable fixture password, never an account/vault/OS login password.
const password = "Synthetic disposable CI keychain";
try {
  security("create-keychain", "-p", password, keychain);
  security("set-keychain-settings", "-lut", "21600", keychain);
  security("unlock-keychain", "-p", password, keychain);
  security("list-keychains", "-d", "user", "-s", keychain);
  security("default-keychain", "-d", "user", "-s", keychain);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "test/fresh-native.test.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        PASSMAN_NATIVE_FIXTURE: "1",
        PASSMAN_NATIVE_MACOS_KEYCHAIN: keychain,
        PASSMAN_NATIVE_MACOS_PASSWORD: password,
      },
      timeout: 120000,
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (process.exitCode !== 0) {
    // Fixed synthetic data only: diagnose the native bridge, never dump SDK payloads.
    const probe = spawnSync(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        String.raw`
ObjC.import('Foundation'); ObjC.import('Security');
var cf=ObjC.castRefToObject;
var stage='interaction';
try {
 $.SecKeychainSetUserInteractionAllowed(false);
 stage='query';
 var q=$.NSMutableDictionary.alloc.init;
 q.setObjectForKey(cf($.kSecClassGenericPassword),cf($.kSecClass));
 q.setObjectForKey($('passman.synthetic.probe'),cf($.kSecAttrService));
 q.setObjectForKey($('fixture'),cf($.kSecAttrAccount));
 // Match the adapter's default, non-synchronizing file-keychain query.
 stage='read-missing'; var result=Ref(); q.setObjectForKey($.NSNumber.numberWithBool(true),cf($.kSecReturnData));
 console.log('synthetic.read-missing.status='+$.SecItemCopyMatching(q,result));
 q.removeObjectForKey(cf($.kSecReturnData)); stage='add';
 var add=q.mutableCopy;
 add.setObjectForKey($('synthetic').dataUsingEncoding($.NSUTF8StringEncoding),cf($.kSecValueData));
 console.log('synthetic.add.status='+$.SecItemAdd(add,null));
 stage='read';q.setObjectForKey($.NSNumber.numberWithBool(true),cf($.kSecReturnData));
 var status=$.SecItemCopyMatching(q,result); console.log('synthetic.read.status='+status);
 if(status===0){stage='decode';console.log('synthetic.decode.type='+typeof $.NSString.alloc.initWithDataEncoding(ObjC.castRefToObject(result[0]),$.NSUTF8StringEncoding).js);}
 q.removeObjectForKey(cf($.kSecReturnData));stage='delete';console.log('synthetic.delete.status='+$.SecItemDelete(q));
}catch(e){console.log('synthetic.bridge.stage='+stage+' error='+String(e));}
`,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    process.stdout.write(probe.stdout ?? "");
    process.stdout.write(probe.stderr ?? "");
  }
} finally {
  if (previousDefault)
    security("default-keychain", "-d", "user", "-s", previousDefault);
  security("list-keychains", "-d", "user", "-s", ...previousSearch);
  try {
    security("delete-keychain", keychain);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
