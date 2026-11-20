import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
export async function buildDistribution(
  output = path.join(root, "ignore-docs/releases"),
  packageDirectory = "client",
) {
  const stage = await mkdtemp(path.join(tmpdir(), "passman-release-"));
  try {
    const client = JSON.parse(
      await readFile(
        path.join(root, `packages/${packageDirectory}/package.json`),
        "utf8",
      ),
    );
    if (!/^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/.test(client.version))
      throw Error("Release must use a supported semantic version");
    const metadata = {
      ...client,
      name:
        packageDirectory === "passman" ? "@passman/sdk" : "@07rjain/passman",
      private: true,
      scripts: undefined,
      files: ["dist", "node_modules", "README.md", "LICENSE", "THIRD_PARTY.md"],
      bundleDependencies: Object.keys(client.dependencies),
      repository: {
        type: "git",
        url: "https://github.com/07rjain/passman.git",
        directory: `packages/${packageDirectory}`,
      },
    };
    await cp(
      path.join(root, `packages/${packageDirectory}/dist`),
      path.join(stage, "dist"),
      { recursive: true },
    );
    const seen = new Map();
    const notices = [];
    async function include(name, from) {
      const require = createRequire(path.join(from, "package.json"));
      let source;
      for (const directory of require.resolve.paths(name) ?? []) {
        try {
          const candidate = await realpath(path.join(directory, name));
          const metadata = JSON.parse(
            await readFile(path.join(candidate, "package.json"), "utf8"),
          );
          if (metadata.name === name) {
            source = candidate;
            break;
          }
        } catch {
          /* Continue searching installed package roots. */
        }
      }
      if (!source) throw Error("Cannot locate dependency " + name);
      for (;;) {
        try {
          const p = JSON.parse(
            await readFile(path.join(source, "package.json"), "utf8"),
          );
          if (p.name === name) break;
        } catch {
          /* Continue searching installed package roots. */
        }
        const parent = path.dirname(source);
        if (parent === source) throw Error("Cannot locate dependency");
        source = parent;
      }
      const p = JSON.parse(
        await readFile(path.join(source, "package.json"), "utf8"),
      );
      if (seen.has(name)) {
        if (seen.get(name) !== p.version)
          throw Error("Conflicting dependency versions");
        return;
      }
      seen.set(name, p.version);
      const target = path.join(stage, "node_modules", name);
      if (["@keyman-mvp/core", "@passman/protocol"].includes(name)) {
        await mkdir(target, { recursive: true });
        await cp(
          path.join(source, "package.json"),
          path.join(target, "package.json"),
        );
        await cp(path.join(source, "dist"), path.join(target, "dist"), {
          recursive: true,
        });
        await cp(path.join(root, "LICENSE"), path.join(target, "LICENSE"));
      } else
        await cp(source, target, {
          recursive: true,
          dereference: true,
          filter: (file) =>
            !file
              .split(path.sep)
              .slice(source.split(path.sep).length)
              .includes("node_modules"),
        });
      notices.push(
        `${name}@${p.version}: ${p.license ?? "see package license"}`,
      );
      for (const dependency of Object.keys(p.dependencies ?? {}))
        await include(dependency, source);
    }
    for (const name of Object.keys(client.dependencies))
      await include(name, path.join(root, "packages", packageDirectory));
    await writeFile(
      path.join(stage, "package.json"),
      JSON.stringify(metadata, null, 2) + "\n",
    );
    await writeFile(
      path.join(stage, "README.md"),
      packageDirectory === "passman"
        ? "# Passman fresh SDK/CLI\n\nPassman 1.0 alpha uses separate local custody and /api/passman/v1. Run `passman-v1 login`, then `passman-v1 init`. SDK: import { connect } from '@passman/sdk'; const value = await (await connect()).getSecret({ project: 'demo', name: 'TOKEN' }); See https://github.com/07rjain/passman/blob/main/docs/fresh-quickstart.md for native storage prerequisites, setup and key synchronization. Synthetic values only until your platform is verified.\n"
        : "# Passman CLI and SDK\n\nExperimental encrypted secret client. Documentation: https://passman.subdomain.wtf\n\nRun `passman login`, then `passman put --project testing --name TEST_KEY`. SDK exports include KeymanClient and unlockIdentity. Private decryption keys stay local. No recovery is provided.\n",
    );
    await cp(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
    await writeFile(
      path.join(stage, "THIRD_PARTY.md"),
      notices.join("\n") +
        "\n\nDependency license files are retained in node_modules.\n",
    );
    await mkdir(output, { recursive: true });
    const packed = JSON.parse(
      execFileSync(
        process.execPath,
        [
          process.env.npm_execpath,
          "pack",
          "--json",
          "--ignore-scripts",
          "--pack-destination",
          output,
        ],
        { cwd: stage, encoding: "utf8" },
      ),
    )[0];
    const filename = `passman-${client.version}.tgz`;
    await cp(path.join(output, packed.filename), path.join(output, filename));
    await rm(path.join(output, packed.filename));
    const checksum = createHash("sha256")
      .update(await readFile(path.join(output, filename)))
      .digest("hex");
    await writeFile(
      path.join(output, filename + ".sha256"),
      `${checksum}  ${filename}\n`,
    );
    await writeFile(path.join(output, "latest.txt"), client.version + "\n");
    return { version: client.version, filename, checksum, output };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildDistribution(process.argv[2])));
