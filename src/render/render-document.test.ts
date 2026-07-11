// Unit tests for the assembled document: every GFM affordance's markup,
// self-containment guarantees, and degenerate inputs.

import { describe, expect, it } from "vitest";
import { renderDocument } from "./render-document.js";

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
  const { html } = renderDocument({ markdown: FULL_FIXTURE, fallbackTitle: "Plan" });

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
      "<pre>",
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

  it("should render the mobile environment header and current-section disclosure", () => {
    expect(html).toContain("Grimm 10.0");
    expect(html).toContain("On this page");
    expect(html).toContain("data-current-section");
    expect(html).toContain('data-overview-link href="#top"');
  });

  it("should escape a custom environment label", () => {
    const { html: customHtml } = renderDocument({
      markdown: FULL_FIXTURE,
      fallbackTitle: "Fallback",
      environmentLabel: '<script>"unsafe"</script>',
    });
    expect(customHtml).toContain("&lt;script&gt;&quot;unsafe&quot;&lt;/script&gt;");
    expect(customHtml).not.toContain('<script>"unsafe"</script>');
  });

  it("should be self-contained when the document links to external sites", () => {
    // The browser only fetches src/link/script resources; <a href> is inert
    // navigation, so external content links do not break self-containment.
    const srcValues = [...html.matchAll(/\bsrc="([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(srcValues.length).toBeGreaterThan(0);
    for (const src of srcValues) {
      expect(src).toMatch(/^data:/);
    }
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/<script\s+[^>]*src=/);
    expect(html).not.toContain("@import");
  });

  it("should inline one stylesheet plus the theme, copy, and scroll-spy scripts when rendering", () => {
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<script>/g)).toHaveLength(3);
    expect(html).toContain("data-theme-toggle");
    expect(html).toContain("data-copy-code");
  });
});

describe("renderDocument shell", () => {
  it("should escape the title when it contains HTML special characters", () => {
    const { html } = renderDocument({
      markdown: "hello",
      fallbackTitle: '<script>"a & b"</script>',
    });
    expect(html).toContain(
      "<title>&lt;script&gt;&quot;a &amp; b&quot;&lt;/script&gt;</title>",
    );
    expect(html).not.toContain("<script>\"a");
  });

  it("should produce a complete document with no TOC when the markdown is empty", () => {
    const { html, sections } = renderDocument({ markdown: "", fallbackTitle: "Empty" });
    expect(sections.length).toBe(0);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("</html>");
    expect(html).not.toContain("<nav");
    expect(html.match(/<script>/g)).toHaveLength(2);
    // The reading column keeps its ~70ch measure even without a sidebar.
    expect(html).toContain("wide:grid-cols-[minmax(0,70ch)]");
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
});
