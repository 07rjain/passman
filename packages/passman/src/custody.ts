import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readlink,
  rename,
  unlink,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  canonicalOrigin,
  failure,
  id,
  PassmanError,
  sameAnchor,
  validateAdministration,
  validateRuntime,
  type AdminMaterial,
  type Anchor,
  type RuntimeMaterial,
} from "@passman/protocol";

const maxCustodyBytes = 100_000;
type Selection = Pick<Anchor, "origin" | "accountId">;
export type CustodyProfile =
  | "runtime"
  | "admin"
  | "setup"
  | "rotation"
  | "writer-replacement"
  | "credential"
  | "credential-index"
  | "admin-credential"
  | "management-credential"
  | "transfer";
export type VaultSelection = Selection;
const validProfiles = new Set<CustodyProfile>([
  "runtime",
  "admin",
  "setup",
  "rotation",
  "writer-replacement",
  "credential",
  "credential-index",
  "admin-credential",
  "management-credential",
  "transfer",
]);

export interface RuntimeCustody {
  loadRuntime(selection: VaultSelection): Promise<unknown>;
  saveRuntime?(material: RuntimeMaterial): Promise<void>;
  replaceRuntime?(
    previous: RuntimeMaterial,
    replacement: RuntimeMaterial,
  ): Promise<void>;
}

export interface AdminCustody {
  loadAdmin(selection: VaultSelection): Promise<unknown>;
  saveAdmin?(material: AdminMaterial): Promise<void>;
  replaceAdmin?(
    previous: AdminMaterial,
    replacement: AdminMaterial,
  ): Promise<void>;
}

export function checkSelection(anchor: Anchor, selection: Selection): void {
  if (
    anchor.origin !== selection.origin ||
    anchor.accountId !== selection.accountId
  )
    failure("CONTEXT_MISMATCH");
}

export function storageError(error: unknown): never {
  if (error instanceof PassmanError) throw error;
  return failure("STORAGE_UNAVAILABLE");
}

function missing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function requireUnixUid(): number {
  if (process.platform !== "linux" && process.platform !== "darwin")
    return failure("STORAGE_UNAVAILABLE");
  if (!process.getuid) return failure("STORAGE_UNAVAILABLE");
  return process.getuid();
}

async function checkAncestors(path: string, uid: number): Promise<void> {
  const root = parse(path).root;
  let current = root;
  for (const name of ["", ...relative(root, path).split(sep)]) {
    current = join(current, name);
    const info = await lstat(current);
    if (
      process.platform === "darwin" &&
      info.isSymbolicLink() &&
      info.uid === 0 &&
      (current === "/tmp" || current === "/var")
    ) {
      const target = resolve(dirname(current), await readlink(current));
      if (
        systemMountLinks.get(current) !== target ||
        !filesMatch(info, await lstat(current))
      )
        return failure("STORAGE_UNAVAILABLE");
      await checkAncestors(target, uid);
      current = target;
      continue;
    }
    if (!protectedDirectory(info, uid)) {
      failure("STORAGE_UNAVAILABLE");
    }
  }
}

