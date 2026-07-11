// Owns the review shell: the reading surface a rendered document lives in -
// the layout grid, theme control, sticky TOC, and content region. It produces
// body-level markup plus the styles and progressive-enhancement scripts that
// markup needs, as data; packaging into a complete document is page.ts's job.
// Authored markup is styled with Tailwind utilities; the compiled stylesheet
// (including the element-scoped prose styles from global.css) comes from the
// generated GLOBAL_CSS module.

import { escapeHtml } from "../escape-html.js";
import { GLOBAL_CSS } from "../global.generated.js";
import { COPY_CODE_JS } from "../markdown/code-block/copy-code.generated.js";
import { SCROLL_SPY_JS } from "./scroll-spy.generated.js";
import { THEME_TOGGLE_JS } from "./theme-toggle.generated.js";

// The shell's own navigation contract: plain text in, so the shell owes
// nothing to whatever produced the document. Callers map their outline
// (markdown sections today, typed-plan sections later) into this shape.
export type NavEntry = {
  readonly id: string;
  readonly label: string;
};

export type ShellResult = {
  readonly html: string;
  readonly styles: string;
  readonly scripts: ReadonlyArray<string>;
  readonly bodyClassName: string;
};

const BODY_CLASSES =
  "bg-paper font-sans text-base leading-[1.65] text-ink antialiased";

// Stacked reading layout below the wide breakpoint; sidebar plus one reading
// column (~70ch) above it. The no-TOC variant is always a single column.
const LAYOUT_CLASSES =
  "grid grid-cols-[minmax(0,1fr)] justify-center gap-8 px-5 pt-16 pb-16 wide:gap-14 wide:px-6 wide:pt-12 wide:pb-20";
const LAYOUT_WITH_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[14rem_minmax(0,70ch)]`;
const LAYOUT_WITHOUT_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[minmax(0,70ch)]`;

const TOC_LINK_CLASSES =
  "block border-l-2 border-edge px-3 py-[0.3rem] text-muted hover:text-ink aria-[current=true]:border-accent aria-[current=true]:font-semibold aria-[current=true]:text-accent";

const THEME_TOGGLE_CLASSES =
  "fixed top-3 right-3 z-10 rounded-md border border-edge bg-surface px-3 py-2 text-xs font-semibold text-muted shadow-sm hover:text-ink focus:outline-2 focus:outline-offset-2 focus:outline-accent";

// Builds the sidebar nav; ids are URI-encoded because slugs may contain
// characters that are not literal-safe inside href values.
const renderToc = (nav: ReadonlyArray<NavEntry>): string => {
  const items = nav
    .map(
      (entry) =>
        `<li><a class="${TOC_LINK_CLASSES}" href="#${encodeURIComponent(entry.id)}">${escapeHtml(entry.label)}</a></li>`,
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
 * Wraps rendered content in the review shell: the layout grid, theme control,
 * and a sticky TOC when nav entries exist. Returns markup plus the styles and
 * progressive-enhancement scripts it needs for the caller to package.
 */
export const renderShell = ({
  nav,
  contentHtml,
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  readonly contentHtml: string;
}): ShellResult => {
  const hasToc = nav.length > 0;
  const html = `<button class="${THEME_TOGGLE_CLASSES}" type="button" data-theme-toggle aria-label="Toggle color theme">Theme</button>
<div class="${hasToc ? LAYOUT_WITH_TOC : LAYOUT_WITHOUT_TOC}">
${hasToc ? renderToc(nav) : ""}
<main class="min-w-0">
<article>
${contentHtml}
</article>
</main>
</div>`;
  return {
    html,
    styles: GLOBAL_CSS,
    scripts: hasToc
      ? [THEME_TOGGLE_JS, COPY_CODE_JS, SCROLL_SPY_JS]
      : [THEME_TOGGLE_JS, COPY_CODE_JS],
    bodyClassName: BODY_CLASSES,
  };
};
