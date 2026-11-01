#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { emitKeypressEvents, type Key } from "node:readline";
import { stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  initializeIdentity,
  unlockIdentity,
  saveIdentity,
  readPrivateFile,
  startLogin,
  pollLogin,
  uploadValue,
  KeymanClient,
  KeymanError,
} from "./index.js";
const args = process.argv.slice(2),
  command = args[0] === "signin" ? "login" : args[0];
function option(name: string, required = true) {
  const index = args.indexOf("--" + name),
    value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    if (required) throw new Error(`Missing --${name}`);
    return "";
  }
  return value;
}
async function hidden(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error(
      "Protected input requires a terminal or an explicit protected file",
    );
  stdout.write(label);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => {
      stdin.off("keypress", listener);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const listener = (text: string, key: Key) => {
      if (key.name === "return") {
        done();
        resolve(value);
      } else if (key.ctrl && (key.name === "c" || key.name === "d")) {
        done();
        reject(new Error("Cancelled"));
      } else if (key.name === "backspace")
        value = [...value].slice(0, -1).join("");
      else if (!key.ctrl && !key.meta && text && !text.includes("\u001b"))
        value += text;
    };
    stdin.on("keypress", listener);
  });
}
async function main() {
  if (command === "--version" || command === "version") {
    const metadata = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    console.log(metadata.version);
    return;
  }
  if (!["login", "put", "search", "check"].includes(command ?? "")) {
    console.log(
      "Passman: login (or signin); put --project NAME --name KEY [--replace]; search --project NAME [--query TEXT]; check --project NAME --name KEY; --version. No command prints provider values. Optional --url ORIGIN, --directory, --passphrase-file, --value-file, --no-browser. Default service: https://passman.subdomain.wtf.",
    );
    return;
  }
  const directory =
      option("directory", false) || path.join(homedir(), ".keyman-mvp"),
    passwordFile = option("passphrase-file", false);
  const password = passwordFile
    ? (await readPrivateFile(passwordFile, 1024)).replace(/\r?\n$/, "")
    : await hidden("Local vault passphrase (12+ characters): ");
  let exists = true;
  try {
    await stat(path.join(directory, "vault.json"));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      exists = false;
    else throw error;
  }
  if (!exists && command !== "login")
    throw new Error("Initialize your local identity first");
  if (
    !exists &&
    !passwordFile &&
    (await hidden("Repeat passphrase: ")) !== password
  )
    throw new Error("Passphrases differ");
  const identity = exists
    ? await unlockIdentity(directory, password, {
        administrative: command === "login" || command === "put",
      })
    : await initializeIdentity(
        directory,
        password,
        option("url", false) || "https://passman.subdomain.wtf",
      );
  if (command === "login") {
    const url = option("url", false);
    if (url && url !== identity.origin)
      throw new Error(
        "Use the original origin; this command does not replace a vault or endpoint",
      );
    const started = await startLogin(identity);
    console.log(
      `Vault fingerprint: ${started.keyId}\nApproval code: ${started.userCode}\nOpen: ${started.verificationUrl}`,
    );
    if (!args.includes("--no-browser")) {
      const child = spawn(
        process.platform === "win32"
          ? "rundll32.exe"
          : process.platform === "darwin"
            ? "open"
            : "xdg-open",
        process.platform === "win32"
          ? ["url.dll,FileProtocolHandler", started.verificationUrl]
          : [started.verificationUrl],
        { stdio: "ignore", detached: true },
      );
      child.on("error", () => undefined);
      child.unref();
    }
    for (
      let elapsed = 0;
      elapsed < started.expiresIn;
      elapsed += started.interval
    ) {
      const approved = await pollLogin(identity, started.deviceCode);
      if (approved) {
        await saveIdentity(directory, password, approved);
        console.log(
          "Account linked. Local upload authorization lasts 20 minutes; the private key remains local.",
        );
        return;
      }
      await delay(started.interval * 1000);
    }
    throw new KeymanError("EXPIRED");
  }
  if (command === "put") {
    const file = option("value-file", false),
      value = file
        ? await readPrivateFile(file, 65536)
        : await hidden("Secret value (hidden): ");
    const result = await uploadValue(
      identity,
      option("project"),
      option("name"),
      value,
      args.includes("--replace"),
    );
    console.log(`Stored encrypted value at revision ${result.revision}.`);
    return;
  }
  // Read credentials are supplied through protected local configuration, never CLI arguments.
  const serviceKey = process.env.KEYMAN_SERVICE_KEY;
  if (!serviceKey) throw new Error("Set KEYMAN_SERVICE_KEY privately");
  const client = new KeymanClient({
    identity,
    serviceKey,
    project: option("project"),
  });
  if (command === "search")
    console.log(
      JSON.stringify(
        await client.search({ query: option("query", false) }),
        null,
        2,
      ),
    );
  else
    console.log(
      (await client.hasSecret({ name: option("name") }))
        ? "Found"
        : "Not found",
    );
}
void main().catch((error) => {
  console.error(
    error instanceof KeymanError
      ? error.message
      : "Operation failed. Check setup, protected files, passphrase, or connectivity. Sensitive details omitted.",
  );
  process.exitCode = 1;
});
