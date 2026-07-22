// Render-health for every committed example document: each one must render
// without diagnostics, so the dedicated per-component examples stay honest
// inputs rather than aspirational ones.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderDocument } from "./render-document.js";

const EXAMPLES_DIR = new URL("../../examples", import.meta.url).pathname;

const exampleFiles = readdirSync(EXAMPLES_DIR).filter((name) =>
  name.endsWith(".mdx"),
);

describe("example documents", () => {
  it("should find the example documents to check", () => {
    expect(exampleFiles.length).toBeGreaterThan(0);
  });

  it.each(exampleFiles)("should render %s without diagnostics", (name) => {
    const markdown = readFileSync(join(EXAMPLES_DIR, name), "utf8");
    const { html } = renderDocument({ markdown, fallbackTitle: name });
    expect(html).toContain("<!doctype html>");
  });
});
