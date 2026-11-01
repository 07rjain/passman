import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  initializeIdentity,
  unlockIdentity,
  readPrivateFile,
  saveIdentity,
} from "@keyman-mvp/client";
import { windowsPrivatePath } from "../packages/client/src/windows";

test(
  "Windows NTFS vault rejects shared ACLs and junctions; preserves identity on save",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "passman-windows-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const directory = path.join(root, "private space-é's");
    const identity = await initializeIdentity(
      directory,
      "synthetic-passphrase",
      "https://passman.test",
    );
    await saveIdentity(directory, "synthetic-passphrase", identity);
    assert.deepEqual(
      await unlockIdentity(directory, "synthetic-passphrase"),
      identity,
    );
    const file = path.join(directory, "input.txt");
    await writeFile(file, "synthetic-local-value");
    assert.equal(await readPrivateFile(file), "synthetic-local-value");
    const payload = Buffer.from(file).toString("base64");
    const script = `$ErrorActionPreference='Stop'; $file=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')); $item=Get-Item -LiteralPath $file -Force; $acl=$item.GetAccessControl(); $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow')); $item.SetAccessControl($acl)`;
    execFileSync(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
    );
    await assert.rejects(readPrivateFile(file));
    await windowsPrivatePath(file, true);
    assert.equal(await readPrivateFile(file), "synthetic-local-value");
    const shared = path.join(root, "inherited");
    await mkdir(shared);
    await assert.rejects(
      initializeIdentity(
        shared,
        "synthetic-passphrase",
        "https://passman.test",
      ),
    );
    const junction = path.join(root, "junction");
    await symlink(directory, junction, "junction");
    await assert.rejects(unlockIdentity(junction, "synthetic-passphrase"));
  },
);
