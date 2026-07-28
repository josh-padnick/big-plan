// Tests authored-body structure once so feature compilers can focus on their
// own author-facing requirements and diagnostics.

import type { ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import {
  countAuthoredFences,
  fenceLanguage,
  meaningfulChildren,
  singleAuthoredFence,
} from "./authored-body.js";

const fence = ({
  language = "ts",
  source = "const answer = 42;\n",
}: {
  readonly language?: string;
  readonly source?: string;
} = {}): ElementContent => ({
  type: "element",
  tagName: "pre",
  properties: {},
  children: [
    {
      type: "element",
      tagName: "code",
      properties: { className: [`language-${language}`] },
      position: {
        start: { line: 3, column: 1 },
        end: { line: 5, column: 4 },
      },
      children: [{ type: "text", value: source }],
    },
  ],
});

describe("authored body fences", () => {
  it("should read one exact fence while ignoring whitespace separators", () => {
    expect(
      singleAuthoredFence({
        children: [{ type: "text", value: "\n" }, fence()],
        language: "ts",
      }),
    ).toEqual({
      source: "const answer = 42;\n",
      language: "ts",
      codePosition: {
        start: { line: 3, column: 1 },
        end: { line: 5, column: 4 },
      },
    });
  });

  it("should reject extra content and a mismatched language", () => {
    expect(
      singleAuthoredFence({
        children: [fence(), { type: "text", value: "prose" }],
      }),
    ).toBeUndefined();
    expect(
      singleAuthoredFence({ children: [fence()], language: "json" }),
    ).toBeUndefined();
  });

  it("should expose language and recursively count nested fences", () => {
    const nested: ElementContent = {
      type: "element",
      tagName: "blockquote",
      properties: {},
      children: [fence({ language: "json" })],
    };
    expect(fenceLanguage(fence({ language: "sql" }))).toBe("sql");
    expect(countAuthoredFences([fence(), nested])).toBe(2);
  });

  it("should remove whitespace but retain meaningful authored nodes", () => {
    expect(
      meaningfulChildren([
        { type: "text", value: "\n  " },
        { type: "text", value: "body" },
      ]),
    ).toEqual([{ type: "text", value: "body" }]);
  });
});
