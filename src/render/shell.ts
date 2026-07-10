// Owns the review shell: the reading surface a rendered document lives in -
// the layout grid, the sticky TOC with its scroll-spy enhancement, and the
// content region. It produces body-level markup plus the styles and scripts
// that markup needs, as data; packaging into a complete document is page.ts's
// job. Authored markup is styled with Tailwind utilities; the compiled
// stylesheet (including the element-scoped prose styles from shell.css) comes
// from the generated SHELL_CSS module.

import { escapeHtml } from "./escape-html.js";
import type { Section } from "./markdown/convert.js";
import { SHELL_CSS } from "./shell.generated.js";

export type ShellResult = {
  readonly html: string;
  readonly styles: string;
  readonly scripts: ReadonlyArray<string>;
  readonly bodyClassName: string;
};

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

const BODY_CLASSES =
  "bg-paper font-sans text-base leading-[1.65] text-ink antialiased";

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
 * Wraps rendered content in the review shell: the layout grid, a sticky TOC
 * when the document has sections, and the scroll-spy script. Returns markup
 * plus the styles and scripts it needs; the caller packages them into a page.
 */
export const renderShell = ({
  sections,
  contentHtml,
}: {
  readonly sections: ReadonlyArray<Section>;
  readonly contentHtml: string;
}): ShellResult => {
  const hasToc = sections.length > 0;
  const html = `<div class="${hasToc ? LAYOUT_WITH_TOC : LAYOUT_WITHOUT_TOC}">
${hasToc ? renderToc(sections) : ""}
<main class="min-w-0">
<article>
${contentHtml}
</article>
</main>
</div>`;
  return {
    html,
    styles: SHELL_CSS,
    scripts: hasToc ? [SCROLL_SPY_SCRIPT] : [],
    bodyClassName: BODY_CLASSES,
  };
};
