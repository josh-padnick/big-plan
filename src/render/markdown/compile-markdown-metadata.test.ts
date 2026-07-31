// Tests document metadata produced by Markdown compilation: section outlines,
// titles, and collision-free element IDs.

import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile-markdown.js";
import { serializeHtml } from "../serialize-html.js";

describe("compileMarkdown sections", () => {
  it("should extract level-two headings as TOC sections when the document has h2s", () => {
    const { sections } = compileMarkdown({
      markdown: "# Title\n\n## Background\n\ntext\n\n## Rollout plan\n",
    });
    expect(sections).toEqual([
      { id: "background", name: "Background", title: "Background" },
      {
        id: "rollout-plan",
        name: "Rollout plan",
        title: "Rollout plan",
      },
    ]);
  });

  it("should slug headings containing punctuation when extracting sections", () => {
    const { sections } = compileMarkdown({
      markdown: "## Goals & non-goals (v2)!\n",
    });
    expect(sections).toEqual([
      {
        id: "goals--non-goals-v2",
        name: "Goals & non-goals (v2)!",
        title: "Goals & non-goals (v2)!",
      },
    ]);
  });

  it("should keep ids unique when two h2 headings have identical text", () => {
    const { sections } = compileMarkdown({
      markdown: "## Review\n\nfirst\n\n## Review\n\nsecond\n",
    });
    expect(sections).toHaveLength(2);
    const ids = sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe("review");
  });

  it("should keep inline formatting text when a heading contains code and emphasis", () => {
    const { sections } = compileMarkdown({
      markdown: "## The `retry` *loop*\n",
    });
    expect(sections).toEqual([
      {
        id: "the-retry-loop",
        name: "The retry loop",
        title: "The retry loop",
      },
    ]);
  });

  it("should ignore non-h2 headings when building sections", () => {
    const { sections } = compileMarkdown({
      markdown: "# One\n\n### Three\n\n#### Four\n",
    });
    expect(sections).toEqual([]);
  });

  it("should exclude the generated footnotes label when the document uses footnotes", () => {
    const { root, sections } = compileMarkdown({
      markdown: "## Real section\n\nbody[^1]\n\n[^1]: a note\n",
    });
    const bodyHtml = serializeHtml({ root });
    expect(bodyHtml).toContain('id="footnote-label"');
    expect(sections).toEqual([
      {
        id: "real-section",
        name: "Real section",
        title: "Real section",
      },
    ]);
  });

  it("should return no sections and empty body when the document is empty", () => {
    const { root, sections } = compileMarkdown({ markdown: "" });
    const bodyHtml = serializeHtml({ root });
    expect(sections).toEqual([]);
    expect(bodyHtml).toBe("");
  });
});

describe("compileMarkdown component ids", () => {
  it("should preserve heading ids when a decision would use the same id", () => {
    const { elementIds, sections } = compileMarkdown({
      markdown: `<Decision question="Foo">

<Option title="A" />

<Option title="B" />

</Decision>

## Decision Foo
`,
    });

    expect(sections).toEqual([
      {
        id: "decision-foo",
        name: "Decision Foo",
        title: "Decision Foo",
      },
    ]);
    expect(elementIds).toContain("decision-foo-2");
    expect(new Set(elementIds).size).toBe(elementIds.length);
  });

  it("should preserve heading ids nested inside decision components", () => {
    const { elementIds, sections } = compileMarkdown({
      markdown: `<Decision question="Foo">

## Decision Foo

<Option title="A" />

<Option title="B" />

</Decision>

<Decision question="Bar?">

## Decision Bar

<Option title="A" />

<Option title="B" />

</Decision>
`,
    });

    expect(sections).toEqual([
      {
        id: "decision-foo",
        name: "Decision Foo",
        title: "Decision Foo",
      },
      {
        id: "decision-bar",
        name: "Decision Bar",
        title: "Decision Bar",
      },
    ]);
    expect(elementIds).toContain("decision-foo-2");
    expect(elementIds).toContain("decision-bar-2");
    expect(new Set(elementIds).size).toBe(elementIds.length);
  });

  it("should namespace repeated decision components across one document", () => {
    const repeatedDecisions = `<Decision question="Same?">

<Option title="A" />

<Option title="B" />

</Decision>

<Decision question="Same?">

<Option title="A" />

<Option title="B" />

</Decision>

<QuickDecision question="Same?">

<Option title="A" />

<Option title="B" />

</QuickDecision>

<QuickDecision question="Same?">
<Option title="A" />

<Option title="B" />

</QuickDecision>
`;
    const { elementIds } = compileMarkdown({ markdown: repeatedDecisions });

    expect(elementIds).toContain("decision-same");
    expect(elementIds).toContain("decision-same-option-a");
    expect(elementIds).toContain("decision-same-2");
    expect(elementIds).toContain("decision-same-2-option-a");
    expect(elementIds).toContain("quick-decision-same");
    expect(elementIds).toContain("quick-decision-same-option-a");
    expect(elementIds).toContain("quick-decision-same-2");
    expect(elementIds).toContain("quick-decision-same-2-option-a");
    expect(new Set(elementIds).size).toBe(elementIds.length);
  });
});

describe("compileMarkdown title", () => {
  it("should return the first h1 text when the document has one", () => {
    const { title } = compileMarkdown({
      markdown: "intro\n\n# Payments Plan\n\n## Section\n",
    });
    expect(title).toBe("Payments Plan");
  });

  it("should flatten inline markup when the h1 contains code or emphasis", () => {
    const { title } = compileMarkdown({
      markdown: "# The `retry` *pipeline*\n",
    });
    expect(title).toBe("The retry pipeline");
  });

  it("should return undefined when the document has no h1", () => {
    const { title } = compileMarkdown({ markdown: "## Only sections\n" });
    expect(title).toBeUndefined();
  });

  it("should ignore a # line inside a fenced code block when finding the title", () => {
    const { title } = compileMarkdown({
      markdown: "```sh\n# not a heading\n```\n\n# Real title\n",
    });
    expect(title).toBe("Real title");
  });
});
