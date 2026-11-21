import { ENV_FILE_MAX, ENV_ENTRIES_MAX, envNameSchema } from "@keyman-mvp/core";

export type EnvIssueCode =
  | "INVALID_ENCODING"
  | "FILE_TOO_LARGE"
  | "CONTROL_CHARACTER"
  | "INVALID_ASSIGNMENT"
  | "KEY_TOO_LONG"
  | "DUPLICATE_KEY"
  | "UNCLOSED_QUOTE"
  | "TRAILING_CONTENT"
  | "EMPTY_FILE"
  | "TOO_MANY_ENTRIES";
export type EnvIssue = { line: number; code: EnvIssueCode };
export class EnvImportError extends Error {
  constructor(public readonly issues: readonly EnvIssue[]) {
    super(
      "Invalid .env file: " +
        issues.map((i) => `line ${i.line} (${i.code})`).join(", "),
    );
    this.name = "EnvImportError";
  }
}
export type EnvEntry = {
  name: string;
  value: string;
  line: number;
  literalReferences: boolean;
};

/** Returns plaintext for trusted local code. Never log or send the result to a model. */
export function parseEnv(source: string | Uint8Array): EnvEntry[] {
  const fail = (code: EnvIssueCode, line = 1): never => {
    throw new EnvImportError([{ line, code }]);
  };
  const size =
    typeof source === "string"
      ? new TextEncoder().encode(source).length
      : source.byteLength;
  if (size > ENV_FILE_MAX) fail("FILE_TOO_LARGE");
  let text: string;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    text = decoder.decode(
      typeof source === "string" ? new TextEncoder().encode(source) : source,
    );
    if (typeof source === "string" && text !== source) fail("INVALID_ENCODING");
  } catch {
    return fail("INVALID_ENCODING");
  }
  text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10) || code === 127)
      fail("CONTROL_CHARACTER", text.slice(0, index).split("\n").length);
  }
  const entries: EnvEntry[] = [],
    issues: EnvIssue[] = [],
    names = new Set<string>();
  let position = 0,
    line = 1;
  const endOfLine = () => {
    const end = text.indexOf("\n", position);
    return end < 0 ? text.length : end;
  };
  const nextLine = () => {
    position = endOfLine() + 1;
    line++;
  };
  while (position < text.length && issues.length < 20) {
    const startLine = line,
      content = text.slice(position, endOfLine());
    if (/^[ \t]*(?:#.*)?$/.test(content)) {
      nextLine();
      continue;
    }
    const assignment =
      /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*/.exec(
        content,
      );
    if (!assignment) {
      issues.push({ line, code: "INVALID_ASSIGNMENT" });
      nextLine();
      continue;
    }
    const name = assignment[1]!;
    position += assignment[0].length;
    let value = "";
    const quote = text[position];
    if (quote === '"' || quote === "'") {
      position++;
      let closed = false;
      while (position < text.length) {
        const character = text[position++]!;
        if (character === quote) {
          closed = true;
          break;
        }
        if (character === "\n") line++;
        if (quote === '"' && character === "\\") {
          const escaped = text[position];
          const escapes: Record<string, string> = {
            n: "\n",
            r: "\r",
            t: "\t",
            '"': '"',
            "\\": "\\",
          };
          if (escaped !== undefined && Object.hasOwn(escapes, escaped)) {
            value += escapes[escaped];
            position++;
            continue;
          }
        }
        value += character;
      }
      if (!closed) {
        issues.push({ line: startLine, code: "UNCLOSED_QUOTE" });
        break;
      }
      if (!/^[ \t]*(?:#.*)?$/.test(text.slice(position, endOfLine())))
        issues.push({ line, code: "TRAILING_CONTENT" });
    } else {
      value = text.slice(position, endOfLine()).split("#", 1)[0]!.trim();
    }
    if (!envNameSchema.safeParse(name).success)
      issues.push({ line: startLine, code: "KEY_TOO_LONG" });
    if (names.has(name))
      issues.push({ line: startLine, code: "DUPLICATE_KEY" });
    names.add(name);
    entries.push({
      name,
      value,
      line: startLine,
      literalReferences: /\$(?:\{|\(|[A-Za-z_])/.test(value),
    });
    if (entries.length > ENV_ENTRIES_MAX) {
      issues.push({ line: startLine, code: "TOO_MANY_ENTRIES" });
      break;
    }
    nextLine();
  }
  if (issues.length) throw new EnvImportError(issues);
  if (!entries.length) fail("EMPTY_FILE");
  return entries;
}
