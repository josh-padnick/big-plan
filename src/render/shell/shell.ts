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
  readonly bodyClassName: string;
};

const BODY_CLASSES =
  "bg-paper font-sans text-base leading-[1.65] text-ink antialiased";

// Stacked reading layout below the wide breakpoint; sidebar plus one reading
// column (~74ch) above it. The no-TOC variant is always a single column.
const LAYOUT_CLASSES =
  "grid grid-cols-[minmax(0,1fr)] justify-center gap-8 px-5 pt-16 pb-16 wide:gap-14 wide:px-6 wide:pt-12 wide:pb-20";
const LAYOUT_WITH_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[15rem_minmax(0,74ch)]`;
const LAYOUT_WITHOUT_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[minmax(0,74ch)]`;

// Active links change color and border only, never weight, so highlighting
// can never re-wrap a label.
const TOC_LINK_CLASSES =
  "block border-l-2 border-edge px-3 py-[0.3rem] leading-snug text-muted hover:text-ink aria-[current=true]:border-accent aria-[current=true]:text-accent";
const MOBILE_TOC_LINK_CLASSES =
  "block border-l-2 border-transparent px-5 py-2.5 leading-snug text-ink hover:bg-surface aria-[current=true]:border-accent aria-[current=true]:bg-surface aria-[current=true]:text-accent";

// The one script a rendered document ships, carrying the viewer enhancements:
// a scroll-spy that marks the section being read with aria-current on its TOC
// links (falling back to the overview links above the first section), and
// hover popovers that float [data-info-popover] disclosures beside their
// triggers, positioned to stay inside the viewport. Plan content never
// contributes script, and every affordance keeps a no-JS fallback.
const VIEWER_SCRIPT = `<script>
(() => {
  const links = Array.from(document.querySelectorAll("[data-section-link]"));
  const overviewLinks = Array.from(
    document.querySelectorAll("[data-overview-link]"),
  );
  const targets = new Map();
  for (const link of links) {
    const id = decodeURIComponent((link.getAttribute("href") || "").slice(1));
    const heading = document.getElementById(id);
    if (heading === null) continue;
    targets.set(heading, (targets.get(heading) || []).concat(link));
  }
  const headings = Array.from(targets.keys());
  if (headings.length === 0) return;
  const apply = () => {
    const readingLine = window.innerHeight * 0.25;
    let current = null;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= readingLine) current = heading;
    }
    for (const [heading, sectionLinks] of targets) {
      for (const link of sectionLinks) {
        if (heading === current) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
    }
    for (const link of overviewLinks) {
      if (current === null) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  apply();
})();
(() => {
  const infos = document.querySelectorAll("details[data-info-popover]");
  for (const info of infos) {
    const summary = info.querySelector("summary");
    const body = info.querySelector("[data-info-popover-body]");
    if (summary === null || body === null) continue;
    info.setAttribute("data-info-popover-floating", "");
    const open = () => {
      info.open = true;
      const anchor = summary.getBoundingClientRect();
      body.style.left = "0px";
      body.style.top = "0px";
      const size = body.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(
          anchor.left + anchor.width / 2 - size.width / 2,
          innerWidth - size.width - 8,
        ),
      );
      const below = anchor.bottom + 6;
      const top =
        below + size.height > innerHeight - 8
          ? Math.max(8, anchor.top - size.height - 6)
          : below;
      body.style.left = left + "px";
      body.style.top = top + "px";
    };
    const close = () => {
      info.open = false;
    };
    info.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") open();
    });
    info.addEventListener("pointerleave", () => {
      if (!info.matches(":focus-within")) close();
    });
    summary.addEventListener("focus", () => {
      if (summary.matches(":focus-visible")) open();
    });
    info.addEventListener("focusout", (event) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !info.contains(event.relatedTarget)
      )
        close();
    });
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      if (info.open) close();
      else open();
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    document.addEventListener(
      "scroll",
      () => {
        if (info.open) open();
      },
      { capture: true, passive: true },
    );
  }
})();
</script>`;

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

// Builds the desktop sidebar navigation; its "Contents" label doubles as the
// way back to the very top of the document.
const renderDesktopToc = ({
  nav,
  overviewId,
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  readonly overviewId: string;
}): string => {
  const items = renderTocItems({ nav, linkClasses: TOC_LINK_CLASSES });
  return `<nav class="hidden text-sm leading-normal wide:sticky wide:top-[5.75rem] wide:block wide:self-start" aria-label="Contents">
<p class="mb-3 text-xs font-semibold uppercase tracking-[0.08em]"><a class="rounded-sm text-muted hover:text-ink aria-[current=true]:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" data-overview-link href="#${encodeURIComponent(overviewId)}">Contents</a></p>
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
  const items = renderTocItems({ nav, linkClasses: MOBILE_TOC_LINK_CLASSES });
  return `<nav class="sticky top-11 z-10 h-11 border-b border-edge bg-paper/95 text-sm leading-normal shadow-[0_1px_0_rgb(0_0_0/0.03)] backdrop-blur-sm wide:hidden" data-mobile-toc aria-label="Contents">
<details class="group relative mx-auto h-full max-w-[74ch]">
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
  const needsViewerScript = hasToc || contentHtml.includes("data-info-popover");
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
