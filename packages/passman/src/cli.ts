#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { stdin, stdout, stderr } from "node:process";
import { parseArgs } from "node:util";
import {
  adminSchema,
  adminScopeSchema,
  bytes32,
  canonicalOrigin,
  failure,
  id,
  inspectRuntimePackage,
  openValue,
  parseCredential,
  PassmanError,
  refreshRuntime,
  sameAnchor,
  sealValue,
  unb64,
  validateRuntime,
  z,
  type RuntimeMaterial,
} from "@passman/protocol";
import {
  AdminClient,
  ManagementClient,
  preparedInitializationSchema,
  preparedRotationSchema,
  restoreRuntime,
} from "./admin.js";
import {
  installReplacementRuntime,
  prepareWriterReplacement,
  preparedWriterReplacementSchema,
  WriterReplacementClient,
} from "./writer-replacement.js";
import {
  environmentRuntimeCustody,
  mountedRuntimeCustody,
  UnixAdminCustody,
  UnixFileStore,
  UnixRuntimeCustody,
  type CustodyProfile,
  type VaultSelection,
} from "./custody.js";
import {
  NativeAdminCustody,
  NativeRuntimeCustody,
  NativeStore,
} from "./native-custody.js";
import { RuntimeClient } from "./runtime.js";
import { login } from "./login.js";
import {
  cancelTransfer,
  createTransfer,
  FileTransferSessions,
  receiveTransfer,
} from "./transfers.js";
import {
  credentialIndexId,
  forgetServiceKey,
  resolveServiceKey,
  saveServiceKey,
} from "./connect.js";

const help = `Usage: passman-v1 <command> [options]

  login                         Sign in through the management website
  init                         Create a vault and save native administration locally
  admin restore                Restore administration and enroll this installation
  service-key save             Validate and save a service key with hidden input
  service-key create           Issue a read service key and display it once
  admin issue                  Issue an expiring, operation-scoped credential
  credential revoke           Revoke the credential identified by --credential-id
  vault unlock                 Restore runtime custody with the vault password
  vault sync                   Refresh provisioned runtime custody
  vault export-runtime         Write runtime-only material to a protected secret pipeline
  vault password change        Rewrap runtime and administrative restoration packages
  vault password reset         Verify a local OS operator and rewrap both packages
  vault rotate                 Rotate the encryption key version
  vault rotate cancel          Discard a staged rotation after a different change commits
  vault writer replace         Replace compromised writer authority and re-encrypt records
  vault writer cancel          Cancel a staged writer replacement before cutover
  vault writer pin             Re-provision this runtime with a trusted --writer-key
  vault remove-local           Remove stored custody and credentials for --account
  vault transfer create        Deliberately write a private, expiring transfer code
  vault transfer receive       Redeem a transfer code with this installation's service key
  vault transfer cancel        Cancel a transfer by its public --transfer-id
  vault transfer forget        Clear this receiver's local session by --transfer-id
  custody recover-lock         Clear a dead POSIX writer lock after stopping all store users
  project create --project    Create a project with native administration
  projects                     List authorized projects
  list --project               List names and states in a project
  status                       Show authorization and local custody readiness
  get --project --name         Deliberately write the exact plaintext to stdout
  put --project --name         Create a secret using a private input
  update --project --name      Update an activated secret
  pending verify --project --name
                               Activate a pending value by entering its exact value
  pending reject --project --name
                               Reject a pending value by writing a signed tombstone
  delete --project --name      Write a signed tombstone
  recreate --project --name    Deliberately reuse a tombstoned name

  --origin URL                 Service origin, or PASSMAN_ORIGIN
  --account UUID               Select a stored service or admin credential
  --file-mode                  Use explicit owner-only Unix files instead of native storage
  --store-dir PATH             Absolute path for --file-mode (default ~/.passman-v1)
  --mount PATH                 Load runtime material from a protected secret mount
  --vault-env VARIABLE         Load runtime material from an explicitly chosen environment variable
  --management                 Authenticate runtime bootstrap through management
  --replacement                Replace sync authority as well as the encryption key
  --profile NAME               Owner-only file profile for custody recover-lock
  --transfer-id UUID           Public identifier of a transfer to cancel
  --writer-key PUBLIC_KEY      Trusted Ed25519 public key from an independent channel
  --no-browser                 Print the login URL without opening the browser
  --credential-id UUID         Identifier of a credential to revoke
  --label TEXT                 Label for an issued credential
  --all-projects               Explicitly issue access to all projects
  --project-id UUID            Project to authorize (repeat to add projects)
  --expires-at TIMESTAMP       Credential expiry in ISO-8601 UTC
  --non-expiring               Deliberately issue a read key without expiry
  --bootstrap                  Allow an issued read key to download runtime bootstrap
  --operations CSV             Operations for an issued native credential
  --default                    Make a saved service key's account the default
  --stdin                      Read an input value or vault password from private stdin

Private environment configuration can supply PASSMAN_SERVICE_KEY, PASSMAN_ADMIN_KEY,
and PASSMAN_MANAGEMENT_TOKEN. Passwords use hidden terminal input. Protect any
intentional plaintext or runtime export written to stdout.
`;

