// Tests CodeDiff's unified-diff parsing, counter and declared-count validation,
// malformed input, headerless behavior, and side-by-side run pairing.

import { describe, expect, it } from "vitest";
import { pairDiffLines, parseUnifiedDiff } from "./parse-unified-diff.js";

describe("parseUnifiedDiff", () => {
  it("should parse an empty diff as one headerless empty hunk", () => {
    expect(parseUnifiedDiff({ source: "" })).toEqual({
      diff: { hasHunkHeaders: false, hunks: [{ lines: [] }] },
      diagnostics: [],
    });
  });

  it("should seed and advance both counters when a hunk has omitted counts", () => {
    expect(parseUnifiedDiff({ source: "@@ -12 +20 @@\n-old\n+new\n" })).toEqual({
      diff: {
        hasHunkHeaders: true,
        hunks: [{
          header: "@@ -12 +20 @@",
          lines: [
            { kind: "remove", text: "old", oldLineNumber: 12 },
            { kind: "add", text: "new", newLineNumber: 20 },
          ],
        }],
      },
      diagnostics: [],
    });
  });

  it("should parse add-only and remove-only hunks across multiple hunks", () => {
    const result = parseUnifiedDiff({
      source: "@@ -0,0 +1,2 @@\n+one\n+two\n@@ -8,2 +10,0 @@\n-old\n-older\n",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.diff.hunks).toHaveLength(2);
    expect(result.diff.hunks[0]?.lines).toEqual([
      { kind: "add", text: "one", newLineNumber: 1 },
      { kind: "add", text: "two", newLineNumber: 2 },
    ]);
    expect(result.diff.hunks[1]?.lines).toEqual([
      { kind: "remove", text: "old", oldLineNumber: 8 },
      { kind: "remove", text: "older", oldLineNumber: 9 },
    ]);
  });

  it("should ignore a missing-trailing-newline marker", () => {
    const result = parseUnifiedDiff({
      source: "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.diff.hunks[0]?.lines).toHaveLength(2);
  });

  it("should treat a whitespace-stripped blank line as empty context", () => {
    const result = parseUnifiedDiff({
      source: "@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.diff.hunks[0]?.lines[1]).toEqual({
      kind: "context",
      text: "",
      oldLineNumber: 2,
      newLineNumber: 2,
    });
  });

  it("should accept verbatim git diff output by skipping its file preamble", () => {
    const result = parseUnifiedDiff({
      source: [
        "diff --git a/src/retry.ts b/src/retry.ts",
        "index 3f9c2ab..b71d04e 100644",
        "--- a/src/retry.ts",
        "+++ b/src/retry.ts",
        "@@ -1,2 +1,2 @@",
        " const capture = await processor.capture(payment);",
        "-const retries = retryInline(capture);",
        "+const schedule = enqueueRetrySchedule(capture);",
        "",
      ].join("\n"),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.diff.hunks).toHaveLength(1);
    expect(result.diff.hunks[0]?.lines).toHaveLength(3);
  });

  it("should report a preamble-shaped line when it appears after a hunk starts", () => {
    const result = parseUnifiedDiff({
      source: "@@ -1 +1 @@\n-old\n+new\ndiff --git a/x b/x\n",
    });
    expect(result.diagnostics).toEqual([
      {
        line: 4,
        message: "Expected a diff line beginning with space, +, or -",
      },
    ]);
  });

  it("should report the fence-relative line when a hunk header is malformed", () => {
    expect(parseUnifiedDiff({ source: "@@ -1 +1\n-old\n" }).diagnostics).toEqual([
      {
        line: 1,
        message: "Expected a diff line beginning with space, +, or -",
      },
    ]);
  });

  it("should reject hunk line numbers beyond the supported range", () => {
    expect(
      parseUnifiedDiff({ source: "@@ -9007199254740993,2 +1,2 @@" }).diagnostics,
    ).toEqual([{
      line: 1,
      message: "Hunk values and line-number ranges must not exceed 9007199254740991",
    }]);
  });

  it("should report the fence-relative line when content is malformed", () => {
    expect(parseUnifiedDiff({ source: "@@ -1 +1 @@\nunchanged\n" }).diagnostics).toEqual([
      {
        line: 2,
        message: "Expected a diff line beginning with space, +, or -",
      },
      {
        line: 1,
        message: "Hunk declares 1 old and 1 new lines but contains 0 old and 0 new lines",
      },
    ]);
  });

  it("should report declared and actual counts at a mismatched hunk header", () => {
    expect(
      parseUnifiedDiff({ source: "@@ -18,7 +18,10 @@\n same\n-old\n+new\n" }).diagnostics,
    ).toEqual([
      {
        line: 1,
        message: "Hunk declares 7 old and 10 new lines but contains 2 old and 2 new lines",
      },
    ]);
  });

  it.each([
    "@@ -9007199254740992 +1 @@\n-old\n+new\n",
    "@@ -1 +9007199254740991,2 @@\n-old\n+new\n",
    `@@ -${"9".repeat(400)} +1 @@\n-old\n+new\n`,
  ])("should reject hunk coordinates that cannot remain exact", (source) => {
    expect(parseUnifiedDiff({ source }).diagnostics).toEqual([{
      line: 1,
      message:
        "Hunk values and line-number ranges must not exceed 9007199254740991",
    }]);
  });

  it("should retain the largest exactly representable line number", () => {
    expect(parseUnifiedDiff({
      source: "@@ -9007199254740991 +9007199254740991 @@\n-old\n+new\n",
    })).toEqual({
      diff: {
        hasHunkHeaders: true,
        hunks: [{
          header: "@@ -9007199254740991 +9007199254740991 @@",
          lines: [
            { kind: "remove", text: "old", oldLineNumber: 9007199254740991 },
            { kind: "add", text: "new", newLineNumber: 9007199254740991 },
          ],
        }],
      },
      diagnostics: [],
    });
  });

  it("should retain headerless line kinds without fabricating line numbers", () => {
    expect(parseUnifiedDiff({ source: " before\n-old\n+new\n" })).toEqual({
      diff: {
        hasHunkHeaders: false,
        hunks: [{ lines: [
          { kind: "context", text: "before" },
          { kind: "remove", text: "old" },
          { kind: "add", text: "new" },
        ] }],
      },
      diagnostics: [],
    });
  });
});

describe("pairDiffLines", () => {
  it("should pair a balanced remove-add run row by row", () => {
    const parsed = parseUnifiedDiff({ source: "-old one\n-old two\n+new one\n+new two\n" });
    expect(pairDiffLines({ lines: parsed.diff.hunks[0]?.lines ?? [] })).toEqual([
      {
        left: { kind: "remove", text: "old one" },
        right: { kind: "add", text: "new one" },
      },
      {
        left: { kind: "remove", text: "old two" },
        right: { kind: "add", text: "new two" },
      },
    ]);
  });

  it("should leave unbalanced run leftovers and standalone additions one-sided", () => {
    const parsed = parseUnifiedDiff({
      source: "-old one\n-old two\n+new one\n context\n+standalone\n",
    });
    const rows = pairDiffLines({ lines: parsed.diff.hunks[0]?.lines ?? [] });
    expect(rows[0]).toMatchObject({
      left: { text: "old one" },
      right: { text: "new one" },
    });
    expect(rows[1]).toEqual({ left: { kind: "remove", text: "old two" } });
    expect(rows[2]?.left).toEqual(rows[2]?.right);
    expect(rows[3]).toEqual({ right: { kind: "add", text: "standalone" } });
  });
});
