import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

/** Lower-privileged users must not be able to rename any component we reuse. */
async function parents(location: string) {
  const absolute = path.resolve(location);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) {
      // macOS /var and /tmp are administrator-owned aliases. User aliases fail closed.
      if (info.uid !== 0) throw new Error("Unsafe path");
      continue;
    }
    if (
      !info.isDirectory() ||
      (info.uid !== 0 && info.uid !== process.getuid?.()) ||
      ((info.mode & 0o022) !== 0 && !(info.uid === 0 && info.mode & 0o1000))
    )
      throw new Error("Unsafe path");
  }
}

export async function posixPrivateDirectory(location: string, create = false) {
  await parents(location);
  if (create) await mkdir(location, { recursive: true, mode: 0o700 });
  const canonical = await realpath(location);
  await parents(canonical);
  const info = await lstat(canonical);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    info.mode & 0o077
  )
    throw new Error("Unsafe directory");
  return canonical;
}
