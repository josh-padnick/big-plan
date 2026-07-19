// Owns the review shell: the reading surface a rendered document lives in -
// the branding bar, layout grid, theme control, responsive desktop and mobile
// navigation, code-block and component controls, and content region. It
// produces body-level markup plus the styles and progressive-enhancement
// scripts that markup needs, as data;
// packaging into a complete document is page.ts's job. Authored markup is
// styled with Tailwind utilities; the compiled stylesheet (including the
// element-scoped styles from markdown/prose.css) comes from the generated
// GLOBAL_CSS module.

import { LOGO_DARK_SRC, LOGO_LIGHT_SRC } from "../branding.generated.js";
import { escapeHtml } from "../escape-html.js";
import { GLOBAL_CSS } from "../global.generated.js";
import { CODE_DIFF_JS } from "../markdown/components/code-diff/code-diff.generated.js";
import { CODE_SNIPPET_JS } from "../markdown/components/code-snippet/code-snippet.generated.js";
import { FILE_TREE_JS } from "../markdown/components/file-tree/file-tree.generated.js";
import { COPY_CODE_JS } from "../markdown/code-block/copy-code.generated.js";
import { SCROLL_SPY_JS } from "./scroll-spy.generated.js";
import { THEME_TOGGLE_JS } from "./theme-toggle.generated.js";

// The shell's own navigation contract: plain text in, so the shell owes
// nothing to whatever produced the document. Callers map their outline into
// this shape.
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
const MOBILE_TOC_LINK_CLASSES =
  "block border-l-2 border-transparent px-5 py-2.5 text-ink hover:bg-surface aria-[current=true]:border-accent aria-[current=true]:bg-surface aria-[current=true]:font-semibold aria-[current=true]:text-accent";

const THEME_TOGGLE_CLASSES =
  "fixed top-1.5 right-3 z-20 rounded-md border border-edge bg-surface px-3 py-1.5 text-xs font-semibold text-muted shadow-sm hover:text-ink focus:outline-2 focus:outline-offset-2 focus:outline-accent";

// Allocates the shell-owned overview anchor alongside document-owned ids.
const createOverviewId = (contentIds: ReadonlyArray<string>): string => {
  const documentIds = new Set(contentIds);
  let candidate = "top";
  let suffix = 2;
  while (documentIds.has(candidate)) {
    candidate = `top-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

// Builds links shared by both TOCs; ids are URI-encoded because slugs may
// contain characters that are not literal-safe inside href values.
const renderTocItems = ({
  nav,
  linkClasses,
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  readonly linkClasses: string;
}): string =>
  nav
    .map(
      (entry) =>
        `<li><a class="${linkClasses}" data-section-link href="#${encodeURIComponent(entry.id)}">${escapeHtml(entry.label)}</a></li>`,
    )
    .join("\n");

// Builds the desktop sidebar navigation.
const renderDesktopToc = (nav: ReadonlyArray<NavEntry>): string => {
  const items = renderTocItems({ nav, linkClasses: TOC_LINK_CLASSES });
  return `<nav class="hidden text-sm leading-normal wide:sticky wide:top-[5.75rem] wide:block wide:self-start" aria-label="Contents">
<p class="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Contents</p>
<ol>
${items}
</ol>
</nav>`;
};

// Builds the sticky, progressively enhanced mobile TOC.
const renderMobileToc = ({
  nav,
  overviewId,
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  readonly overviewId: string;
}): string => {
  const items = renderTocItems({ nav, linkClasses: MOBILE_TOC_LINK_CLASSES });
  return `<nav class="sticky top-11 z-10 h-11 border-b border-edge bg-paper/95 text-sm leading-normal shadow-[0_1px_0_rgb(0_0_0/0.03)] backdrop-blur-sm wide:hidden" data-mobile-toc aria-label="Contents">
<details class="group relative mx-auto h-full max-w-[70ch]">
<summary class="flex h-full cursor-pointer list-none items-center gap-3 px-5 py-2 [&amp;::-webkit-details-marker]:hidden">
<span class="font-semibold text-ink">Sections</span>
<span class="flex min-w-6 items-center justify-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium tabular-nums text-muted">${nav.length}</span>
<svg class="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" aria-hidden="true" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 4.96a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06L11.18 10 7.21 6.02a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" /></svg>
</summary>
<div class="absolute inset-x-0 top-full max-h-[min(70vh,24rem)] overflow-y-auto overscroll-contain border-y border-edge bg-paper py-2 shadow-lg">
<ol>
<li><a class="${MOBILE_TOC_LINK_CLASSES}" data-overview-link href="#${encodeURIComponent(overviewId)}">Overview</a></li>
${items}
</ol>
</div>
</details>
</nav>`;
};

/**
 * Wraps rendered content in the review shell: the layout grid and branding
 * bar, responsive navigation when nav entries exist, theme control, and
 * code-block controls. Returns markup plus the styles and
 * progressive-enhancement scripts the caller packages into a page.
 */
export const renderShell = ({
  nav,
  contentIds,
  contentHtml,
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  readonly contentIds: ReadonlyArray<string>;
  readonly contentHtml: string;
}): ShellResult => {
  const hasToc = nav.length > 0;
  const overviewId = createOverviewId(contentIds);
  const html = `<button class="${THEME_TOGGLE_CLASSES}" type="button" data-theme-toggle aria-label="Toggle color theme">Theme</button>
<header class="sticky top-0 z-10 h-11 border-b border-edge bg-paper/90 backdrop-blur">
<div class="flex h-full items-center px-5 wide:px-6">
<a class="rounded-sm focus:outline-2 focus:outline-offset-2 focus:outline-accent" href="https://big-plan.ai" target="_blank" rel="noreferrer">
<img class="w-27 h-auto" data-logo-light src="${LOGO_LIGHT_SRC}" alt="Big Plan" width="1200" height="220">
<img class="w-27 h-auto" data-logo-dark src="${LOGO_DARK_SRC}" alt="Big Plan" width="1200" height="220">
</a>
</div>
</header>
${hasToc ? renderMobileToc({ nav, overviewId }) : ""}
<div class="${hasToc ? LAYOUT_WITH_TOC : LAYOUT_WITHOUT_TOC}">
${hasToc ? renderDesktopToc(nav) : ""}
<main class="min-w-0" id="${overviewId}">
<article>
${contentHtml}
</article>
</main>
</div>`;
  return {
    html,
    styles: GLOBAL_CSS,
    scripts: hasToc
      ? [
          THEME_TOGGLE_JS,
          COPY_CODE_JS,
          CODE_DIFF_JS,
          CODE_SNIPPET_JS,
          FILE_TREE_JS,
          SCROLL_SPY_JS,
        ]
      : [
          THEME_TOGGLE_JS,
          COPY_CODE_JS,
          CODE_DIFF_JS,
          CODE_SNIPPET_JS,
          FILE_TREE_JS,
        ],
    bodyClassName: BODY_CLASSES,
  };
};
