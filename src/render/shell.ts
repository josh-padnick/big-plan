// Owns the viewer's page chrome: the inlined stylesheet, the sticky TOC, and
// the scroll-spy enhancement, assembled around pre-rendered body HTML into a
// complete self-contained document. Authored markup is styled with Tailwind
// utilities; the compiled stylesheet (including the element-scoped prose
// styles from shell.css) is inlined via the generated SHELL_CSS module.

import type { Section } from "./markdown.js";
import { SHELL_CSS } from "./shell.generated.js";

// Escapes text destined for HTML attribute or element positions; body HTML
// is already safely serialized by rehype-stringify.
const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// Progressive enhancement only: highlights the TOC entry for the section the
// reader is in. The document reads fine with JavaScript disabled.
const SCROLL_SPY_SCRIPT = `
(() => {
  const links = Array.from(document.querySelectorAll('nav[aria-label="Contents"] a[href^="#"]'));
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

// Stacked reading layout below the wide breakpoint; sidebar plus one reading
// column (~70ch) above it. The no-TOC variant is always a single column.
const LAYOUT_CLASSES =
  "grid grid-cols-[minmax(0,1fr)] justify-center gap-8 px-5 pt-8 pb-16 wide:gap-14 wide:px-6 wide:pt-12 wide:pb-20";
const LAYOUT_WITH_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[14rem_minmax(0,70ch)]`;
const LAYOUT_WITHOUT_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[minmax(0,70ch)]`;

const TOC_LINK_CLASSES =
  "block border-l-2 border-edge px-3 py-[0.3rem] text-muted hover:text-ink aria-[current=true]:border-accent aria-[current=true]:font-semibold aria-[current=true]:text-accent";

// Builds the sidebar nav; ids are URI-encoded because slugs may contain
// characters that are not literal-safe inside href values.
const renderToc = (sections: ReadonlyArray<Section>): string => {
  const items = sections
    .map(
      (section) =>
        `<li><a class="${TOC_LINK_CLASSES}" href="#${encodeURIComponent(section.id)}">${escapeHtml(section.text)}</a></li>`,
    )
    .join("\n");
  return `<nav class="border-b border-edge pb-6 text-sm leading-normal wide:sticky wide:top-12 wide:self-start wide:border-b-0 wide:pb-0" aria-label="Contents">
<p class="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Contents</p>
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
<body class="bg-paper font-sans text-base leading-[1.65] text-ink antialiased">
<div class="${hasToc ? LAYOUT_WITH_TOC : LAYOUT_WITHOUT_TOC}">
${hasToc ? renderToc(sections) : ""}
<main class="min-w-0">
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
