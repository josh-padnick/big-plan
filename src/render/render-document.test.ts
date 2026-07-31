// Unit tests for the assembled document: every GFM affordance's markup,
// self-containment guarantees, and degenerate inputs.

import { describe, expect, it } from "vitest";
import { compilePlanModel } from "./compile-plan-model.js";
import { renderDocument, validateDocument } from "./render-document.js";

const TABLE_SCROLL_CONTAINER = "data-table-scroll-container";

// One fixture that exercises every GFM affordance the viewer must style.
const FULL_FIXTURE = `# Plan title

Intro paragraph with *emphasis*, **strong**, ~~struck~~, and \`inline code\`.

## First section

> A blockquote with a [link](https://example.com/docs).

- bullet one
  - nested bullet
- bullet two

1. ordered one
2. ordered two

- [x] done task
- [ ] open task

### Level three

#### Level four

##### Level five

###### Level six

\`\`\`ts
const answer = 42;
\`\`\`

| Col A | Col B |
| ----- | ----- |
| a     | b     |

![tiny](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)

---

A footnote reference.[^1]

[^1]: The footnote text.
`;

describe("renderDocument affordances", () => {
  const { html } = renderDocument({
    markdown: FULL_FIXTURE,
    fallbackTitle: "Plan",
  });

  it("should emit markup for every GFM affordance when the fixture uses them all", () => {
    const expectedFragments = [
      "<h1",
      "<h2",
      "<h3",
      "<h4",
      "<h5",
      "<h6",
      "<p>",
      "<em>",
      "<strong>",
      "<del>",
      "<code>",
      "<pre",
      "<blockquote>",
      "<ul>",
      "<ol>",
      'input type="checkbox"',
      TABLE_SCROLL_CONTAINER,
      '<a href="https://example.com/docs">',
      '<img src="data:image/png;base64,',
      "<hr>",
      'class="footnotes"',
    ];
    for (const fragment of expectedFragments) {
      expect(html).toContain(fragment);
    }
  });

  it("should render a TOC nav linking to each h2 when the document has sections", () => {
    expect(html).toContain('aria-label="Contents"');
    expect(html).toMatch(/<a[^>]* href="#first-section">First section<\/a>/);
  });

  it("should render the mobile section disclosure", () => {
    expect(html).toContain(">Sections</span>");
    expect(html).toContain('data-overview-link href="#top"');
  });

  it("should allocate a distinct overview anchor when content ids occupy candidates", () => {
    const { html: collisionHtml } = renderDocument({
      markdown: "# Top\n\n### Top 2\n\n## Section\n\nContent.\n",
      fallbackTitle: "Collision",
    });
    expect(collisionHtml).toContain('data-overview-link href="#top-3"');
    expect(collisionHtml).toContain('<main class="min-w-0" id="top-3">');
    expect(collisionHtml.match(/id="top"/g)).toHaveLength(1);
    expect(collisionHtml.match(/id="top-2"/g)).toHaveLength(1);
  });

  it("should be self-contained when the document links to external sites", () => {
    // The browser only fetches src/link/script resources; <a href> is inert
    // navigation, so external content links do not break self-containment.
    const fetchedValues = [
      ...html.matchAll(/\b(?:src|srcset)="([^"]*)"/g),
      ...html.matchAll(/<link\b[^>]*\bhref="([^"]*)"/g),
    ].map((match) => match[1]);
    expect(fetchedValues.length).toBeGreaterThan(0);
    for (const value of fetchedValues) {
      expect(value).toMatch(/^data:/);
    }
    expect(html).not.toMatch(/<script\s+[^>]*src=/);
    expect(html).not.toContain("@import");
    // The embedded stylesheet fetches too: a bundled typeface reaches the
    // reader through a data URI in @font-face, never through a URL.
    const styleValues = [...html.matchAll(/url\(([^)]*)\)/g)].map(
      (match) => match[1],
    );
    expect(styleValues.length).toBeGreaterThan(0);
    for (const value of styleValues) {
      expect(value).toMatch(/^data:/);
    }
  });

  it("should let a desktop wireframe and its slide borrow measured page room", () => {
    // The shell publishes only the page room that actually exists, and the
    // slide grows with its drawing. That keeps the 920px painted cap inside
    // the slide instead of letting a negative margin look like overflow.
    const deckWireframe = `# Deck

The lede.

<Part title="Context" />

## A screen

<Wireframe id="wf" initialScreen="one">
  <Screen id="one" name="One" device="desktop">
    <Text text="Drawn inside a collapsible slide." />
  </Screen>
</Wireframe>
`;
    const { html: deckHtml } = renderDocument({
      markdown: deckWireframe,
      fallbackTitle: "Deck",
    });
    expect(deckHtml).toContain("data-collapsible");
    expect(deckHtml).toContain("data-wireframe=");
    expect(deckHtml).toContain("--reading-free-inline");
    expect(deckHtml).toContain("data-wireframe-desktop");
    expect(deckHtml).toContain(
      "[data-slide]:has(>[data-collapse-body] [data-wireframe-desktop]):not([data-slide] [data-slide])",
    );
    expect(deckHtml).toContain(
      ".wireframe[data-wireframe-desktop]:not([data-slide] *)",
    );
    // The true 1440px layout scales into the shared desktop review cap.
    expect(deckHtml).toContain("max-width:920px");
  });

  it("should inline one stylesheet and one viewer script when rendering", () => {
    expect(html.match(/<style>/g)).toHaveLength(1);
    // The shell's viewer behavior is the single script; plan content can never
    // contribute another, and nothing external is referenced.
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain("data-section-link");
    expect(html).not.toContain('src="http');
  });

  it("should name the plan quietly in the bar so a deep reader keeps its title", () => {
    expect(html).toContain("data-plan-title");
    expect(html).toMatch(/<p class="[^"]*truncate[^"]*"[^>]*data-plan-title/);
    // The bar repeats the h1, so it is chrome for the eye only; a screen
    // reader already has the title from the document and the page head.
    expect(html).toMatch(/data-plan-title[^>]*aria-hidden="true"/);
    // Truncation needs the full text reachable on hover.
    expect(html).toMatch(/data-plan-title title="Plan title"/);
  });

  it("should escape a plan title before putting it in the bar", () => {
    // The title lands in an attribute as well as in text, so a quote that
    // survived would close the attribute early.
    const { html: quoted } = renderDocument({
      markdown: '# Ship "A & B" plans\n\nBody.\n',
      fallbackTitle: "Fallback",
    });
    expect(quoted).toContain(
      'data-plan-title title="Ship &quot;A &amp; B&quot; plans"',
    );
    expect(quoted).not.toContain('title="Ship "A');
  });

  it("should emit theme-aware favicon links as embedded data URIs when rendering", () => {
    expect(html).toMatch(
      /<link rel="icon" type="image\/x-icon" href="data:image\/x-icon;base64,[^"]+">/,
    );
    expect(html).toMatch(
      /<link rel="icon" type="image\/x-icon" media="\(prefers-color-scheme: dark\)" href="data:image\/x-icon;base64,[^"]+">/,
    );
  });

  it("should render a theme-swapped branding banner when rendering", () => {
    expect(html).toMatch(
      /<a [^>]*href="https:\/\/big-plan\.ai" target="_blank" rel="noreferrer">/,
    );
    expect(html).toMatch(
      /<img class="w-27 h-auto" data-logo-light src="data:image\/svg\+xml;base64,[^"]+" alt="Big Plan" width="1200" height="220">/,
    );
    expect(html).toMatch(
      /<img class="w-27 h-auto" data-logo-dark src="data:image\/svg\+xml;base64,[^"]+" alt="Big Plan" width="1200" height="220">/,
    );
  });
});