function output(value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function exactStdin(): Promise<string> {
  const fatalUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let bytes = 0;
  let secret = "";
  try {
    for await (const input of stdin) {
      if (!Buffer.isBuffer(input)) return failure("INVALID_REQUEST");
      bytes += input.length;
      if (bytes > 65_536) return failure("INVALID_REQUEST");
      secret += fatalUtf8.decode(input, { stream: true });
      input.fill(0);
    }
    return secret + fatalUtf8.decode();
  } catch (error) {
    if (error instanceof PassmanError) throw error;
    return failure("INVALID_REQUEST");
  }
}

function hidden(prompt: string, limit = 1_024): Promise<string> {
  if (!stdin.isTTY || !stdin.setRawMode || !stderr.isTTY)
    return failure("INVALID_REQUEST");
  const entered: number[] = [];
  stderr.write(prompt);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    function cleanup() {
      stdin.off("data", receive);
      stdin.off("end", cancel);
      stdin.off("error", cancel);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      entered.fill(0);
      stderr.write("\n");
    }
    function cancel() {
      cleanup();
      reject(new PassmanError("INVALID_REQUEST"));
    }
    function receive(chunk: Buffer) {
      for (const byte of chunk) {
        if (byte === 3 || byte === 4) return cancel();
        if (byte === 13 || byte === 10) {
          const input = Buffer.from(entered);
          try {
            const value = new TextDecoder("utf-8", {
              fatal: true,
              ignoreBOM: true,
            }).decode(input);
            cleanup();
            resolve(value);
          } catch {
            cancel();
          } finally {
            input.fill(0);
            chunk.fill(0);
          }
          return;
        }
        if (byte === 127 || byte === 8) {
          while (entered.length && (entered.pop()! & 0xc0) === 0x80) continue;
        } else if (entered.length < limit) {
          entered.push(byte);
        } else {
          return cancel();
        }
      }
      chunk.fill(0);
    }
    stdin.on("data", receive);
    stdin.once("end", cancel);
    stdin.once("error", cancel);
  });
}

async function newPassword(): Promise<string> {
  const password = await hidden("New vault password: ");
  if (password !== (await hidden("Confirm vault password: ")))
    return failure("PASSWORD_INVALID");
  return password;
}

async function privateNewPassword(
  fromStdin: boolean | undefined,
): Promise<string> {
  return fromStdin ? exactStdin() : newPassword();
}

async function localRoundTrip(runtime: RuntimeMaterial): Promise<void> {
  const active = runtime.keys.find((key) => key.id === runtime.activeKeyId);
  if (!active) return failure("INTEGRITY_FAILED");
  const sample = randomUUID();
  const context = {
    version: 1 as const,
    origin: runtime.anchor.origin,
    accountId: runtime.anchor.accountId,
    vaultId: runtime.anchor.vaultId,
    projectId: randomUUID(),
    project: "setup-check",
    name: "CHECK",
    secretId: randomUUID(),
    keyId: active.id,
    epoch: runtime.epoch,
    revision: 1,
    state: "active" as const,
  };
  const envelope = await sealValue(sample, active.publicKey, context);
  if ((await openValue(envelope, active.privateKey, context)) !== sample)
    failure("INTEGRITY_FAILED");
}

