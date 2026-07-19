// Tests FileTree's line grammar, hierarchy construction, metadata suffixes,
// whitespace handling, and every structural diagnostic.

import { describe, expect, it } from "vitest";
import { parseTreeText } from "./parse-tree-text.js";

const parseDiff = ({ source }: { readonly source: string }) =>
  parseTreeText({ source, mode: "diff" });

describe("parseTreeText", () => {
  it("should diagnose an empty fence", () => {
    expect(parseDiff({ source: "" })).toEqual({
      entries: [],
      diagnostics: [
        { line: 1, message: "FileTreeDiff must contain at least one entry" },
      ],
    });
  });

  it("should parse one file", () => {
    expect(parseDiff({ source: "README.md\n" })).toEqual({
      entries: [{ name: "README.md", kind: "file", children: [] }],
      diagnostics: [],
    });
  });

  it("should build a deeply nested directory hierarchy", () => {
    expect(
      parseDiff({
        source:
          "src/\n  render/\n    markdown/\n      blocks/\n        registry.ts\n",
      }),
    ).toEqual({
      entries: [
        {
          name: "src/",
          kind: "directory",
          children: [
            {
              name: "render/",
              kind: "directory",
              children: [
                {
                  name: "markdown/",
                  kind: "directory",
                  children: [
                    {
                      name: "blocks/",
                      kind: "directory",
                      children: [
                        { name: "registry.ts", kind: "file", children: [] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      diagnostics: [],
    });
  });

  it("should diagnose an indentation jump", () => {
    expect(
      parseDiff({ source: "src/\n    registry.ts\n" }).diagnostics,
    ).toContainEqual({
      line: 2,
      message: "Indentation cannot jump more than one level deeper",
    });
  });

  it("should diagnose odd indentation", () => {
    expect(
      parseDiff({ source: "src/\n   registry.ts\n" }).diagnostics,
    ).toContainEqual({
      line: 2,
      message: "Indentation must use multiples of two spaces",
    });
  });

  it("should diagnose a file with children", () => {
    expect(
      parseDiff({ source: "README.md\n  nested.md\n" }).diagnostics,
    ).toContainEqual({
      line: 2,
      message: 'File "README.md" cannot have children',
    });
  });

  it.each(["added", "modified", "removed", "renamed"])(
    "should parse the %s badge",
    (badge) => {
      const entry = parseDiff({ source: `file.ts [${badge}]\n` }).entries[0];
      expect(entry?.badge).toBe(badge);
      expect(entry?.name).toBe("file.ts");
    },
  );

  it("should diagnose an unknown badge and list every valid badge", () => {
    expect(parseDiff({ source: "file.ts [moved]\n" }).diagnostics).toEqual([
      {
        line: 1,
        message:
          'Unknown badge "moved"; expected one of: added, modified, removed, renamed',
      },
    ]);
  });

  it("should parse a note after a badge", () => {
    expect(
      parseDiff({
        source: "registry.ts [modified] - Register the FileTree block.\n",
      }),
    ).toEqual({
      entries: [
        {
          name: "registry.ts",
          kind: "file",
          badge: "modified",
          note: "Register the FileTree block.",
          children: [],
        },
      ],
      diagnostics: [],
    });
  });

  it("should parse an explicit renamed file and directory", () => {
    expect(
      parseDiff({
        source: "old/ -> new/ [renamed]\n  old.ts -> new.ts [renamed]\n",
      }),
    ).toEqual({
      entries: [
        {
          oldName: "old/",
          name: "new/",
          kind: "directory",
          badge: "renamed",
          children: [
            {
              oldName: "old.ts",
              name: "new.ts",
              kind: "file",
              badge: "renamed",
              children: [],
            },
          ],
        },
      ],
      diagnostics: [],
    });
  });

  it.each([
    ["old.ts -> new.ts\n", "Rename arrows require the [renamed] badge"],
    [
      "old.ts -> new.ts [modified]\n",
      "Rename arrows may only use the [renamed] badge",
    ],
  ])(
    "should reject a rename arrow without its renamed badge",
    (source, message) => {
      expect(parseDiff({ source }).diagnostics).toContainEqual({
        line: 1,
        message,
      });
    },
  );

  it("should ignore blank lines without changing hierarchy", () => {
    expect(
      parseDiff({
        source: "\nsrc/\n\n  index.ts\n  \nREADME.md\n",
      }),
    ).toEqual({
      entries: [
        {
          name: "src/",
          kind: "directory",
          children: [{ name: "index.ts", kind: "file", children: [] }],
        },
        { name: "README.md", kind: "file", children: [] },
      ],
      diagnostics: [],
    });
  });

  it("should diagnose an empty note", () => {
    expect(parseDiff({ source: "README.md - \n" }).diagnostics).toEqual([
      { line: 1, message: 'Expected note text after " - "' },
    ]);
  });

  it("should parse plain hierarchy and notes without change metadata", () => {
    expect(
      parseTreeText({
        source: "worker-pool/\n  worker.ts - Runs one queued job.\n",
        mode: "plain",
      }),
    ).toEqual({
      entries: [
        {
          name: "worker-pool/",
          kind: "directory",
          children: [
            {
              name: "worker.ts",
              kind: "file",
              note: "Runs one queued job.",
              children: [],
            },
          ],
        },
      ],
      diagnostics: [],
    });
  });

  it("should direct plain-tree badges and rename arrows to FileTreeDiff", () => {
    expect(
      parseTreeText({
        source: "before.ts -> after.ts [renamed]\n",
        mode: "plain",
      }).diagnostics,
    ).toEqual([
      {
        line: 1,
        message:
          "Change badges are not supported in FileTree; use FileTreeDiff instead",
      },
      {
        line: 1,
        message:
          "Rename arrows are not supported in FileTree; use FileTreeDiff instead",
      },
    ]);
  });
});