function filesMatch(first: Stats, second: Stats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function protectedDirectory(info: Stats, uid: number): boolean {
  return (
    info.isDirectory() &&
    (info.uid === uid || info.uid === 0) &&
    ((info.mode & 0o022) === 0 ||
      (info.uid === 0 && (info.mode & 0o1000) !== 0))
  );
}

const systemMountLinks = new Map([
  ["/var", "/private/var"],
  ["/tmp", "/private/tmp"],
  ["/var/run", "/run"],
]);

async function resolveProtectedMount(
  path: string,
  uid: number,
): Promise<string> {
  const root = parse(path).root;
  let parent = root;
  let remaining = relative(root, path).split(sep);
  let links = 0;
  while (remaining.length) {
    const next = join(parent, remaining.shift()!);
    const entry = await lstat(next);
    if (entry.isSymbolicLink()) {
      if (entry.uid !== 0 || ++links > 8) return failure("STORAGE_UNAVAILABLE");
      const value = await readlink(next);
      const target = resolve(parent, value);
      const belowParent = relative(parent, target);
      if (
        systemMountLinks.get(next) !== target &&
        (isAbsolute(value) ||
          !belowParent ||
          belowParent === ".." ||
          belowParent.startsWith(`..${sep}`))
      )
        return failure("STORAGE_UNAVAILABLE");
      if (!filesMatch(entry, await lstat(next)))
        return failure("STORAGE_UNAVAILABLE");
      remaining = [...relative(root, target).split(sep), ...remaining];
      parent = root;
      continue;
    }
    if (remaining.length && !protectedDirectory(entry, uid))
      return failure("STORAGE_UNAVAILABLE");
    parent = next;
  }
  return parent;
}

async function readProtected(
  path: string,
  validate: (info: Stats) => boolean,
  maximumLinks = 1,
): Promise<unknown> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.nlink < 1 ||
      info.nlink > maximumLinks ||
      !validate(info) ||
      info.size > maxCustodyBytes ||
      !filesMatch(info, await lstat(path))
    )
      return failure("STORAGE_UNAVAILABLE");
    const buffer = Buffer.alloc(info.size + 1);
    try {
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          total,
          buffer.length - total,
          total,
        );
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total !== info.size) return failure("STORAGE_UNAVAILABLE");
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, total),
        ),
      ) as unknown;
    } finally {
      buffer.fill(0);
    }
  } finally {
    await handle.close();
  }
}

function locationKey(selection: Selection): string {
  if (!id.safeParse(selection.accountId).success)
    return failure("INVALID_REQUEST");
  return createHash("sha256")
    .update(
      JSON.stringify([canonicalOrigin(selection.origin), selection.accountId]),
    )
    .digest("hex");
}

export function checkUpdate(
  current: RuntimeMaterial | undefined,
  runtime: RuntimeMaterial,
): boolean {
  if (!current) return true;
  if (
    !sameAnchor(current.anchor, runtime.anchor) ||
    current.installationId !== runtime.installationId ||
    runtime.epoch < current.epoch ||
    (runtime.epoch === current.epoch && runtime.syncId !== current.syncId)
  ) {
    return failure("CONTEXT_MISMATCH");
  }
  if (runtime.generation < current.generation) return failure("CONFLICT");
  if (runtime.generation === current.generation) {
    if (JSON.stringify(runtime) !== JSON.stringify(current))
      return failure("CONFLICT");
    return false;
  }
  return true;
}

export function checkRuntimeReplacement(
  persisted: RuntimeMaterial | undefined,
  previous: RuntimeMaterial,
  replacement: RuntimeMaterial,
): boolean {
  if (
    !persisted ||
    previous.anchor.origin !== replacement.anchor.origin ||
    previous.anchor.accountId !== replacement.anchor.accountId ||
    previous.anchor.vaultId !== replacement.anchor.vaultId ||
    previous.installationId !== replacement.installationId ||
    sameAnchor(previous.anchor, replacement.anchor) ||
    previous.syncId === replacement.syncId ||
    replacement.epoch <= previous.epoch ||
    replacement.generation <= previous.generation
  )
    return failure("CONTEXT_MISMATCH");
  if (JSON.stringify(persisted) === JSON.stringify(replacement)) return false;
  if (JSON.stringify(persisted) !== JSON.stringify(previous))
    return failure("CONFLICT");
  return true;
}

export function checkAdminReplacement(
  persisted: AdminMaterial | undefined,
  previous: AdminMaterial,
  replacement: AdminMaterial,
): boolean {
  if (
    replacement.runtime.generation !== previous.runtime.generation + 1 ||
    replacement.runtime.epoch !== previous.runtime.epoch + 1
  )
    return failure("CONTEXT_MISMATCH");
  return checkRuntimeReplacement(
    persisted?.runtime,
    previous.runtime,
    replacement.runtime,
  );
}

function profileName(profile: CustodyProfile, selection: Selection): string {
  if (!validProfiles.has(profile)) return failure("INVALID_REQUEST");
  return `${profile}-${locationKey(selection)}.json`;
}

async function acquireLock(path: string): Promise<void> {
  const candidate = join(dirname(path), `.lock-${randomUUID()}`);
  const handle = await open(
    candidate,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.sync();
    } finally {
      await handle.close();
    }
    const deadline = performance.now() + 3000;
    while (true) {
      try {
        await link(candidate, path);
        return;
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "EEXIST" ||
          performance.now() >= deadline
        )
          throw error;
        await delay(50);
      }
    }
  } finally {
    await unlink(candidate);
  }
}