async function verifyUnixOperator(): Promise<void> {
  if (
    !stdin.isTTY ||
    !process.getuid ||
    process.getuid() === 0 ||
    (process.platform !== "linux" && process.platform !== "darwin")
  )
    return failure("FORBIDDEN");
  const sudo = (args: string[], interactive = false) =>
    new Promise<number | null>((resolve, reject) => {
      const child = spawn("/usr/bin/sudo", args, {
        stdio: interactive ? "inherit" : "ignore",
        timeout: interactive ? 60_000 : 10_000,
      });
      child.on("error", () => reject(new PassmanError("FORBIDDEN")));
      child.on("close", resolve);
    });
  if ((await sudo(["-k", "-n", "-v"])) !== 1) return failure("FORBIDDEN");
  const verified = await sudo(["-k", "-v"], true).catch(() => null);
  const cleared = await sudo(["-k"]).catch(() => null);
  if (verified !== 0 || cleared !== 0) return failure("FORBIDDEN");
}

async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32.exe"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.once("error", () => resolve());
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

const stagedWriterSchema = z
  .object({
    previous: adminSchema,
    adminKey: z.string().min(1).max(200),
    uploaded: z.boolean(),
    replacement: preparedWriterReplacementSchema,
  })
  .strict();

const managementSessionSchema = z
  .object({
    managementToken: z.string().min(1).max(10_000),
    expiresAt: z.number().int().positive(),
    operatorId: bytes32,
  })
  .strict();

function stage<Output>(
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: Output } | { success: false };
  },
  value: unknown,
): Output | undefined {
  if (
    value === undefined ||
    (typeof value === "object" &&
      value !== null &&
      "complete" in value &&
      value.complete === true)
  )
    return undefined;
  const parsed = schema.safeParse(value);
  if (!parsed.success) return failure("STORAGE_UNAVAILABLE");
  return parsed.data;
}

