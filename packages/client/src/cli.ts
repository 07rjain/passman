#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { emitKeypressEvents, type Key } from "node:readline";
import { spawn } from "node:child_process";
import path from "node:path";
import { runCli, cliErrorMessage } from "./cli-runner.js";

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

const args = process.argv.slice(2);
void runCli(args, {
  interactive: Boolean(stdin.isTTY && stdout.isTTY),
  prompt: hidden,
  print: (message) => console.log(message),
  openBrowser: (url) => {
    const child = spawn(
      process.platform === "win32"
        ? path.join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "rundll32.exe",
          )
        : process.platform === "darwin"
          ? "open"
          : "xdg-open",
      process.platform === "win32"
        ? ["url.dll,FileProtocolHandler", url]
        : [url],
      { stdio: "ignore", detached: true },
    );
    child.on("error", () => undefined);
    child.unref();
  },
}).catch((error) => {
  console.error(cliErrorMessage(error, args[0]));
  process.exitCode = 1;
});
