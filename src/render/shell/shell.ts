// Owns the review shell: the reading surface a rendered document lives in -
// the branding bar, layout grid, responsive desktop and mobile navigation,
// and content region. It produces body-level markup plus the styles the
// markup needs, as data;
// packaging into a complete document is page.ts's job. Authored markup is
// styled with Tailwind utilities; the compiled stylesheet (including the
// element-scoped styles from markdown/prose.css) comes from the generated
// GLOBAL_CSS module.

import { LOGO_DARK_SRC, LOGO_LIGHT_SRC } from "../branding.generated.js";
import { escapeHtml } from "../escape-html.js";
import { GLOBAL_CSS } from "../global.generated.js";
import { VIEWER_SCRIPT } from "./viewer-script.js";

// The shell's own navigation contract: plain text in, so the shell owes
// nothing to whatever produced the document. Callers map their outline into
// this shape; entries carrying a part render grouped beneath non-link part
// headers while the scroll-spy contract stays per-section.
export type NavEntryPart = {
  readonly number: number;
  readonly title: string;
  // The part divider's anchor; when present, the act header links to it.
  readonly id?: string;
};

export type NavEntry = {
  readonly id: string;
  readonly label: string;
  readonly part?: NavEntryPart;
};

export type ShellResult = {
  readonly html: string;
  readonly styles: string;
  readonly bodyClassName: string;
};

const BODY_CLASSES =
  "bg-paper font-sans text-base leading-[1.65] text-ink antialiased";

// Stacked reading layout below the wide breakpoint; sidebar plus one content
// column above it. The no-TOC variant is always a single column.
//
// The column is wider than a line of prose should ever be, because a plan
// carries tables, diagrams, and drawings of desktop products that are all
// unreadable squeezed to a text measure. Prose is held back to its own
// measure inside the column by prose.css; everything else uses the room.
const LAYOUT_CLASSES =
  "grid grid-cols-[minmax(0,1fr)] justify-center gap-8 px-5 pt-16 pb-16 wide:gap-14 wide:px-6 wide:pt-12 wide:pb-20";
const LAYOUT_WITH_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[15rem_minmax(0,72rem)]`;
const LAYOUT_WITHOUT_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[minmax(0,72rem)]`;

// Active links change color and border only, never weight, so highlighting
// can never re-wrap a label. Entries grouped under a part header carry the
// rule and the inset that make them read as its children.
const TOC_LINK_CLASSES =
  "block border-l-2 border-edge px-3 py-[0.3rem] leading-snug text-muted hover:text-ink aria-[current=true]:border-accent aria-[current=true]:text-accent";
const TOC_GROUPED_LINK_CLASSES =
  "block border-l-2 border-edge py-[0.3rem] pr-3 pl-3.5 leading-snug text-muted hover:text-ink aria-[current=true]:border-accent aria-[current=true]:text-accent";
// A part header is a heading over the entries beneath it, not one of them, so
// it sits flush with the Contents label rather than sharing the rule and inset
// its section links use.
const TOC_PART_HEADER_CLASSES =
  "mt-3 mb-1 block pr-3 text-[0.6875rem] font-bold tracking-[0.1em] uppercase text-accent hover:text-ink";
const MOBILE_TOC_LINK_CLASSES =
  "block border-l-2 border-transparent px-5 py-2.5 leading-snug text-ink hover:bg-surface aria-[current=true]:border-accent aria-[current=true]:bg-surface aria-[current=true]:text-accent";
const MOBILE_TOC_GROUPED_LINK_CLASSES =
  "block border-l-2 border-transparent py-2.5 pr-5 pl-8 leading-snug text-ink hover:bg-surface aria-[current=true]:border-accent aria-[current=true]:bg-surface aria-[current=true]:text-accent";
