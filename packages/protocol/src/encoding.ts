import {
  bytes32,
  failure,
  id,
  originSchema,
  type Anchor,
  type RecordContext,
} from "./schemas.js";
export const encoder = new TextEncoder();
export const decoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
export function b64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function unb64(value: string, length?: number): Uint8Array<ArrayBuffer> {
  try {
    if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length > 1_000_000)
      failure("INVALID_REQUEST");
    const bytes = Uint8Array.from(
      atob(value.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
    if (
      b64(bytes) !== value ||
      (length !== undefined && bytes.length !== length)
    )
      failure("INVALID_REQUEST");
    return bytes;
  } catch {
    return failure("INVALID_REQUEST");
  }
}
export const randomSecret = () =>
  b64(crypto.getRandomValues(new Uint8Array(32)));
export function jsonBytes(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return failure("INVALID_REQUEST");
  return encoder.encode(serialized);
}
export async function digest(value: string | Uint8Array<ArrayBuffer>) {
  return b64(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? encoder.encode(value) : value,
      ),
    ),
  );
}
export function anchorTuple(a: Anchor) {
  return [a.version, a.origin, a.accountId, a.vaultId, a.writer.x];
}
export const sameAnchor = (a: Anchor, b: Anchor) =>
  JSON.stringify(anchorTuple(a)) === JSON.stringify(anchorTuple(b));
export function contextTuple(c: RecordContext) {
  return [
    "passman/value",
    c.version,
    c.origin,
    c.accountId,
    c.vaultId,
    c.projectId,
    c.project,
    c.secretId,
    c.name,
    c.keyId,
    c.epoch,
    c.revision,
    c.state,
  ];
}
export function canonicalOrigin(value: string) {
  const parsed = originSchema.safeParse(value);
  if (!parsed.success) return failure("INVALID_REQUEST");
  return parsed.data;
}
export function parseCredential(value: string, expected?: "read" | "admin") {
  if (typeof value !== "string" || value.length !== 4 + 3 + 2 * 36 + 43)
    return failure("UNAUTHORIZED");
  const [prefix, rawAccount, rawId, secret] = value.split(".");
  const account = id.safeParse(rawAccount),
    credential = id.safeParse(rawId);
  if (
    (prefix !== "pmr1" && prefix !== "pma1") ||
    !account.success ||
    !credential.success ||
    !bytes32.safeParse(secret).success
  )
    return failure("UNAUTHORIZED");
  const kind = prefix === "pmr1" ? "read" : "admin";
  if (expected && expected !== kind) return failure("FORBIDDEN");
  return { kind, accountId: account.data, id: credential.data };
}
