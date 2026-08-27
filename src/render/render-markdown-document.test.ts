// Proves the one-pass Markdown delivery is complete, deterministic, and
// semantic for the component cases where visual presentation carries meaning.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPONENT_REGISTRY } from "../components/_registration/registry.js";
import { renderMarkdownDocument } from "./render-markdown-document.js";

const SNAPSHOT = "0123456789abcdef";

const COMPONENT_CONTRACT_MARKERS: ReadonlyArray<
  readonly [component: string, marker: string]
> = [
  ["Callout", "> **Note: Captain review**"],
  ["CodeDiff", "```diff"],
  ["CodeSnippet", "**Annotations**"],
  ["DataTable", "### Rollout gates"],
  ["DatabaseTableSchema", "### Database table: review.review_events"],
  ["Decision", "### Decision: Where should review-event persistence live?"],
  [
    "DecisionAnalysis",
    "### Decision: Which event store should back the first release?",
  ],
  ["FileTree", "### Review module layout"],
  ["FileTreeDiff", "Legend: Added, Modified, Removed, and Renamed"],
  ["FlowDiagram", "#### Connections"],
  ["GraphqlOperation", "### mutation reviewEventAppend"],
  ["GrpcMethod", "### bigplan.v1.ReviewService/WatchReviewEvents"],
  ["HttpEndpoint", "### POST /api/plans/{planId}/review-events"],
  ["MermaidDiagram", "```mermaid"],
  ["Part", "## Part 1 — Context and choices"],
  [
    "QuickDecision",
    "### Decision: Ship the workspace behind a local feature flag?",
  ],
  ["QuickSummary", "## Summary"],
  ["Slide", "> Slide structure — type: desired-experience"],
  ["TableOfContents", "## Plan outline"],
  ["Wireframe", "### Wireframe: Local review queue"],
];

const render = (markdown: string) =>
  renderMarkdownDocument({
    markdown,
    fallbackTitle: "Fallback plan",
    snapshot: SNAPSHOT,
  });

describe("Markdown document delivery", () => {
  it("should preserve authored Markdown and demote headings beneath Parts", () => {
    const result = render(`# Plan

Intro with **weight** and a [link](https://example.com).

## Before the part

<Part title="Delivery" />

## First increment

Details.
`);

    expect(result.markdown).toContain(`# Plan

> Exported plan version: \`${SNAPSHOT}\``);
    expect(result.markdown).toContain("## Before the part");
    expect(result.markdown).toContain("## Part 1 — Delivery");
    expect(result.markdown).toContain("### First increment");
    expect(result.markdown).toContain(
      "Intro with **weight** and a [link](https://example.com).",
    );
    expect(result.markdown.endsWith("\n")).toBe(true);
    expect(result.markdown.endsWith("\n\n")).toBe(false);
  });

  it("should deliver every registered component from the registry fixture", () => {
    const result = render(readFileSync("examples/all-components.mdx", "utf8"));
    const delivered = new Set(
      result.components.map((component) => component.component),
    );

    expect([...delivered].sort()).toEqual(
      Object.keys(COMPONENT_REGISTRY).sort(),
    );
    const prose = result.markdown.replace(/`{3,}[^\n]*\n[\s\S]*?\n`{3,}/gu, "");
    expect(prose).not.toMatch(/(?<!\\)<\/?[A-Z][A-Za-z]+(?:\s|>|\/)/u);
    expect(prose).not.toMatch(/<\/?(?:div|section|span|svg)\b/iu);
  });

  it.each(COMPONENT_CONTRACT_MARKERS)(
    "should preserve the semantic contract for %s",
    (_component, marker) => {
      const result = render(
        readFileSync("examples/all-components.mdx", "utf8"),
      );
      expect(result.markdown).toContain(marker);
    },
  );

  it("should make Decision, Mermaid, FlowDiagram, and Wireframe meaning explicit", () => {
    const result = render(readFileSync("examples/all-components.mdx", "utf8"));

    expect(result.markdown).toContain("### Decision:");
    expect(result.markdown).toContain("Recommendation:");
    expect(result.markdown).toContain("```mermaid");
    expect(result.markdown).toContain("#### Connections");
    expect(result.markdown).toContain("### Wireframe: Local review queue");
    expect(result.markdown).toContain("#### Screen: Review queue — Initial");
    expect(result.markdown).toContain("- UI outline:");
    expect(result.markdown).toContain("Navigation item: Open threads (active)");
  });

  it("should return byte-identical output for identical inputs", () => {
    const source = readFileSync("examples/all-components.mdx", "utf8");
    expect(render(source).markdown).toBe(render(source).markdown);
  });

  it("should keep adversarial scores, states, edges, annotations, and image meaning", () => {
    const result = render(
      readFileSync("examples/markdown-export-adversarial.mdx", "utf8"),
    );

    for (const meaning of [
      "**Normalized weighted totals**",
      "score 5/5",
      "Method: Σ(impact × option score)",
      "**Reversibility:** somewhat-hard",
      "candidate | unblocks after validation | canary",
      "**Lines 41-42:** Validation must settle",
      "![Operator confirmation state](./assets/release-confirmation.png)",
      "#### Screen: Ready to release — Initial",
      "Badge: Checks passed (tone: success)",
      "text field: Approval code (value: Confirmed; disabled)",
      "navigates to screen ready",
    ]) {
      expect(result.markdown).toContain(meaning);
    }
  });
});