export class UnixFileStore {
  readonly #location: string;

  constructor(location: string) {
    if (!isAbsolute(location) || location === parse(location).root)
      failure("INVALID_REQUEST");
    this.#location = resolve(location);
  }

  async #directory(create: boolean): Promise<Stats | undefined> {
    const uid = requireUnixUid();
    await checkAncestors(dirname(this.#location), uid);
    if (create) {
      await mkdir(this.#location, { mode: 0o700 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
    }
    const directory = await lstat(this.#location).catch((error: unknown) => {
      if (!missing(error)) throw error;
      return undefined;
    });
    if (
      directory &&
      (!directory.isDirectory() ||
        directory.uid !== uid ||
        (directory.mode & 0o077) !== 0)
    ) {
      return failure("STORAGE_UNAVAILABLE");
    }
    return directory;
  }

  async read(profile: CustodyProfile, selection: Selection): Promise<unknown> {
    const fileName = profileName(profile, selection);
    try {
      if (!(await this.#directory(false))) return undefined;
      const uid = requireUnixUid();
      return await readProtected(
        join(this.#location, fileName),
        (info) => info.uid === uid && (info.mode & 0o177) === 0,
      );
    } catch (error) {
      if (missing(error)) return undefined;
      return storageError(error);
    }
  }

  async write(
    profile: CustodyProfile,
    selection: Selection,
    value: unknown,
    accept: (current: unknown) => boolean | Promise<boolean>,
  ): Promise<void> {
    const fileName = profileName(profile, selection);
    const pathname = join(this.#location, fileName);
    const lockPath = `${pathname}.lock`;
    const tempPath = join(this.#location, `.write-${randomUUID()}`);
    try {
      const directory = await this.#directory(true);
      if (!directory) return failure("STORAGE_UNAVAILABLE");
      const folder = await open(
        this.#location,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        if (!filesMatch(directory, await folder.stat()))
          return failure("STORAGE_UNAVAILABLE");
        await acquireLock(lockPath);
        try {
          const current = await this.read(profile, selection);
          if (!(await accept(current))) return;
          if (value === undefined) {
            if (current !== undefined) await unlink(pathname);
            await folder.sync();
            return;
          }
          const serialized = JSON.stringify(value);
          if (
            serialized === undefined ||
            Buffer.byteLength(serialized) > maxCustodyBytes
          )
            return failure("STORAGE_UNAVAILABLE");
          const file = await open(
            tempPath,
            constants.O_CREAT |
              constants.O_EXCL |
              constants.O_WRONLY |
              constants.O_NOFOLLOW,
            0o600,
          );
          let committed = false;
          try {
            await file.writeFile(serialized, "utf8");
            await file.sync();
            if (!filesMatch(directory, await lstat(this.#location)))
              return failure("STORAGE_UNAVAILABLE");
            await rename(tempPath, pathname);
            committed = true;
            await folder.sync();
          } finally {
            await file.close();
            if (!committed) await unlink(tempPath);
          }
        } finally {
          await unlink(lockPath);
        }
      } finally {
        await folder.close();
      }
    } catch (error) {
      return storageError(error);
    }
  }

  // Invoke only after stopping the processes that use this store.
  async recoverLock(
    profile: CustodyProfile,
    selection: Selection,
  ): Promise<boolean> {
    const lock = join(
      this.#location,
      `${profileName(profile, selection)}.lock`,
    );
    try {
      if (!(await this.#directory(false))) return false;
      const uid = requireUnixUid();
      const before = await lstat(lock);
      const owner = await readProtected(
        lock,
        (info) => info.uid === uid && (info.mode & 0o177) === 0,
        2,
      );
      if (
        !owner ||
        typeof owner !== "object" ||
        !("pid" in owner) ||
        typeof owner.pid !== "number" ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid < 1
      )
        return failure("STORAGE_UNAVAILABLE");
      try {
        process.kill(owner.pid, 0);
        return failure("CONFLICT");
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "ESRCH"
        )
          throw error;
      }
      if (!filesMatch(before, await lstat(lock))) return failure("CONFLICT");
      await unlink(lock);
      return true;
    } catch (error) {
      if (missing(error)) return false;
      return storageError(error);
    }
  }

  async remove(profile: CustodyProfile, selection: Selection): Promise<void> {
    await this.write(
      profile,
      selection,
      undefined,
      (current) => current !== undefined,
    );
  }
}

export class UnixRuntimeCustody implements RuntimeCustody {
  readonly #store: UnixFileStore;

  constructor(location: string) {
    this.#store = new UnixFileStore(location);
  }

  async loadRuntime(
    selection: Selection,
  ): Promise<RuntimeMaterial | undefined> {
    const input = await this.#store.read("runtime", selection);
    if (input === undefined) return undefined;
    const runtime = await validateRuntime(input);
    checkSelection(runtime.anchor, selection);
    return runtime;
  }

  async saveRuntime(input: RuntimeMaterial): Promise<void> {
    const runtime = await validateRuntime(input);
    await this.#store.write(
      "runtime",
      runtime.anchor,
      runtime,
      async (current) =>
        checkUpdate(
          current === undefined ? undefined : await validateRuntime(current),
          runtime,
        ),
    );
  }

  async replaceRuntime(
    old: RuntimeMaterial,
    next: RuntimeMaterial,
  ): Promise<void> {
    const previous = await validateRuntime(old);
    const replacement = await validateRuntime(next);
    await this.#store.write(
      "runtime",
      previous.anchor,
      replacement,
      async (value) =>
        checkRuntimeReplacement(
          value === undefined ? undefined : await validateRuntime(value),
          previous,
          replacement,
        ),
    );
  }
}

export class UnixAdminCustody implements AdminCustody {
  readonly #store: UnixFileStore;

  constructor(location: string) {
    this.#store = new UnixFileStore(location);
  }

  async loadAdmin(selection: Selection): Promise<AdminMaterial | undefined> {
    const input = await this.#store.read("admin", selection);
    if (input === undefined) return undefined;
    const admin = await validateAdministration(input);
    checkSelection(admin.runtime.anchor, selection);
    return admin;
  }

  async saveAdmin(input: AdminMaterial): Promise<void> {
    const admin = await validateAdministration(input);
    await this.#store.write(
      "admin",
      admin.runtime.anchor,
      admin,
      async (current) =>
        checkUpdate(
          current === undefined
            ? undefined
            : (await validateAdministration(current)).runtime,
          admin.runtime,
        ),
    );
  }

  async replaceAdmin(old: AdminMaterial, next: AdminMaterial): Promise<void> {
    const previous = await validateAdministration(old);
    const replacement = await validateAdministration(next);
    await this.#store.write(
      "admin",
      previous.runtime.anchor,
      replacement,
      async (value) =>
        checkAdminReplacement(
          value === undefined ? undefined : await validateAdministration(value),
          previous,
          replacement,
        ),
    );
  }
}

export function environmentRuntimeCustody(
  variable: string,
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeCustody {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(variable)) return failure("INVALID_REQUEST");
  return {
    async loadRuntime(selection) {
      const input = environment[variable];
      if (input === undefined) return undefined;
      try {
        if (Buffer.byteLength(input, "utf8") > maxCustodyBytes)
          return failure("STORAGE_UNAVAILABLE");
        const runtime = await validateRuntime(JSON.parse(input) as unknown);
        checkSelection(runtime.anchor, selection);
        return runtime;
      } catch (error) {
        return storageError(error);
      }
    },
  };
}

export function mountedRuntimeCustody(location: string): RuntimeCustody {
  if (!isAbsolute(location)) return failure("INVALID_REQUEST");
  const path = resolve(location);
  return {
    async loadRuntime(selection) {
      try {
        const uid = requireUnixUid();
        const resolved = await resolveProtectedMount(path, uid);
        const input = await readProtected(
          resolved,
          (info) =>
            (info.uid === 0 || info.uid === uid) && (info.mode & 0o137) === 0,
        );
        const runtime = await validateRuntime(input);
        checkSelection(runtime.anchor, selection);
        return runtime;
      } catch (error) {
        return storageError(error);
      }
    },
  };
}
