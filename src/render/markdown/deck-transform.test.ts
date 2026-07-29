// Tests the deck transform through full compilation: slide frames around h2
// sections, numbered kickers, Part divider numbering and anchors, and the
// part grouping carried on section metadata.

import { describe, expect, it } from "vitest";
import { compileMarkdown, serializeMarkdown } from "./compile-markdown.js";

const compile = (markdown: string) => {
  const compiled = compileMarkdown({ markdown });
  return { ...compiled, html: serializeMarkdown({ root: compiled.root }) };
};

const DECK_FIXTURE = `# Deck plan

The lede.

<Part title="Context" />

## Status quo

Today's state.

## Success looks like

The outcome.

<Part title="The proposal" />

## The design

The mechanism.
`;

describe("deck slide frames", () => {
  it("should wrap each h2 section in a slide frame when the document has sections", () => {
    const { html } = compile("## One\n\nAlpha.\n\n## Two\n\nBeta.\n");
    expect(html.match(/<section data-slide/g)).toHaveLength(2);
    expect(html).toMatch(
      /<section data-slide[^>]*><p data-slide-kicker[^>]*>1 \/ One<\/p><h2 id="one">One<\/h2>\n<p>Alpha\.<\/p>\n<\/section>/,
    );
  });

  it("should give sections plain sequential kickers when no Part exists", () => {
    const { html } = compile("## One\n\nA.\n\n## Two\n\nB.\n");
    expect(html).toContain(">1 / One</p>");
    expect(html).toContain(">2 / Two</p>");
  });

  it("should restart slide numbering at each Part in part.index form", () => {
    const { html } = compile(DECK_FIXTURE);
    expect(html).toContain(">1.1 / Status quo</p>");
    expect(html).toContain(">1.2 / Success looks like</p>");
    expect(html).toContain(">2.1 / The design</p>");
  });

  it("should number Part dividers in document order when the plan has acts", () => {
    const { html } = compile(DECK_FIXTURE);
    expect(html).toMatch(/<span data-part-number[^>]*>Part 1<\/span>/);
    expect(html).toMatch(/<span data-part-number[^>]*>Part 2<\/span>/);
    expect(html.indexOf("Part 1")).toBeLessThan(html.indexOf("Part 2"));
  });

  it("should anchor each Part divider and report the ids in order", () => {
    const { html, partIds } = compile(DECK_FIXTURE);
    expect(partIds).toEqual(["part-context", "part-the-proposal"]);
    expect(html).toContain('id="part-context"');
    expect(html).toContain('id="part-the-proposal"');
  });

  it("should keep the lede and title outside any slide frame", () => {
    const { html } = compile("# Title\n\nThe lede.\n\n## One\n\nA.\n");
    expect(html).toMatch(/<h1 id="title">Title<\/h1>/);
    expect(html).not.toMatch(
      /<section data-slide[^>]*>(?:(?!<\/section>).)*<h1/,
    );
  });

  it("should keep the footnotes appendix outside the last slide", () => {
    const { html } = compile("## One\n\ntext[^1]\n\n[^1]: the note\n");
    const slideEnd = html.indexOf("</section>");
    expect(slideEnd).toBeGreaterThan(-1);
    expect(html.indexOf('class="footnotes"')).toBeGreaterThan(slideEnd);
  });

  it("should end a slide at the next Part divider when an act follows", () => {
    const { html } = compile(
      '## One\n\nA.\n\n<Part title="Next" />\n\n## Two\n\nB.\n',
    );
    const divider = html.indexOf("data-part");
    const firstSlideEnd = html.indexOf("</section>");
    expect(firstSlideEnd).toBeLessThan(divider);
  });

  it("should leave a document without h2 sections unwrapped", () => {
    const { html } = compile("# Only a title\n\nProse.\n");
    expect(html).not.toContain("data-slide");
  });
});

describe("deck section metadata", () => {
  it("should attach each section's part in document order when acts exist", () => {
    const { sections } = compile(DECK_FIXTURE);
    expect(sections).toEqual([
      {
        id: "status-quo",
        text: "Status quo",
        part: { number: 1, title: "Context" },
      },
      {
        id: "success-looks-like",
        text: "Success looks like",
        part: { number: 1, title: "Context" },
      },
      {
        id: "the-design",
        text: "The design",
        part: { number: 2, title: "The proposal" },
      },
    ]);
  });

  it("should leave sections partless when the document has no Part markers", () => {
    const { sections } = compile("## One\n\nA.\n");
    expect(sections).toEqual([{ id: "one", text: "One" }]);
  });

  it("should leave sections before the first Part partless", () => {
    const { sections } = compile(
      '## Preamble\n\nA.\n\n<Part title="Context" />\n\n## Status quo\n\nB.\n',
    );
    expect(sections[0]).toEqual({ id: "preamble", text: "Preamble" });
    expect(sections[1]).toMatchObject({
      part: { number: 1, title: "Context" },
    });
  });
});
