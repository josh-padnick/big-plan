// Tests the deck paradigm through full compilation: slide frames around h2
// sections, numbered kickers, sub-slide frames around h3 runs, context
// builders from leading emphasized paragraphs, and the document outline the
// transform computes for the outline-aware Part and TableOfContents views -
// divider numbering and anchors, completed overview rows, and the part
// grouping carried on section metadata.

import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile-markdown.js";
import { serializeHtml } from "../serialize-html.js";

const compile = (markdown: string) => {
  const compiled = compileMarkdown({ markdown });
  return { ...compiled, html: serializeHtml({ root: compiled.root }) };
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
    expect(html).toContain('data-collapsible="slide" data-collapse-id="one"');
    expect(html).toContain("plan-collapse-frame");
    // The frame is the card; its header holds the toggle and chrome, and the
    // body is the header's SIBLING (see deck-collapse.ts invariant 1).
    expect(html).toMatch(
      /<section data-slide[^>]*data-collapsible="slide"[^>]*><div data-collapse-header[^>]*><button[^>]*data-collapse-toggle[^>]*>.*?<\/button><div class="plan-collapse-chrome"><p data-slide-kicker[^>]*>1 \/ One<\/p><h2 id="one">One<\/h2><\/div><\/div><div data-collapse-body[^>]*>\n?<p>Alpha\.<\/p>/s,
    );
    expect(html).not.toContain("data-collapse-chrome");
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

  it("should wrap each Part and its following slides in a collapsible group", () => {
    const { html } = compile(DECK_FIXTURE);
    expect(html).toMatch(
      /data-collapsible="part" data-collapse-id="part-context"/,
    );
    expect(html).toMatch(
      /data-collapsible="part" data-collapse-id="part-the-proposal"/,
    );
    expect(html).not.toContain("data-collapsed");
    expect(html).toContain("data-collapse-toggle");
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

describe("deck sub-slides", () => {
  const SUBSLIDE_FIXTURE = `# Deck plan

The lede.

<Part title="The proposal" />

## Warm-up

Simple.

## Implementation

An intro line.

### Pipeline

How it travels.

### Planned changes

What lands where.
`;

  it("should render the section header as a parent block above sub-slide frames", () => {
    const { html } = compile(SUBSLIDE_FIXTURE);
    expect(html).toMatch(
      /data-collapsible="slide" data-collapse-id="implementation"/,
    );
    expect(html).toMatch(
      /data-subpart[^>]*data-collapsible="slide"[^>]*><div data-collapse-header[^>]*><button[^>]*>.*?<\/button><div class="plan-collapse-chrome"><p data-slide-kicker[^>]*>1\.2 \/ Implementation<\/p><h2 id="implementation">Implementation<\/h2><\/div><\/div>/s,
    );
    expect(html).toMatch(/data-collapse-body[^>]*>\n?<p>An intro line\.<\/p>/);
  });

  it("should frame each h3 run as its own numbered sub-slide", () => {
    const { html } = compile(SUBSLIDE_FIXTURE);
    expect(html.match(/data-subslide/g)).toHaveLength(2);
    expect(html).toContain(
      'data-collapsible="subslide" data-collapse-id="pipeline"',
    );
    expect(html).toMatch(
      /<h3 id="pipeline" data-slide-kicker[^>]*>1\.2\.1 \/ Pipeline<\/h3><\/div><\/div><div data-collapse-body[^>]*>\n?<p>How it travels\.<\/p>/,
    );
    expect(html).toContain(">1.2.2 / Planned changes</h3>");
  });

  it("should keep a section without h3 headings a single slide frame", () => {
    const { html } = compile(SUBSLIDE_FIXTURE);
    expect(html).toContain(
      'data-collapsible="slide" data-collapse-id="warm-up"',
    );
    expect(html).toContain(">1.1 / Warm-up</p>");
  });

  it("should keep the section's TableOfContents link and metadata on the h2", () => {
    const { sections } = compile(SUBSLIDE_FIXTURE);
    expect(sections.map((section) => section.id)).toEqual([
      "warm-up",
      "implementation",
    ]);
  });
});

describe("deck context builders", () => {
  it("should restyle a slide's leading emphasized paragraph as the context line", () => {
    const { html } = compile(
      "## One\n\n*What you are looking at.*\n\nBody prose.\n",
    );
    expect(html).toMatch(
      /<p data-slide-context[^>]*>What you are looking at\.<\/p>/,
    );
    expect(html).not.toMatch(/<p data-slide-context[^>]*><em>/);
  });

  it("should restyle a sub-slide's leading emphasized paragraph under its kicker", () => {
    const { html } = compile(
      "## One\n\n### Two\n\n*The sub-slide's context.*\n\nBody.\n",
    );
    expect(html).toMatch(
      /<h3 id="two" data-slide-kicker[^>]*>1\.1 \/ Two<\/h3><\/div><\/div><div data-collapse-body[^>]*>\n?<p data-slide-context[^>]*>The sub-slide's context\.<\/p>/,
    );
  });

  it("should keep footnotes outside a Part collapse body", () => {
    const { html } = compile(
      '<Part title="Context" />\n\n## One\n\ntext[^1]\n\n[^1]: the note\n',
    );
    const partBody = html.indexOf('data-collapsible="part"');
    const footnotes = html.indexOf('class="footnotes"');
    const partBodyClose = html.lastIndexOf("</div>");
    expect(partBody).toBeGreaterThan(-1);
    expect(footnotes).toBeGreaterThan(partBody);
    // Footnotes follow the closed part group rather than sitting inside it.
    expect(html.indexOf('class="footnotes"')).toBeGreaterThan(
      html.indexOf("data-collapse-body"),
    );
    expect(html.slice(0, footnotes)).toContain("</div>");
    expect(partBodyClose).toBeGreaterThan(-1);
  });

  it("should leave an ordinary leading paragraph alone", () => {
    const { html } = compile("## One\n\nPlain prose first.\n");
    expect(html).not.toContain("data-slide-context");
  });

  it("should leave a partially emphasized leading paragraph alone", () => {
    const { html } = compile("## One\n\n*Half* emphasized.\n");
    expect(html).not.toContain("data-slide-context");
  });

  it("should leave a later emphasized paragraph alone", () => {
    const { html } = compile("## One\n\nPlain first.\n\n*Emphasis later.*\n");
    expect(html).not.toContain("data-slide-context");
  });
});

describe("deck TableOfContents completion", () => {
  const TOC_FIXTURE = `# Deck plan

The lede.

<TableOfContents>
<Entry section="Status quo" gist="Today's state" />
<Entry section="Success looks like" gist="The outcome" />
<Entry section="The design" gist="The mechanism" />
</TableOfContents>

<Part title="Context" />

## Status quo

Today's state.

## Success looks like

The outcome.

<Part title="The proposal" />

## The design

The mechanism.
`;

  it("should link every row to its section in document order", () => {
    const { html } = compile(TOC_FIXTURE);
    expect(html).toMatch(
      /<a data-table-of-contents-row[^>]*href="#status-quo"/,
    );
    expect(html).toMatch(
      /<a data-table-of-contents-row[^>]*href="#success-looks-like"/,
    );
    expect(html).toMatch(
      /<a data-table-of-contents-row[^>]*href="#the-design"/,
    );
  });

  it("should fill every row's slide number", () => {
    const { html } = compile(TOC_FIXTURE);
    expect(html).toMatch(/<span data-table-of-contents-num[^>]*>1\.1<\/span>/);
    expect(html).toMatch(/<span data-table-of-contents-num[^>]*>1\.2<\/span>/);
    expect(html).toMatch(/<span data-table-of-contents-num[^>]*>2\.1<\/span>/);
  });

  it("should insert one group header before each part's first row", () => {
    const { html } = compile(TOC_FIXTURE);
    expect(html.match(/data-table-of-contents-group/g)).toHaveLength(2);
    expect(html).toMatch(
      /<p data-table-of-contents-group[^>]*>\[1\] Context<\/p>/,
    );
    expect(html).toMatch(
      /<p data-table-of-contents-group[^>]*>\[2\] The proposal<\/p>/,
    );
    const header = html.indexOf("[1] Context");
    const firstRow = html.indexOf('href="#status-quo"');
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(firstRow);
  });

  it("should use plain sequential numbers when the plan has no parts", () => {
    const { html } = compile(
      '# P\n\nLede.\n\n<TableOfContents>\n<Entry section="One" gist="A" />\n<Entry section="Two" gist="B" />\n</TableOfContents>\n\n## One\n\nA.\n\n## Two\n\nB.\n',
    );
    expect(html).toMatch(/<span data-table-of-contents-num[^>]*>1<\/span>/);
    expect(html).toMatch(/<span data-table-of-contents-num[^>]*>2<\/span>/);
    expect(html).not.toContain("data-table-of-contents-group");
  });

  it("should keep the TableOfContents outside any slide frame", () => {
    const { html } = compile(
      '## Before\n\nA.\n\n<TableOfContents>\n<Entry section="Before" gist="A" />\n</TableOfContents>\n',
    );
    const overview = html.indexOf("data-table-of-contents");
    const slideEnd = html.indexOf("</section>");
    expect(slideEnd).toBeGreaterThan(-1);
    expect(slideEnd).toBeLessThan(overview);
  });

  it("should keep placeholders on rows beyond the document's sections", () => {
    const { html } = compile(
      '# P\n\nLede.\n\n<TableOfContents>\n<Entry section="One" gist="A" />\n<Entry section="Ghost" gist="B" />\n</TableOfContents>\n\n## One\n\nA.\n',
    );
    expect(html).toMatch(/<a data-table-of-contents-row[^>]*href="#one"/);
    expect(html).toMatch(/<a data-table-of-contents-row[^>]*href="#"/);
  });
});

describe("deck section metadata", () => {
  it("should attach each section's part in document order when acts exist", () => {
    const { sections } = compile(DECK_FIXTURE);
    expect(sections).toEqual([
      {
        id: "status-quo",
        name: "Status quo",
        title: "Status quo",
        part: { number: 1, title: "Context" },
      },
      {
        id: "success-looks-like",
        name: "Success looks like",
        title: "Success looks like",
        part: { number: 1, title: "Context" },
      },
      {
        id: "the-design",
        name: "The design",
        title: "The design",
        part: { number: 2, title: "The proposal" },
      },
    ]);
  });

  it("should leave sections partless when the document has no Part markers", () => {
    const { sections } = compile("## One\n\nA.\n");
    expect(sections).toEqual([{ id: "one", name: "One", title: "One" }]);
  });

  it("should leave sections before the first Part partless", () => {
    const { sections } = compile(
      '## Preamble\n\nA.\n\n<Part title="Context" />\n\n## Status quo\n\nB.\n',
    );
    expect(sections[0]).toEqual({
      id: "preamble",
      name: "Preamble",
      title: "Preamble",
    });
    expect(sections[1]).toMatchObject({
      part: { number: 1, title: "Context" },
    });
  });
});
