import { cp, mkdir, readFile } from "node:fs/promises";
import { assertPublishedClient } from "./public-release.mjs";
if (process.env.VERCEL_ENV === "production") {
  const { version } = JSON.parse(
    await readFile(
      new URL("../packages/client/package.json", import.meta.url),
      "utf8",
    ),
  );
  await assertPublishedClient({
    minimumVersion: version,
    publicKey: await readFile(new URL("./release-public.pem", import.meta.url)),
  });
}
const target = new URL("../apps/web/public/", import.meta.url);
await mkdir(target, { recursive: true });
await cp(
  new URL("./install.sh", import.meta.url),
  new URL("install.sh", target),
);

await cp(
  new URL("./install.ps1", import.meta.url),
  new URL("install.ps1", target),
);
