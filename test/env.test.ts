import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnv, EnvImportError } from "../packages/client/src/env";

test("dotenv accepts BOM/CRLF, comments, export, quotes, multiline and literal references", () => {
  const parsed = parseEnv(
    [
      "\uFEFF# fixture",
      " export KEY = unquoted=tail # comment",
      "SINGLE='a # b'",
      String.raw`DOUBLE="line\nquote\"slash\\"`,
      'MULTI="first',
      'second"',
      "EMPTY=",
      "REF=${KEY}",
      "CMD=$(echo literal)",
      "",
    ].join("\r\n"),
  );
  assert.deepEqual(
    parsed.map((e) => [e.name, e.value]),
    [
      ["KEY", "unquoted=tail"],
      ["SINGLE", "a # b"],
      ["DOUBLE", 'line\nquote"slash\\'],
      ["MULTI", "first\nsecond"],
      ["EMPTY", ""],
      ["REF", "${KEY}"],
      ["CMD", "$(echo literal)"],
    ],
  );
  assert.equal(parsed.find((e) => e.name === "REF")?.literalReferences, true);
  assert.equal(parsed.find((e) => e.name === "CMD")?.literalReferences, true);
  assert.equal(parsed.find((e) => e.name === "EMPTY")?.line, 7);
});

for (const [source, code, line] of [
  ["# no entries", "EMPTY_FILE", 1],
  ["OK=x\nBROKEN", "INVALID_ASSIGNMENT", 2],
  ["9KEY=synthetic-sensitive", "INVALID_ASSIGNMENT", 1],
  ["A=x\nA=synthetic-sensitive", "DUPLICATE_KEY", 2],
  ['A="synthetic-sensitive', "UNCLOSED_QUOTE", 1],
  ['A="synthetic-sensitive"tail', "TRAILING_CONTENT", 1],
  ["A=x\u0000synthetic-sensitive", "CONTROL_CHARACTER", 1],
  ["A=x\rB=y", "CONTROL_CHARACTER", 1],
  ["A=\ud800", "INVALID_ENCODING", 1],
  ["K".repeat(257) + "=x", "KEY_TOO_LONG", 1],
  ["A=" + "x".repeat(65536), "FILE_TOO_LARGE", 1],
  [
    Array.from({ length: 101 }, (_, n) => `K${n}=x`).join("\n"),
    "TOO_MANY_ENTRIES",
    101,
  ],
] as const) {
  test(`dotenv rejects ${code} without leaking values`, () => {
    assert.throws(
      () => parseEnv(source),
      (error: unknown) => {
        assert.ok(error instanceof EnvImportError);
        assert.ok(error.issues.some((i) => i.code === code && i.line === line));
        assert.ok(!JSON.stringify(error).includes("synthetic-sensitive"));
        assert.ok(!error.message.includes("synthetic-sensitive"));
        return true;
      },
    );
  });
}

test("dotenv rejects invalid UTF-8 and preserves case, unknown escapes and quoted whitespace", () => {
  assert.throws(() => parseEnv(new Uint8Array([65, 61, 0xff])), EnvImportError);
  assert.deepEqual(
    parseEnv("A='  x  '\na=\"x\\q\"\nB= # empty").map((e) => [e.name, e.value]),
    [
      ["A", "  x  "],
      ["a", "x\\q"],
      ["B", ""],
    ],
  );
});

test("dotenv preserves prototype-like names as data and accepts the exact file/count boundaries", () => {
  assert.deepEqual(
    parseEnv("__proto__=literal\nconstructor=literal").map((e) => e.name),
    ["__proto__", "constructor"],
  );
  assert.equal(parseEnv("A=" + "x".repeat(65534))[0]!.value.length, 65534);
  assert.equal(
    parseEnv(Array.from({ length: 100 }, (_, n) => `K${n}=x`).join("\n"))
      .length,
    100,
  );
});
