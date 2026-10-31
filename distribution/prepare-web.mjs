import { cp, mkdir } from "node:fs/promises";
const target = new URL("../apps/web/public/", import.meta.url);
await mkdir(target, { recursive: true });
await cp(
  new URL("./install.sh", import.meta.url),
  new URL("install.sh", target),
);
