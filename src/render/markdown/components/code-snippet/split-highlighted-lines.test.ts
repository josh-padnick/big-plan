// Tests syntax-aware line splitting at multiline token boundaries plus plain,
// trailing-newline, empty-source, and unknown-language fallbacks.

import type { ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { splitHighlightedLines } from "./split-highlighted-lines.js";

const lineText = (line: ReadonlyArray<ElementContent>): string =>
  line
    .map((node) => {
      if (node.type === "text") {
        return node.value;
      }
      if (node.type === "element") {
        return lineText(node.children);
      }
      return "";
    })
    .join("");

const classNames = (
  line: ReadonlyArray<ElementContent>,
): ReadonlyArray<string> =>
  line.flatMap((node) => {
    if (node.type !== "element") {
      return [];
    }
    const own = Array.isArray(node.properties.className)
      ? node.properties.className.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return [...own, ...classNames(node.children)];
  });

describe("splitHighlightedLines", () => {
  it("should reopen a comment token when a block comment spans lines", () => {
    const lines = splitHighlightedLines({
      source: "/* first\n * second\n */",
      language: "js",
    });

    expect(lines.map(lineText)).toEqual(["/* first", " * second", " */"]);
    expect(lines.map(classNames)).toEqual([
      ["hljs-comment"],
      ["hljs-comment"],
      ["hljs-comment"],
    ]);
  });

  it("should reopen a string token when a template literal spans lines", () => {
    const lines = splitHighlightedLines({
      source: "const message = `first\nsecond`;",
      language: "js",
    });

    expect(lines.map(lineText)).toEqual(["const message = `first", "second`;"]);
    expect(classNames(lines[0] ?? [])).toContain("hljs-string");
    expect(classNames(lines[1] ?? [])).toContain("hljs-string");
  });

  it("should retain nested substitution spans on the continued template line", () => {
    const lines = splitHighlightedLines({
      source: "const message: string = `first\n${value}`;",
      language: "ts",
    });

    expect(lines.map(lineText)).toEqual([
      "const message: string = `first",
      "${value}`;",
    ]);
    expect(classNames(lines[1] ?? [])).toEqual(["hljs-string", "hljs-subst"]);
  });

  it("should omit the synthetic empty row when source has a trailing newline", () => {
    const lines = splitHighlightedLines({
      source: "one\ntwo\n",
      language: "js",
    });
    expect(lines.map(lineText)).toEqual(["one", "two"]);
  });

  it("should retain one empty row when source is empty", () => {
    const lines = splitHighlightedLines({ source: "", language: "js" });
    expect(lines).toEqual([[]]);
  });

  it("should leave every line as plain text when no language is declared", () => {
    const lines = splitHighlightedLines({ source: "<tag>\n& text\n" });
    expect(lines.map(lineText)).toEqual(["<tag>", "& text"]);
    expect(lines.flat()).toEqual([
      { type: "text", value: "<tag>" },
      { type: "text", value: "& text" },
    ]);
  });

  it("should use the plain-text fallback when a declared language is unknown", () => {
    const lines = splitHighlightedLines({
      source: "alpha\nbeta",
      language: "big-plan-example",
    });
    expect(lines.map(lineText)).toEqual(["alpha", "beta"]);
    expect(lines.flat().every((node) => node.type === "text")).toBe(true);
  });
});