const MOBILE_TOC_PART_HEADER_CLASSES =
  "block border-l-2 border-transparent px-5 pt-3 pb-1 text-[0.6875rem] font-bold tracking-[0.1em] uppercase text-accent hover:text-ink";

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
// contain characters that are not literal-safe inside href values. A part's
// first entry is preceded by a non-link header naming the act, and grouped
// entries indent beneath it; the data-section-link scroll-spy contract is
// identical either way.
const renderTocItems = ({
  nav,
  linkClasses,
  groupedLinkClasses,
  partHeaderClasses,
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  readonly linkClasses: string;
  readonly groupedLinkClasses: string;
  readonly partHeaderClasses: string;
}): string => {
  const items: Array<string> = [];
  let headedPart: number | undefined;
  for (const entry of nav) {
    if (entry.part !== undefined && entry.part.number !== headedPart) {
      headedPart = entry.part.number;
      const headerText = `[${entry.part.number}] ${escapeHtml(entry.part.title)}`;
      // Part headers link to their divider band without joining the
      // per-section scroll-spy contract, so they never carry
      // data-section-link.
      items.push(
        entry.part.id === undefined
          ? `<li><span class="${partHeaderClasses}" data-toc-part>${headerText}</span></li>`
          : `<li><a class="${partHeaderClasses}" data-toc-part href="#${encodeURIComponent(entry.part.id)}">${headerText}</a></li>`,
      );
    }
    const classes = entry.part === undefined ? linkClasses : groupedLinkClasses;
    items.push(
      `<li><a class="${classes}" data-section-link href="#${encodeURIComponent(entry.id)}">${escapeHtml(entry.label)}</a></li>`,
    );
  }
  return items.join("\n");
};

// Builds the desktop sidebar navigation; its "Contents" label doubles as the
// way back to the very top of the document.
const renderDesktopToc = ({
  nav,
  overviewId,
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  readonly overviewId: string;
}): string => {
  const items = renderTocItems({
    nav,
    linkClasses: TOC_LINK_CLASSES,
    groupedLinkClasses: TOC_GROUPED_LINK_CLASSES,
    partHeaderClasses: TOC_PART_HEADER_CLASSES,
  });
  return `<nav class="hidden text-sm leading-normal wide:sticky wide:top-[5.75rem] wide:block wide:self-start" aria-label="Contents">
<p class="mb-3 border-b border-edge pb-2 text-xs font-semibold uppercase tracking-[0.08em]"><a class="rounded-sm text-muted hover:text-ink aria-[current=true]:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" data-overview-link href="#${encodeURIComponent(overviewId)}">Contents</a></p>
<ol>
${items}
</ol>
</nav>`;
};

// Builds the sticky mobile TOC as a native disclosure.
const renderMobileToc = ({
  nav,
  overviewId,
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  readonly overviewId: string;
}): string => {
  const items = renderTocItems({
    nav,
    linkClasses: MOBILE_TOC_LINK_CLASSES,
    groupedLinkClasses: MOBILE_TOC_GROUPED_LINK_CLASSES,
    partHeaderClasses: MOBILE_TOC_PART_HEADER_CLASSES,
  });
  return `<nav class="sticky top-11 z-10 h-11 border-b border-edge bg-paper/95 text-sm leading-normal shadow-[0_1px_0_rgb(0_0_0/0.03)] backdrop-blur-sm wide:hidden" data-mobile-toc aria-label="Contents">
<details class="group relative mx-auto h-full max-w-[72rem]">
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
 * bar, responsive navigation when nav entries exist, and content region.
 * Returns markup plus the styles the caller packages into a page.
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
  // The viewer script ships only when an affordance in this document uses it.
  const needsViewerScript =
    hasToc ||
    contentHtml.includes("data-info-popover") ||
    contentHtml.includes("data-collapsible");
  const overviewId = createOverviewId(contentIds);
  const html = `<header class="sticky top-0 z-10 h-11 border-b border-edge bg-paper/90 backdrop-blur">
<div class="flex h-full items-center px-5 wide:px-6">
<a class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="https://big-plan.ai" target="_blank" rel="noreferrer">
<img class="w-27 h-auto" data-logo-light src="${LOGO_LIGHT_SRC}" alt="Big Plan" width="1200" height="220">
<img class="w-27 h-auto" data-logo-dark src="${LOGO_DARK_SRC}" alt="Big Plan" width="1200" height="220">
</a>
</div>
</header>
${hasToc ? renderMobileToc({ nav, overviewId }) : ""}
<div class="${hasToc ? LAYOUT_WITH_TOC : LAYOUT_WITHOUT_TOC}">
${hasToc ? renderDesktopToc({ nav, overviewId }) : ""}
<main class="min-w-0" id="${overviewId}">
<article>
${contentHtml}
</article>
</main>
</div>
${needsViewerScript ? VIEWER_SCRIPT : ""}`;
  return {
    html,
    styles: GLOBAL_CSS,
    bodyClassName: BODY_CLASSES,
  };
};
