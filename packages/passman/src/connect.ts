import {
  canonicalOrigin,
  failure,
  id,
  parseCredential,
  z,
} from "@passman/protocol";
import { NativeStore } from "./native-custody.js";
import { RuntimeClient, type RuntimeOptions } from "./runtime.js";
import { storageError, type UnixFileStore } from "./custody.js";

type CredentialStore = Pick<UnixFileStore, "read" | "write">;
export const credentialIndexId = "00000000-0000-0000-0000-000000000000";
const indexSchema = z
  .object({
    version: z.literal(1),
    accounts: z.array(id).max(100),
    defaultAccount: id.optional(),
  })
  .strict()
  .refine(
    ({ accounts, defaultAccount }) =>
      new Set(accounts).size === accounts.length &&
      (defaultAccount === undefined || accounts.includes(defaultAccount)),
  );
type ConnectionOptions = Omit<RuntimeOptions, "origin" | "serviceKey"> & {
  origin?: string;
  serviceKey?: string;
  accountId?: string;
  credentialStore?: CredentialStore;
};
function checkedIndex(value: unknown) {
  const result = indexSchema.safeParse(value);
  if (!result.success) return failure("STORAGE_UNAVAILABLE");
  return result.data;
}

/** Save authorization once. Vault provisioning remains a separate explicit custody action. */
export async function saveServiceKey(options: {
  origin: string;
  serviceKey: string;
  setDefault?: boolean;
  credentialStore?: CredentialStore;
  fetch?: typeof fetch;
}) {
  const origin = canonicalOrigin(options.origin),
    selected = parseCredential(options.serviceKey, "read");
  const status = await new RuntimeClient({
    origin,
    serviceKey: options.serviceKey,
    custody: null,
    fetch: options.fetch,
  }).authorization();
  const store = options.credentialStore ?? new NativeStore();
  try {
    const selection = { origin, accountId: credentialIndexId };
    const existing = await store.read("credential-index", selection);
    const index =
      existing === undefined
        ? { accounts: [], defaultAccount: undefined }
        : checkedIndex(existing);
    const accounts = [...new Set([...index.accounts, selected.accountId])];
    if (accounts.length > 100) return failure("CONFLICT");
    const defaultAccount =
      options.setDefault || existing === undefined
        ? selected.accountId
        : index.defaultAccount;
    await store.write(
      "credential-index",
      selection,
      { version: 1, accounts, defaultAccount },
      async (current) => {
        if (JSON.stringify(current) !== JSON.stringify(existing))
          return failure("CONFLICT");
        await store.write(
          "credential",
          { origin, accountId: selected.accountId },
          options.serviceKey,
          () => true,
        );
        return true;
      },
    );
  } catch (error) {
    return storageError(error);
  }
  return {
    accountId: selected.accountId,
    projects: status.credential.projects,
    expiresAt: status.credential.expiresAt,
  };
}

/** Resolve an explicit/environment credential before a named/default saved account. */
export async function resolveServiceKey(
  options: ConnectionOptions = {},
): Promise<string> {
  const origin = canonicalOrigin(
    options.origin ?? process.env.PASSMAN_ORIGIN ?? "",
  );
  let accountId = options.accountId;
  if (accountId !== undefined && !id.safeParse(accountId).success)
    return failure("INVALID_REQUEST");
  const configured =
    options.serviceKey === undefined
      ? process.env.PASSMAN_SERVICE_KEY
      : options.serviceKey;
  if (configured !== undefined) {
    const parsed = parseCredential(configured, "read");
    if (accountId && parsed.accountId !== accountId)
      return failure("CONTEXT_MISMATCH");
    return configured;
  }
  const store = options.credentialStore ?? new NativeStore();
  try {
    if (accountId === undefined) {
      const input = await store.read("credential-index", {
        origin,
        accountId: credentialIndexId,
      });
      if (input === undefined) return failure("PROFILE_REQUIRED");
      accountId = checkedIndex(input).defaultAccount;
    }
    if (!accountId) return failure("PROFILE_REQUIRED");
    const stored = await store.read("credential", { origin, accountId });
    if (stored === undefined) return failure("PROFILE_REQUIRED");
    if (typeof stored !== "string") return failure("STORAGE_UNAVAILABLE");
    const parsed = parseCredential(stored, "read");
    if (parsed.accountId !== accountId) return failure("CONTEXT_MISMATCH");
    return stored;
  } catch (error) {
    return storageError(error);
  }
}
export async function connect(
  options: ConnectionOptions = {},
): Promise<RuntimeClient> {
  const origin = canonicalOrigin(
    options.origin ?? process.env.PASSMAN_ORIGIN ?? "",
  );
  return new RuntimeClient({
    ...options,
    origin,
    serviceKey: await resolveServiceKey({ ...options, origin }),
  });
}
/** Remove a saved read credential and its default pointer. This does not revoke server access. */
export async function forgetServiceKey(options: {
  origin: string;
  accountId: string;
  credentialStore?: CredentialStore & { remove: UnixFileStore["remove"] };
}) {
  const origin = canonicalOrigin(options.origin),
    accountId = id.safeParse(options.accountId);
  if (!accountId.success) failure("INVALID_REQUEST");
  const store = options.credentialStore ?? new NativeStore();
  const selection = { origin, accountId: credentialIndexId };
  try {
    const current = await store.read("credential-index", selection);
    if (current === undefined) {
      // Serialize removal against a concurrent first save without creating a default.
      await store.write(
        "credential-index",
        selection,
        undefined,
        async (existing) => {
          if (existing !== undefined) return failure("CONFLICT");
          await store.remove("credential", {
            origin,
            accountId: accountId.data,
          });
          return false;
        },
      );
      return;
    }
    const index = checkedIndex(current),
      accounts = index.accounts.filter((a) => a !== accountId.data);
    const defaultAccount =
      index.defaultAccount === accountId.data
        ? undefined
        : index.defaultAccount;
    await store.write(
      "credential-index",
      selection,
      { version: 1, accounts, defaultAccount },
      async (existing) => {
        if (JSON.stringify(existing) !== JSON.stringify(current))
          return failure("CONFLICT");
        await store.remove("credential", { origin, accountId: accountId.data });
        return true;
      },
    );
  } catch (error) {
    return storageError(error);
  }
}