describe("renderDocument grouped navigation", () => {
  const PARTED_FIXTURE = `# Deck plan

The lede.

<Part title="Context" />

## Status quo

Today.

<Part title="The proposal" />

## The design

Tomorrow.
`;

  it("should render linked part headers above their grouped section links", () => {
    const { html } = renderDocument({
      markdown: PARTED_FIXTURE,
      fallbackTitle: "Deck",
    });
    expect(html).toMatch(
      /<a[^>]* data-toc-part href="#part-context">\[1\] Context<\/a>/,
    );
    expect(html).toMatch(
      /<a[^>]* data-toc-part href="#part-the-proposal">\[2\] The proposal<\/a>/,
    );
    // Both TOCs group: desktop sidebar plus the mobile disclosure.
    expect(html.match(/data-toc-part/g)).toHaveLength(4);
    const header = html.indexOf('href="#part-context"');
    const section = html.indexOf('data-section-link href="#status-quo"');
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(section);
  });

  it("should keep part headers out of the scroll-spy contract", () => {
    const { html } = renderDocument({
      markdown: PARTED_FIXTURE,
      fallbackTitle: "Deck",
    });
    expect(html).not.toMatch(/data-section-link[^>]*href="#part-/);
    expect(html).toMatch(/data-section-link href="#status-quo"/);
    expect(html).toMatch(/data-section-link href="#the-design"/);
  });

  it("should render a plain ungrouped TOC when the plan has no parts", () => {
    const { html } = renderDocument({
      markdown: "# Plan\n\nLede.\n\n## Only section\n\nBody.\n",
      fallbackTitle: "Plan",
    });
    expect(html).not.toContain("data-toc-part");
  });
});

describe("renderDocument shell", () => {
  it("should stamp a path-and-content identity only for filesystem-backed rendering", () => {
    const input = {
      markdown: "# Shared title\n\nA concise plan thesis.\n",
      fallbackTitle: "Plan",
    };
    const first = renderDocument({
      ...input,
      planPath: "/plans/first.mdx",
    }).html;
    const second = renderDocument({
      ...input,
      planPath: "/plans/second.mdx",
    }).html;
    const idPattern = /data-plan-id="([a-f0-9]{32})"/;
    const firstId = first.match(idPattern)?.[1];
    const secondId = second.match(idPattern)?.[1];

    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(firstId).not.toBe(secondId);
    expect(renderDocument(input).html).toContain('<html lang="en">');
  });

  it("should escape the title when it contains HTML special characters", () => {
    const { html } = renderDocument({
      markdown: "hello",
      fallbackTitle: '<script>"a & b"</script>',
    });
    expect(html).toContain(
      "<title>&lt;script&gt;&quot;a &amp; b&quot;&lt;/script&gt;</title>",
    );
    expect(html).not.toContain('<script>"a');
  });

  it("should produce a complete document with no TOC when the markdown is empty", () => {
    const { html, sections } = renderDocument({
      markdown: "",
      fallbackTitle: "Empty",
    });
    expect(sections.length).toBe(0);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("</html>");
    expect(html).not.toContain("<nav");
    expect(html).toMatch(/data-comment-draft-control hidden/);
    expect(html).toContain("<script>");
    // The content column keeps its width even without a sidebar; prose holds
    // its own measure inside it rather than the column enforcing one.
    expect(html).toContain("wide:grid-cols-[minmax(0,72rem)]");
  });

  it("should omit the TOC when the document has headings but no h2s", () => {
    const { html, sections } = renderDocument({
      markdown: "# Only a title\n\n### And a subsection\n",
      fallbackTitle: "No sections",
    });
    expect(sections.length).toBe(0);
    expect(html).not.toContain("<nav");
    expect(html).toContain("<h1");
  });

  it("should ship the viewer script for a fenced block without a TOC", () => {
    const { html, sections } = renderDocument({
      markdown: "```\nA dense sketch\n```\n",
      fallbackTitle: "Sketch",
    });
    expect(sections.length).toBe(0);
    expect(html).not.toContain("<nav");
    expect(html).toContain('data-figure-maximizable="code"');
    expect(html).toContain("<script>");
  });
});

describe("validateDocument", () => {
  it("should collect the same model while completing HTML delivery", () => {
    const markdown =
      '# Plan\n\n## Scope\n\n<Decision question="Q?">\n\n<Callout type="note">\n\nNested context.\n\n</Callout>\n\n<Option title="A" />\n\n<Option title="B" />\n\n</Decision>\n';
    const input = { markdown, fallbackTitle: "Fallback" };

    expect(validateDocument(input)).toEqual(compilePlanModel(input));
  });
});
