// Tests CodeDiff's unified-diff parsing, counter boundaries, malformed input,
// headerless behavior, and side-by-side run pairing.

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
    expect(parseUnifiedDiff({ source: "@@ -12 +20 @@\n same\n-old\n+new\n" })).toEqual({
      diff: {
        hasHunkHeaders: true,
        hunks: [{
          header: "@@ -12 +20 @@",
          lines: [
            { kind: "context", text: "same", oldLineNumber: 12, newLineNumber: 20 },
            { kind: "remove", text: "old", oldLineNumber: 13 },
            { kind: "add", text: "new", newLineNumber: 21 },
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

  it("should report the fence-relative line when content is malformed", () => {
    expect(parseUnifiedDiff({ source: "@@ -1 +1 @@\nunchanged\n" }).diagnostics).toEqual([
      {
        line: 2,
        message: "Expected a diff line beginning with space, +, or -",
      },
    ]);
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
