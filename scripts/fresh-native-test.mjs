import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
if (process.platform !== "linux")
  throw new Error(
    "Run native test directly on macOS/Windows with PASSMAN_NATIVE_FIXTURE=1",
  );
const fixture = await mkdtemp(join(tmpdir(), "passman-native-fixture-"));
try {
  for (const name of ["data", "runtime", "config"])
    await mkdir(join(fixture, name), { mode: 0o700 });
  const code = `
    import {spawn} from 'node:child_process';
    const daemon=spawn('/usr/bin/gnome-keyring-daemon',['--foreground','--unlock','--components=secrets'],{stdio:['pipe','ignore','ignore']});
    daemon.stdin.end('Synthetic isolated keyring fixture\\n');
    await new Promise(resolve=>setTimeout(resolve,800));
    try {
      const child=spawn(process.execPath,['--import','tsx','--test','test/fresh-native.test.ts'],{stdio:'inherit',env:{...process.env,PASSMAN_NATIVE_FIXTURE:'1',PASSMAN_NATIVE_ISOLATED:'1'}});
      process.exitCode=await new Promise(resolve=>{child.on('exit',code=>resolve(code??1));child.on('error',()=>resolve(1))});
    } finally {daemon.kill('SIGTERM');}
  `;
  const child = spawn(
    "/usr/bin/dbus-run-session",
    ["--", process.execPath, "--input-type=module", "--eval", code],
    {
      stdio: "inherit",
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        XDG_DATA_HOME: join(fixture, "data"),
        XDG_RUNTIME_DIR: join(fixture, "runtime"),
        XDG_CONFIG_HOME: join(fixture, "config"),
      },
    },
  );
  const [codeResult] = await once(child, "exit");
  process.exitCode = codeResult ?? 1;
} finally {
  await rm(fixture, { recursive: true, force: true });
}
