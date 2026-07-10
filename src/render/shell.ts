// Owns the viewer's page chrome: the inlined stylesheet, the sticky TOC, and
// the scroll-spy enhancement, assembled around pre-rendered body HTML into a
// complete self-contained document.

import type { Section } from "./markdown.js";

// Escapes text destined for HTML attribute or element positions; body HTML
// is already safely serialized by rehype-stringify.
const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// The viewer is a document, not an app: one reading column, paper-like
// palettes, a modest type scale, and restrained borders. Light and dark are
// chosen by the reader's OS via prefers-color-scheme.
const SHELL_CSS = `
:root {
  --bg: #f7f5f0;
  --ink: #211e1a;
  --muted: #6f695c;
  --border: #e2ddd1;
  --surface: #efece3;
  --accent: #99502d;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1b1916;
    --ink: #ebe6da;
    --muted: #a49c8b;
    --border: #35312a;
    --surface: #242119;
    --accent: #d59468;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 1rem;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}

.layout {
  display: grid;
  grid-template-columns: 14rem minmax(0, 70ch);
  gap: 3.5rem;
  justify-content: center;
  padding: 3rem 1.5rem 5rem;
}
.layout.no-toc {
  grid-template-columns: minmax(0, 70ch);
}

/* Table of contents */
.toc {
  position: sticky;
  top: 3rem;
  align-self: start;
  font-size: 0.875rem;
  line-height: 1.5;
}
.toc-title {
  margin: 0 0 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.toc ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.toc li { margin: 0; }
.toc a {
  display: block;
  padding: 0.3rem 0.75rem;
  border-left: 2px solid var(--border);
  color: var(--muted);
  text-decoration: none;
}
.toc a:hover { color: var(--ink); }
.toc a[aria-current="true"] {
  border-left-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

@media (max-width: 56rem) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 2rem;
    padding: 2rem 1.25rem 4rem;
  }
  .toc {
    position: static;
    border-bottom: 1px solid var(--border);
    padding-bottom: 1.5rem;
  }
}

/* Prose */
main { min-width: 0; }

h1, h2, h3, h4, h5, h6 {
  line-height: 1.3;
  font-weight: 600;
  margin: 2.25em 0 0.6em;
}
h1 { font-size: 1.75rem; margin-top: 0; }
h2 {
  font-size: 1.35rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3em;
}
h3 { font-size: 1.15rem; }
h4 { font-size: 1rem; }
h5 { font-size: 0.9375rem; }
h6 { font-size: 0.875rem; color: var(--muted); }

p { margin: 0 0 1em; }

a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }

del { color: var(--muted); }

hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 2.5rem 0;
}

img { max-width: 100%; height: auto; }

/* Code */
code, pre, kbd, samp {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875em;
}
code {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.1em 0.35em;
}
pre {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  line-height: 1.55;
  margin: 0 0 1.25em;
}
pre code {
  background: none;
  border: 0;
  padding: 0;
  font-size: inherit;
}

/* Blockquotes */
blockquote {
  margin: 0 0 1em;
  padding: 0.25em 0 0.25em 1.25em;
  border-left: 3px solid var(--border);
  color: var(--muted);
}
blockquote > :last-child { margin-bottom: 0; }

/* Lists */
ul, ol {
  margin: 0 0 1em;
  padding-left: 1.75em;
}
li { margin: 0.25em 0; }
li > ul, li > ol { margin-bottom: 0; }

ul.contains-task-list {
  list-style: none;
  padding-left: 0.5em;
}
.task-list-item input[type="checkbox"] {
  accent-color: var(--accent);
  margin-right: 0.5em;
  vertical-align: -0.1em;
}

/* Tables */
.table-scroll {
  overflow-x: auto;
  margin: 0 0 1.25em;
  border: 1px solid var(--border);
  border-radius: 6px;
}
table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 0.9375rem;
}
th, td {
  border-bottom: 1px solid var(--border);
  padding: 0.5rem 0.9rem;
  text-align: left;
  vertical-align: top;
}
th {
  background: var(--surface);
  font-weight: 600;
}
tbody tr:last-child th,
tbody tr:last-child td { border-bottom: 0; }

/* Footnotes, as emitted by remark-rehype for GFM footnotes */
.footnotes {
  margin-top: 3rem;
  border-top: 1px solid var(--border);
  padding-top: 1rem;
  font-size: 0.875rem;
  color: var(--muted);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

:target { scroll-margin-top: 1.5rem; }
`;

// Progressive enhancement only: highlights the TOC entry for the section the
// reader is in. The document reads fine with JavaScript disabled.
const SCROLL_SPY_SCRIPT = `
(() => {
  const links = Array.from(document.querySelectorAll('.toc a[href^="#"]'));
  const headings = links
    .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
    .filter((heading) => heading !== null);
  if (headings.length === 0) return;
  const setActive = (id) => {
    for (const link of links) {
      if (decodeURIComponent(link.hash.slice(1)) === id) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  };
  let queued = false;
  const update = () => {
    queued = false;
    let current = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= 96) current = heading;
      else break;
    }
    setActive(current.id);
  };
  document.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
})();
`;

// Builds the sidebar nav; ids are URI-encoded because slugs may contain
// characters that are not literal-safe inside href values.
const renderToc = (sections: ReadonlyArray<Section>): string => {
  const items = sections
    .map(
      (section) =>
        `<li><a href="#${encodeURIComponent(section.id)}">${escapeHtml(section.text)}</a></li>`,
    )
    .join("\n");
  return `<nav class="toc" aria-label="Contents">
<p class="toc-title">Contents</p>
<ol>
${items}
</ol>
</nav>`;
};

/**
 * Wraps rendered body HTML in the self-contained viewer shell: inlined CSS,
 * a sticky TOC when the document has sections, and the scroll-spy script.
 */
export const renderShell = ({
  title,
  sections,
  bodyHtml,
}: {
  readonly title: string;
  readonly sections: ReadonlyArray<Section>;
  readonly bodyHtml: string;
}): string => {
  const hasToc = sections.length > 0;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${SHELL_CSS}</style>
</head>
<body>
<div class="layout${hasToc ? "" : " no-toc"}">
${hasToc ? renderToc(sections) : ""}
<main>
<article>
${bodyHtml}
</article>
</main>
</div>
${hasToc ? `<script>${SCROLL_SPY_SCRIPT}</script>` : ""}
</body>
</html>
`;
};