function operatorSelection(
  origin: string,
  operatorId: string | undefined,
): VaultSelection {
  if (!operatorId) return failure("INTEGRITY_FAILED");
  const identifier = Buffer.from(unb64(operatorId, 32).slice(0, 16)).toString(
    "hex",
  );
  return {
    origin,
    accountId: `${identifier.slice(0, 8)}-${identifier.slice(8, 12)}-4${identifier.slice(13, 16)}-8${identifier.slice(17, 20)}-${identifier.slice(20)}`,
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      origin: { type: "string" },
      account: { type: "string" },
      project: { type: "string" },
      name: { type: "string" },
      "file-mode": { type: "boolean" },
      "store-dir": { type: "string" },
      mount: { type: "string" },
      "vault-env": { type: "string" },
      stdin: { type: "boolean" },
      management: { type: "boolean" },
      replacement: { type: "boolean" },
      profile: { type: "string" },
      "transfer-id": { type: "string" },
      "writer-key": { type: "string" },
      browser: { type: "boolean", default: true },
      "credential-id": { type: "string" },
      label: { type: "string" },
      "all-projects": { type: "boolean" },
      "project-id": { type: "string", multiple: true },
      "expires-at": { type: "string" },
      "non-expiring": { type: "boolean" },
      bootstrap: { type: "boolean" },
      operations: { type: "string" },
      default: { type: "boolean" },
    },
  });
  if (values.version) {
    const metadata = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    stdout.write(metadata.version + "\n");
    return;
  }
  const command = positionals.join(" ");
  if (!command || values.help) {
    stdout.write(help);
    return;
  }
  const origin = canonicalOrigin(
    values.origin ?? process.env.PASSMAN_ORIGIN ?? "",
  );
  if (values.account !== undefined && !id.safeParse(values.account).success)
    return failure("INVALID_REQUEST");
  if (
    (values["store-dir"] && !values["file-mode"]) ||
    (values.mount && values["vault-env"])
  )
    return failure("INVALID_REQUEST");
  const directory = values["store-dir"] ?? join(homedir(), ".passman-v1");
  const store = values["file-mode"]
    ? new UnixFileStore(directory)
    : new NativeStore();
  const runtimeCustody = values.mount
    ? mountedRuntimeCustody(values.mount)
    : values["vault-env"]
      ? environmentRuntimeCustody(values["vault-env"])
      : values["file-mode"]
        ? new UnixRuntimeCustody(directory)
        : new NativeRuntimeCustody();
  const adminCustody = values["file-mode"]
    ? new UnixAdminCustody(directory)
    : new NativeAdminCustody();
  const installation = {
    label:
      Array.from(hostname())
        .filter((character) => character >= " " && character !== "\x7f")
        .join("")
        .slice(0, 80) || "Passman",
    kind: "desktop" as const,
  };
  const details = () => ({
    label: installation.label,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  const managementSelection = {
    origin,
    accountId: "00000000-0000-0000-0000-000000000000",
  };
  async function managementToken() {
    const configured = process.env.PASSMAN_MANAGEMENT_TOKEN;
    if (configured !== undefined) return configured || failure("UNAUTHORIZED");
    const input = await store.read(
      "management-credential",
      managementSelection,
    );
    if (input === undefined) return failure("PROFILE_REQUIRED");
    const session = managementSessionSchema.safeParse(input);
    if (!session.success) return failure("STORAGE_UNAVAILABLE");
    if (session.data.expiresAt <= Date.now())
      return failure("CREDENTIAL_EXPIRED");
    return session.data.managementToken;
  }
  const management = async () =>
    new ManagementClient({
      origin,
      managementToken: await managementToken(),
      accountId: values.account,
    });

  function selection(key: string, kind: "read" | "admin"): VaultSelection {
    const { accountId } = parseCredential(key, kind);
    if (values.account && values.account !== accountId)
      return failure("CONTEXT_MISMATCH");
    return { origin, accountId };
  }

  async function key(kind: "read" | "admin"): Promise<string> {
    if (kind === "read")
      return resolveServiceKey({
        origin,
        accountId: values.account,
        credentialStore: store,
      });
    const configured = process.env.PASSMAN_ADMIN_KEY;
    if (configured !== undefined) {
      selection(configured, kind);
      return configured;
    }
    if (!values.account) return failure("PROFILE_REQUIRED");
    const stored = await store.read("admin-credential", {
      origin,
      accountId: values.account,
    });
    if (typeof stored !== "string") return failure("PROFILE_REQUIRED");
    selection(stored, kind);
    return stored;
  }

  async function reader() {
    return new RuntimeClient({
      origin,
      serviceKey: await key("read"),
      custody: runtimeCustody,
      installation,
    });
  }
  async function administrator() {
    return new AdminClient({
      origin,
      adminKey: await key("admin"),
      custody: adminCustody,
    });
  }
  function address() {
    if (!values.project || !values.name) return failure("INVALID_REQUEST");
    return { project: values.project, name: values.name };
  }
  async function readValue() {
    return values.stdin ? exactStdin() : hidden("Secret value: ", 65_536);
  }

  function credentialScope() {
    const projects = values["project-id"];
    const expiry = values["expires-at"];
    if (
      !values.label ||
      Boolean(values["all-projects"]) === Boolean(projects?.length) ||
      Boolean(values["non-expiring"]) === Boolean(expiry)
    )
      return failure("INVALID_REQUEST");
    if (expiry && !z.iso.datetime().safeParse(expiry).success)
      return failure("INVALID_REQUEST");
    return {
      label: values.label,
      projects: values["all-projects"] ? null : projects!,
      expiresAt: expiry ? Date.parse(expiry) : null,
    };
  }

  if (command === "login") {
    if (!stderr.isTTY) return failure("INVALID_REQUEST");
    const session = await login({
      origin,
      openBrowser: values.browser ? openBrowser : undefined,
      onVisit({ url, fingerprint }) {
        stderr.write(
          `Open ${url}\nEnter this connection code in the browser: ${fingerprint}\n`,
        );
      },
    });
    await store.write(
      "management-credential",
      managementSelection,
      session,
      () => true,
    );
    output({
      expiresAt: new Date(session.expiresAt).toISOString(),
      signedIn: true,
    });
  } else if (command === "init") {
    const client = await management();
    const { account, operatorId } = await client.identity();
    const setup = operatorSelection(origin, operatorId);
    let staged = stage(
      preparedInitializationSchema,
      await store.read("setup", setup),
    );
    if (
      account &&
      (!staged || !sameAnchor(account.anchor, staged.bundle.anchor))
    )
      return failure("VAULT_ALREADY_EXISTS");
    if (!staged) {
      staged = await client.prepareInitialization(
        await privateNewPassword(values.stdin),
        details(),
      );
      await store.write("setup", setup, staged, (existing) => {
        if (stage(preparedInitializationSchema, existing)) failure("CONFLICT");
        return true;
      });
    }
    if (!account) await client.initialize(staged);
    const anchor = staged.bundle.anchor;
    await adminCustody.saveAdmin(staged.admin);
    if (runtimeCustody.saveRuntime)
      await runtimeCustody.saveRuntime(staged.admin.runtime);
    const persisted = await adminCustody.loadAdmin(anchor);
    if (!persisted) return failure("STORAGE_UNAVAILABLE");
    await localRoundTrip(persisted.runtime);
    await new AdminClient({
      origin,
      adminKey: staged.adminKey,
      custody: adminCustody,
    }).status();
    await store.write("admin-credential", anchor, staged.adminKey, () => true);
    await store.write(
      "setup",
      setup,
      { complete: true },
      (existing) =>
        stage(preparedInitializationSchema, existing)?.adminKey ===
        staged.adminKey,
    );
    output({ accountId: anchor.accountId, initialized: true });
  } else if (command === "service-key save") {
    const serviceKey = values.stdin
      ? await exactStdin()
      : await hidden("Service key: ");
    const account = selection(serviceKey, "read");
    await saveServiceKey({
      origin,
      serviceKey,
      setDefault: values.default,
      credentialStore: store,
    });
    output({ accountId: account.accountId, saved: true });
  } else if (command === "service-key create") {
    const scope = credentialScope();
    output({
      serviceKey: await (
        await administrator()
      ).issueServiceKey({ ...scope, bootstrap: values.bootstrap }),
    });
  } else if (command === "admin issue") {
    const scope = credentialScope();
    if (scope.expiresAt === null || values.bootstrap)
      return failure("INVALID_REQUEST");
    const operations = adminScopeSchema.shape.operations.safeParse(
      values.operations?.split(","),
    );
    if (!operations.success) return failure("INVALID_REQUEST");
    output({
      adminKey: await (
        await administrator()
      ).issueAdminKey({
        ...scope,
        expiresAt: scope.expiresAt,
        operations: operations.data,
      }),
    });
  } else if (command === "credential revoke") {
    if (
      !values["credential-id"] ||
      !id.safeParse(values["credential-id"]).success
    )
      return failure("INVALID_REQUEST");
    await (await administrator()).revokeCredential(values["credential-id"]);
    output({ revoked: true });
  } else if (command === "admin restore") {
    const client = await management();
    const password = values.stdin
      ? await exactStdin()
      : await hidden("Vault password: ");
    const admin = await client.restoreAdministration(password, adminCustody);
    const adminKey = await client.enroll(admin, details());
    await store.write(
      "admin-credential",
      admin.runtime.anchor,
      adminKey,
      () => true,
    );
    output({ accountId: admin.runtime.anchor.accountId, restored: true });
  } else if (command === "vault unlock") {
    const password = values.stdin
      ? await exactStdin()
      : await hidden("Vault password: ");
    if (values.management) {
      output({
        generation: (
          await (await management()).restoreRuntime(password, runtimeCustody)
        ).generation,
      });
    } else {
      output(await (await reader()).unlock(password));
    }
  } else if (command === "vault sync") {
    output(await (await reader()).sync());
  } else if (command === "vault export-runtime") {
    if (stdout.isTTY) return failure("INVALID_REQUEST");
    const bundle = await (await management()).downloadRuntime();
    const password = values.stdin
      ? await exactStdin()
      : await hidden("Vault password: ");
    output(await restoreRuntime(bundle, password, undefined, bundle.anchor));
  } else if (command === "vault password change") {
    const admin = await administrator();
    const bundle = await (await management()).download();
    await admin.changePassword(
      bundle,
      await hidden("Current vault password: "),
      await newPassword(),
      await managementToken(),
    );
    output({ changed: true });
  } else if (command === "vault password reset") {
    const admin = await administrator();
    const bundle = await (await management()).download();
    await admin.resetPassword(
      bundle,
      await newPassword(),
      await managementToken(),
      verifyUnixOperator,
    );
    output({ changed: true });
  } else if (command === "vault rotate" || command === "vault rotate cancel") {
    const adminKey = await key("admin");
    const selected = selection(adminKey, "admin");
    const admin = new AdminClient({ origin, adminKey, custody: adminCustody });
    let pending = stage(
      preparedRotationSchema,
      await store.read("rotation", selected),
    );
    if (command === "vault rotate cancel") {
      if (!pending) return failure("NOT_FOUND");
      const remote = await (await management()).download();
      if (
        remote.anchor.accountId !== selected.accountId ||
        !sameAnchor(remote.anchor, pending.bundle.anchor)
      )
        return failure("CONTEXT_MISMATCH");
      const signed = await inspectRuntimePackage(
        remote.keyring,
        pending.bundle.anchor,
      );
      if (
        signed.epoch !== remote.epoch ||
        signed.generation !== remote.generation ||
        signed.syncId !== remote.syncId ||
        JSON.stringify(signed.activeKey) !== JSON.stringify(remote.activeKey)
      )
        return failure("CONTEXT_MISMATCH");
      if (
        signed.generation < pending.bundle.generation ||
        remote.keyring === pending.bundle.keyring ||
        (pending.bundle.epoch > pending.fromEpoch &&
          signed.syncId === pending.bundle.syncId)
      )
        return failure("CONFLICT");
      const keyring = pending.bundle.keyring;
      await store.write("rotation", selected, { complete: true }, (current) => {
        if (stage(preparedRotationSchema, current)?.bundle.keyring !== keyring)
          return failure("CONFLICT");
        return true;
      });
      output({ cancelled: true });
      return;
    }
    if (!pending) {
      const bundle = await (await management()).download();
      pending = await admin.prepareRotation(
        bundle,
        values.replacement ? await privateNewPassword(values.stdin) : undefined,
      );
      await store.write("rotation", selected, pending, (existing) => {
        if (stage(preparedRotationSchema, existing)) failure("CONFLICT");
        return true;
      });
    }
    const result = await admin.commitRotation(
      pending,
      pending.bundle.epoch > pending.fromEpoch
        ? await managementToken()
        : undefined,
    );
    await store.write(
      "rotation",
      selected,
      { complete: true },
      (existing) =>
        stage(preparedRotationSchema, existing)?.bundle.keyring ===
        pending.bundle.keyring,
    );
    output(result);
  } else if (
    command === "vault writer replace" ||
    command === "vault writer cancel"
  ) {
    const currentKey = await key("admin");
    const selected = selection(currentKey, "admin");
    let pending = stage(
      stagedWriterSchema,
      await store.read("writer-replacement", selected),
    );
    if (!pending) {
      if (command === "vault writer cancel") return failure("NOT_FOUND");
      await new AdminClient({
        origin,
        adminKey: currentKey,
        custody: adminCustody,
      }).sync();
      const previous = await adminCustody.loadAdmin(selected);
      if (!previous) return failure("VAULT_NOT_PROVISIONED");
      const bundle = await (await management()).download();
      const replacement = await prepareWriterReplacement(
        bundle,
        previous,
        await privateNewPassword(values.stdin),
        details(),
      );
      pending = {
        previous,
        adminKey: currentKey,
        uploaded: false,
        replacement,
      };
      await store.write("writer-replacement", selected, pending, (current) => {
        if (stage(stagedWriterSchema, current)) failure("CONFLICT");
        return true;
      });
    }
    const client = new WriterReplacementClient({
      origin,
      adminKey: pending.adminKey,
      managementToken: await managementToken(),
      source: pending.previous,
      custody: adminCustody,
    });
    const { replacement } = pending;
    const sameStage = (current: unknown) =>
      stage(stagedWriterSchema, current)?.replacement.id === replacement.id;
    if (command === "vault writer cancel") {
      await client.cancel(replacement).catch((error: unknown) => {
        if (
          !(error instanceof PassmanError) ||
          error.code !== "NOT_FOUND" ||
          pending.uploaded
        )
          throw error;
      });
      await store.write(
        "writer-replacement",
        selected,
        { complete: true },
        sameStage,
      );
      output({ cancelled: true });
    } else {
      if (!pending.uploaded) {
        await client.stage(replacement);
        await store.write(
          "writer-replacement",
          selected,
          { ...pending, uploaded: true },
          (current) => {
            if (!sameStage(current)) return failure("CONFLICT");
            return true;
          },
        );
      }
      const result = await client
        .commit(replacement)
        .catch(async (error: unknown) => {
          if (!(error instanceof PassmanError) || error.code !== "CONFLICT")
            throw error;
          // A conflict during local custody replacement can happen after remote cutover.
          // Only reopen staging if the original deadline and writer are still authoritative.
          const remote = await (
            await management()
          )
            .download()
            .catch(() => undefined);
          const previous = pending.previous.runtime;
          if (
            remote &&
            sameAnchor(remote.anchor, previous.anchor) &&
            remote.epoch === previous.epoch &&
            remote.generation === replacement.expectedGeneration &&
            remote.syncId === previous.syncId
          ) {
            const signed = await refreshRuntime(remote.keyring, previous).catch(
              () => undefined,
            );
            if (
              signed?.generation === remote.generation &&
              signed.activeKeyId === remote.activeKey.id
            ) {
              await store.write(
                "writer-replacement",
                selected,
                { ...pending, uploaded: false },
                (current) => {
                  if (!sameStage(current)) return failure("CONFLICT");
                  return true;
                },
              );
            }
          }
          throw error;
        });
      await store.write(
        "admin-credential",
        selected,
        replacement.adminKey,
        () => true,
      );
      await store.write(
        "writer-replacement",
        selected,
        { complete: true },
        sameStage,
      );
      output({
        ...result,
        writerPublicKey: replacement.bundle.anchor.writer.x,
      });
    }
  } else if (command === "vault writer pin") {
    const writer = bytes32.safeParse(values["writer-key"]);
    if (!writer.success) return failure("INVALID_REQUEST");
    unb64(writer.data, 32);
    const client = values.management ? await management() : await reader();
    const bundle =
      client instanceof ManagementClient
        ? await client.downloadRuntime()
        : await client.downloadBootstrap();
    const selected = { origin, accountId: bundle.anchor.accountId };
    const stored = await runtimeCustody.loadRuntime(selected);
    if (!stored) return failure("VAULT_NOT_PROVISIONED");
    const previous = await validateRuntime(stored);
    const trustedAnchor = {
      ...previous.anchor,
      writer: { ...previous.anchor.writer, x: writer.data },
    };
    const password = values.stdin
      ? await exactStdin()
      : await hidden("Vault password: ");
    const runtime = await installReplacementRuntime(
      bundle,
      password,
      previous,
      trustedAnchor,
      runtimeCustody,
    );
    output({ generation: runtime.generation, epoch: runtime.epoch });
  } else if (command === "vault remove-local") {
    if (!values.account) return failure("PROFILE_REQUIRED");
    const selected = { origin, accountId: values.account };
    const operator = values.management
      ? operatorSelection(
          origin,
          (await (await management()).identity()).operatorId,
        )
      : undefined;
    const profiles: readonly CustodyProfile[] = [
      "runtime",
      "admin",
      "admin-credential",
      "rotation",
      "writer-replacement",
      "transfer",
    ];
    for (const profile of profiles) await store.remove(profile, selected);
    await forgetServiceKey({ ...selected, credentialStore: store });
    if (operator) {
      const initialization = stage(
        preparedInitializationSchema,
        await store.read("setup", operator),
      );
      if (initialization?.bundle.anchor.accountId === values.account)
        await store.remove("setup", operator);
    }
    output({ accountId: values.account, removed: true });
  } else if (
    command === "vault transfer create" ||
    command === "vault transfer cancel"
  ) {
    const adminKey = await key("admin");
    const selected = selection(adminKey, "admin");
    const material = await adminCustody.loadAdmin(selected);
    if (!material) return failure("VAULT_NOT_PROVISIONED");
    const options = {
      origin,
      adminKey,
      managementToken: await managementToken(),
      material,
    };
    if (command === "vault transfer cancel") {
      if (
        !values["transfer-id"] ||
        !id.safeParse(values["transfer-id"]).success
      )
        return failure("INVALID_REQUEST");
      output(
        await cancelTransfer({ ...options, transferId: values["transfer-id"] }),
      );
    } else {
      const bundle = await (await management()).download();
      const password = values.stdin
        ? await exactStdin()
        : await hidden("Vault password: ");
      const runtime = await refreshRuntime(bundle.keyring, material.runtime);
      output(
        await createTransfer({
          ...options,
          material: { ...material, runtime },
          bundle,
          password,
        }),
      );
    }
  } else if (command === "vault transfer receive") {
    const serviceKey = await key("read");
    const selected = selection(serviceKey, "read");
    const sessions = new FileTransferSessions(store, selected);
    const code = (
      values.stdin ? await exactStdin() : await hidden("Transfer code: ", 3000)
    ).trim();
    const runtime = await receiveTransfer({
      origin,
      serviceKey,
      code,
      custody: runtimeCustody,
      sessions,
    });
    output({
      accountId: runtime.anchor.accountId,
      generation: runtime.generation,
    });
  } else if (command === "vault transfer forget") {
    const transferId = id.safeParse(values["transfer-id"]);
    if (!transferId.success) return failure("INVALID_REQUEST");
    const selected = values.account
      ? { origin, accountId: values.account }
      : selection(await key("read"), "read");
    await new FileTransferSessions(store, selected).abandon(transferId.data);
    output({ forgotten: true });
  } else if (command === "custody recover-lock") {
    const profiles: readonly CustodyProfile[] = [
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
    ];
    const profile = profiles.find((entry) => entry === values.profile);
    if (
      !profile ||
      (!values.account &&
        profile !== "setup" &&
        profile !== "credential-index" &&
        profile !== "management-credential")
    )
      return failure("INVALID_REQUEST");
    const selected =
      profile === "setup"
        ? operatorSelection(
            origin,
            (await (await management()).identity()).operatorId,
          )
        : profile === "management-credential"
          ? managementSelection
          : profile === "credential-index"
            ? { origin, accountId: credentialIndexId }
            : { origin, accountId: values.account! };
    output({ recovered: await store.recoverLock(profile, selected) });
  } else if (command === "project create") {
    if (!values.project) return failure("INVALID_REQUEST");
    output(await (await administrator()).createProject(values.project));
  } else if (command === "projects") {
    output(await (await reader()).listProjects());
  } else if (command === "list") {
    if (!values.project) return failure("INVALID_REQUEST");
    output(await (await reader()).listSecrets({ project: values.project }));
  } else if (command === "status") {
    const custodyMode = values.mount
      ? "protected-mount"
      : values["vault-env"]
        ? "environment"
        : values["file-mode"]
          ? "owner-only-file"
          : "native";
    output({ ...(await (await reader()).status()), custodyMode });
  } else if (command === "get") {
    stdout.write(await (await reader()).getSecret(address()));
  } else if (command === "put") {
    output(
      await (await administrator()).createSecret(address(), await readValue()),
    );
  } else if (command === "update") {
    output(
      await (await administrator()).updateSecret(address(), await readValue()),
    );
  } else if (command === "pending verify") {
    output(
      await (
        await administrator()
      ).activatePending(address(), await readValue()),
    );
  } else if (command === "pending reject") {
    output(await (await administrator()).rejectPending(address()));
  } else if (command === "delete") {
    output(await (await administrator()).deleteSecret(address()));
  } else if (command === "recreate") {
    output(
      await (
        await administrator()
      ).recreateSecret(address(), await readValue()),
    );
  } else {
    return failure("INVALID_REQUEST");
  }
}

void main().catch((error: unknown) => {
  const redacted =
    error instanceof PassmanError ? error : new PassmanError("INVALID_REQUEST");
  stderr.write(`${redacted.message}\n`);
  process.exitCode = 1;
});
