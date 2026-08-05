// Validate-health for every committed example document: each one must render
// without diagnostics and pass authoring lint, the same pair the validate
// command runs, so the shipped examples stay honest inputs rather than
// aspirational ones.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint/lint-plan.js";
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

  it.each(exampleFiles)("should lint %s without findings", (name) => {
    const markdown = readFileSync(join(EXAMPLES_DIR, name), "utf8");
    expect(lintPlan({ markdown })).toEqual([]);
  });
});
