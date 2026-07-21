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
  });

  it("should inline one stylesheet plus the theme, copy, diff, snippet, file-tree, and scroll-spy scripts when rendering", () => {
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<script>/g)).toHaveLength(6);
    expect(html).toContain("data-theme-toggle");
    expect(html).toContain("data-copy-code");
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

describe("renderDocument embed envelope", () => {
  // A sectioned document with a full-screen-capable component, so chrome
  // omission and control hiding are both observable.
  const EMBED_FIXTURE = `## A section

<CodeDiff file="src/cache.ts">

\`\`\`diff
-const ttl = 30;
+const ttl = 60;
\`\`\`

</CodeDiff>
`;

  const { html } = renderDocument({
    markdown: EMBED_FIXTURE,
    fallbackTitle: "Embed",
    envelope: { mode: "embed" },
  });

  it("should omit the branding bar, navigation, and theme control when rendering an embed", () => {
    expect(html).not.toContain("big-plan.ai");
    expect(html).not.toContain("<header");
    expect(html).not.toContain('alt="Big Plan"');
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("data-theme-toggle");
    expect(html).toContain("data-embed");
    expect(html).toContain("<article>");
  });

  it("should ship only the copy and component scripts when rendering an embed", () => {
    // Theme toggle and scroll spy stay out: there is no control for the one
    // and no navigation for the other.
    expect(html.match(/<script>/g)).toHaveLength(4);
    expect(html).toContain("data-copy-code");
    expect(html).toContain("data-diff-set-view");
  });

  it("should keep the full-screen control and style browser full screen when rendering an embed", () => {
    // The embed keeps the control but drives the browser Fullscreen API (the
    // viewer's modal dialog could not escape a host iframe), so the
    // stylesheet must give the fullscreened component its own backdrop and
    // must not hide the control.
    expect(html).toContain("data-diff-expand");
    expect(html).toMatch(/\[data-embed\][^{}]*:fullscreen/);
    expect(html).not.toMatch(/\[data-embed\][^{}]*\[data-diff-expand\]/);
  });

  it("should leave the color scheme to the OS when no theme is forced", () => {
    expect(html).toContain('<html lang="en">');
  });

  it("should stamp the forced theme on the root when one is requested", () => {
    for (const theme of ["light", "dark"] as const) {
      const { html: themedHtml } = renderDocument({
        markdown: EMBED_FIXTURE,
        fallbackTitle: "Embed",
        envelope: { mode: "embed", theme },
      });
      expect(themedHtml).toContain(`<html lang="en" data-theme="${theme}">`);
    }
  });

  it("should stay self-contained when rendering an embed", () => {
    const fetchedValues = [
      ...html.matchAll(/\b(?:src|srcset)="([^"]*)"/g),
      ...html.matchAll(/<link\b[^>]*\bhref="([^"]*)"/g),
    ].map((match) => match[1]);
    for (const value of fetchedValues) {
      expect(value).toMatch(/^data:/);
    }
    expect(html).not.toMatch(/<script\s+[^>]*src=/);
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
    expect(html.match(/<script>/g)).toHaveLength(5);
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
