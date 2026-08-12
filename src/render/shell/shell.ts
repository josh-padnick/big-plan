// Owns the review shell: the reading surface a rendered document lives in -
// the branding bar, layout grid, responsive desktop and mobile navigation,
// and content region. It produces body-level markup plus the styles the
// markup needs, as data;
// packaging into a complete document is page.ts's job. Authored markup is
// styled with Tailwind utilities; the compiled stylesheet (including the
// element-scoped styles from markdown/prose.css) comes from the generated
// GLOBAL_CSS module.

import { CHEVRONS_DOWN_UP_ICON } from "../../icons/lucide/chevrons-down-up.js";
import { CHEVRONS_UP_DOWN_ICON } from "../../icons/lucide/chevrons-up-down.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { MONITOR_ICON } from "../../icons/lucide/monitor.js";
import { MOON_ICON } from "../../icons/lucide/moon.js";
import { SETTINGS_ICON } from "../../icons/lucide/settings.js";
import { SUN_ICON } from "../../icons/lucide/sun.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { LOGO_DARK_SRC, LOGO_LIGHT_SRC } from "../branding.generated.js";
import { escapeHtml } from "../escape-html.js";
import { GLOBAL_CSS } from "../global.generated.js";
import { PALETTES, type Palette } from "../preferences.js";
import { lucideIconToHtml } from "./lucide-icon-html.js";
import { PREFERENCES_SCRIPT } from "./preferences-script.js";
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

const BODY_CLASSES = "bg-paper font-sans text-base text-ink antialiased";

// Stacked reading layout below the wide breakpoint; sidebar plus one content
// column above it. The wide column contains a standard desktop wireframe
// through nested card chrome, while prose holds its own narrower measure.
//
// approved-metric: the page gutter, the sidebar gap, and the page's own bottom
// margin. The sidebar gap in particular places the reading column, so a step
// off the scale here moved every surface on the page sideways.
const LAYOUT_CLASSES =
  "grid grid-cols-[minmax(0,1fr)] justify-center gap-8 px-5 pt-16 pb-16 wide:gap-14 wide:px-6 wide:pt-12 wide:pb-20";
const LAYOUT_WITH_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[15rem_minmax(0,54.5rem)]`;
const LAYOUT_WITHOUT_TOC = `${LAYOUT_CLASSES} wide:grid-cols-[minmax(0,54.5rem)]`;

// Active links change color and border only, never weight, so highlighting
// can never re-wrap a label. Entries grouped under a part header carry the
// rule and the inset that make them read as its children.
const TOC_LINK_CLASSES =
  // approved-metric: the sidebar row height
  "block border-l-2 border-edge px-3 py-[0.3rem] leading-snug text-subtle hover:text-ink aria-[current=true]:border-accent aria-[current=true]:text-accent";
const TOC_GROUPED_LINK_CLASSES =
  // approved-metric: the sidebar row height and the grouped inset
  "block border-l-2 border-edge py-[0.3rem] pr-3 pl-3.5 leading-snug text-subtle hover:text-ink aria-[current=true]:border-accent aria-[current=true]:text-accent";
// A part header is a heading over the entries beneath it, not one of them, so
// it sits flush with the Contents label rather than sharing the rule and inset
// its section links use.
const TOC_PART_HEADER_CLASSES =
  "mt-3 mb-1 block pr-3 text-2xs font-bold tracking-caps uppercase text-accent hover:text-ink";
const MOBILE_TOC_LINK_CLASSES =
  "block border-l-2 border-transparent px-6 py-3 leading-snug text-ink hover:bg-surface aria-[current=true]:border-accent aria-[current=true]:bg-surface aria-[current=true]:text-accent";
const MOBILE_TOC_GROUPED_LINK_CLASSES =
  "block border-l-2 border-transparent py-3 pr-6 pl-8 leading-snug text-ink hover:bg-surface aria-[current=true]:border-accent aria-[current=true]:bg-surface aria-[current=true]:text-accent";
const MOBILE_TOC_PART_HEADER_CLASSES =
  "block border-l-2 border-transparent px-6 pt-3 pb-1 text-2xs font-bold tracking-caps uppercase text-accent hover:text-ink";

// The sidebar's own eyebrow, sitting over the section list.
// approved-metric: the Contents eyebrow tracking
const TOC_EYEBROW_CLASSES =
  "mb-3 flex items-center justify-between gap-2 border-b border-edge pb-2 text-xs font-semibold uppercase tracking-[0.08em]";

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

// Bulk collapse controls live beside the Contents label rather than over the
// reading column: they act on the whole document, which is exactly what the
// table of contents already represents, and the sidebar is sticky so they
// stay reachable while reading without adding chrome to the slides.
//
// They are script-only affordances, so they ship hidden and the viewer script
// reveals them; a scripts-disabled document shows no control it cannot honour.
const COLLAPSE_ALL_BUTTON_CLASSES =
  "inline-flex size-[1.35rem] cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-subtle opacity-55 transition-opacity transition-colors hover:text-ink hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

// Carries no display utility: the hidden attribute (zero-specificity preflight)
// must win until the script sets data-shown, which then supplies the display.
const renderBulkCollapseControls = (layoutClasses = ""): string =>
  `<span class="data-[shown]:inline-flex items-center gap-1.5 ${layoutClasses}" data-collapse-all-controls hidden>
<button class="${COLLAPSE_ALL_BUTTON_CLASSES}" type="button" data-expand-all aria-label="Expand all sections" title="Expand all">${lucideIconToHtml({ icon: CHEVRONS_UP_DOWN_ICON, className: "size-4" })}</button>
<button class="${COLLAPSE_ALL_BUTTON_CLASSES}" type="button" data-collapse-all aria-label="Collapse all sections" title="Collapse all">${lucideIconToHtml({ icon: CHEVRONS_DOWN_UP_ICON, className: "size-4" })}</button>
</span>`;

// The inert export carries one document-level draft composer. It ships hidden
// because the viewer script owns both its interaction and optional storage;
// a scripts-disabled review therefore remains readable without a dead control.
// approved-metric: the comment control keeps the outline and inset the
// approved bar used, because a shadow on a bar that never leaves the screen
// reads heavier than a hairline.
const renderCommentDraftControl = (): string =>
  `<span data-comment-draft-control hidden>
<button class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-edge bg-paper px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" type="button" data-comment-draft-open aria-label="Add review comment" aria-expanded="false">${lucideIconToHtml({ icon: MESSAGE_SQUARE_ICON, className: "size-3.5" })}<span>Comment</span></button>
<section class="fixed top-14 right-4 z-20 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-raised p-4 shadow-floating" data-comment-draft-panel aria-label="Review comment draft" hidden>
<div class="mb-2 flex items-center justify-between gap-3">
<p class="text-sm font-semibold">Review comment</p>
<button class="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" type="button" data-comment-draft-close aria-label="Close comment draft">${lucideIconToHtml({ icon: X_ICON, className: "size-3.5" })}</button>
</div>
<label class="mb-1 block text-xs font-medium text-muted" for="big-plan-comment-draft">Draft</label>
<textarea class="block min-h-28 w-full resize-y rounded-md bg-well px-3 py-2 text-sm leading-normal text-ink inset-shadow-well focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent" id="big-plan-comment-draft" data-comment-draft-input aria-label="Comment draft" placeholder="Name the part of the plan you are unsure about, and what would settle it."></textarea>
<div class="mt-2 flex items-center justify-between gap-3">
<p class="min-w-0 text-xs text-muted" data-comment-draft-status aria-live="polite"></p>
<button class="shrink-0 cursor-pointer rounded-md bg-accent px-3 py-1 text-xs font-semibold text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" type="button" data-comment-draft-save>Save draft</button>
</div>
</section>
</span>`;

// The settings trigger is script-enhanced so a no-JavaScript document stays
// readable without exposing a control that cannot open its dialog.
const renderPreferencesControl = (): string =>
  `<span data-preferences-control hidden>
<button class="inline-flex size-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" type="button" data-preferences-open aria-label="Open settings" aria-haspopup="dialog" aria-expanded="false">${lucideIconToHtml({ icon: SETTINGS_ICON, className: "size-4" })}</button>
</span>`;

const renderPreferenceOption = ({
  mode,
  title,
  description,
  icon,
}: {
  readonly mode: string;
  readonly title: string;
  readonly description: string;
  readonly icon: typeof SUN_ICON;
}): string =>
  `<label class="group relative flex min-h-[4.25rem] min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-edge bg-paper p-3 text-ink transition-colors hover:bg-surface has-[:checked]:border-accent has-[:checked]:bg-surface has-[:checked]:text-accent has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent wide:min-h-28 wide:flex-col wide:items-stretch wide:justify-between wide:gap-3">
<input class="absolute top-1/2 right-3 size-4 -translate-y-1/2 accent-accent wide:top-3 wide:translate-y-0" id="big-plan-appearance-${mode}" type="radio" name="big-plan-appearance" value="${mode}" data-preference-mode="${mode}" aria-label="${title}">
<span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-muted group-has-[input:checked]:text-accent">${lucideIconToHtml({ icon, className: "size-4" })}</span>
<span class="min-w-0 pr-6">
<span class="block text-sm font-semibold leading-tight">${title}</span>
<span class="mt-1 block text-xs leading-normal text-muted">${description}</span>
</span>
</label>`;

// The colour themes, in the order the sheet offers them: the product's own
// palette first, then the guests. PALETTES owns the ids; this list adds only
// the reviewer-facing name, which is the one fact the contract has no opinion
// about. Each name is the upstream project's own spelling, accents included.
const PALETTE_TITLES = {
  default: "Default",
  "rose-pine": "Rosé Pine",
  nord: "Nord",
  catppuccin: "Catppuccin",
  brutalist: "Brutalist",
} as const satisfies Readonly<Record<Palette, string>>;

const PALETTE_OPTIONS = PALETTES.map((palette) => ({
  palette,
  title: PALETTE_TITLES[palette],
}));

// approved-metric: the palette swatch column. Four colour columns read as one
// chip beside the option's own control: 22px stands level with that control,
// and an 11px column is the widest that still reads as one sample rather than
// four blocks. A shell-owned chip size, not a step of the spacing scale.
const PALETTE_SWATCH_CLASSES = "block h-[1.375rem] w-[0.6875rem]";

// A row rather than a card: five themes read faster stacked than wrapped, and
// the strip does the describing so the name never has to. The swatch carries
// its own theme, so each strip shows that theme's shades whatever the document
// is currently painted in.
const renderPaletteOption = ({
  palette,
  title,
}: {
  readonly palette: Palette;
  readonly title: string;
}): string =>
  `<label class="group relative flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-edge bg-paper px-3 py-2 text-ink transition-colors hover:bg-surface has-[:checked]:border-accent has-[:checked]:bg-surface has-[:checked]:text-accent has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent">
<input class="order-last size-4 shrink-0 accent-accent" id="big-plan-palette-${palette}" type="radio" name="big-plan-palette" value="${palette}" data-preference-palette="${palette}" aria-label="${escapeHtml(title)}">
<span class="flex shrink-0 overflow-hidden rounded-sm border border-edge" data-palette-swatch data-palette="${palette}" aria-hidden="true"><span class="palette-swatch-paper ${PALETTE_SWATCH_CLASSES}" data-swatch="paper"></span><span class="palette-swatch-edge ${PALETTE_SWATCH_CLASSES}" data-swatch="edge"></span><span class="palette-swatch-accent ${PALETTE_SWATCH_CLASSES}" data-swatch="accent"></span><span class="palette-swatch-ink ${PALETTE_SWATCH_CLASSES}" data-swatch="ink"></span></span>
<span class="min-w-0 grow truncate text-sm font-semibold leading-tight">${escapeHtml(title)}</span>
</label>`;

// The dialog is intentionally a focused presentation chooser: how light the
// page is, and whose colours fill it. Future settings join only when
// actionable, so an unavailable roadmap item never competes with the
// reviewer's current decisions.
const renderPreferencesDialog = (): string =>
  `<div class="fixed inset-0 z-50 flex items-center justify-center bg-backdrop/70 p-3 wide:grid wide:place-items-center wide:p-4" data-preferences-backdrop hidden>
<section class="max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-lg overflow-y-auto overscroll-contain rounded-xl border border-edge bg-paper p-4 text-ink shadow-floating wide:max-h-[calc(100dvh-2rem)] wide:p-8" data-preferences-dialog role="dialog" aria-modal="true" aria-labelledby="big-plan-preferences-title">
<div class="flex items-start justify-between gap-4">
<div>
<h2 class="m-0 text-lg font-semibold leading-tight" id="big-plan-preferences-title">Settings</h2>
<p class="mt-2 max-w-sm text-sm leading-normal text-muted">Preferences are saved for every review document in this browser.</p>
</div>
<button class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" type="button" data-preferences-close aria-label="Close settings">${lucideIconToHtml({ icon: X_ICON, className: "size-4" })}</button>
</div>
<div class="mt-4 border-t border-edge pt-4 wide:mt-6 wide:pt-6">
<h3 class="m-0 text-sm font-semibold" id="big-plan-appearance-label">Appearance</h3>
<p class="mt-1 text-sm leading-normal text-muted">Choose how Big Plan looks.</p>
<fieldset class="mt-3 grid min-w-0 grid-cols-1 gap-2 border-0 p-0 wide:mt-4 wide:grid-cols-3 wide:gap-3" aria-labelledby="big-plan-appearance-label" role="radiogroup">
<legend class="sr-only">Appearance</legend>
${renderPreferenceOption({ mode: "light", title: "Light", description: "Always light", icon: SUN_ICON })}
${renderPreferenceOption({ mode: "dark", title: "Dark", description: "Always dark", icon: MOON_ICON })}
${renderPreferenceOption({ mode: "system", title: "System", description: "Match device", icon: MONITOR_ICON })}
</fieldset>
</div>
<div class="mt-4 border-t border-edge pt-4 wide:mt-6 wide:pt-6">
<h3 class="m-0 text-sm font-semibold" id="big-plan-palette-label">Color theme</h3>
<p class="mt-1 text-sm leading-normal text-muted">Choose which colors Big Plan uses. Each theme works in both light and dark.</p>
<fieldset class="mt-3 grid min-w-0 grid-cols-1 gap-2 border-0 p-0 wide:mt-4" aria-labelledby="big-plan-palette-label" role="radiogroup">
<legend class="sr-only">Color theme</legend>
${PALETTE_OPTIONS.map(renderPaletteOption).join("\n")}
</fieldset>
<p class="mt-3 flex items-center gap-2 text-xs leading-normal text-muted wide:mt-4" data-preferences-status>${lucideIconToHtml({ icon: CHECK_ICON, className: "size-3.5 shrink-0 text-accent" })}<span>Changes apply immediately and are saved automatically.</span></p>
</div>
</section>
</div>`;

// The right side of the branding bar is one action group shared by Comment
// and Settings, keeping both controls reachable without a menu layer.
const renderHeaderActions = (): string =>
  `<div class="ml-auto flex items-center gap-1">
${renderCommentDraftControl()}
${renderPreferencesControl()}
</div>`;

// Browsers do not execute script inside noscript, so this dismissal is a
// native checkbox rather than a dead button. It can hide the warning for the
// current document without weakening the content floor. A cross-load
// localStorage preference is impossible in the exact state this notice names:
// reading or writing localStorage itself requires JavaScript.
const renderNoScriptNotice = (): string =>
  `<noscript>
<div class="mx-auto mt-4 mb-0 max-w-[var(--measure)] px-4">
<input class="peer sr-only" id="big-plan-noscript-dismiss" type="checkbox" aria-label="Dismiss JavaScript warning">
<aside class="flex items-start gap-3 rounded-lg border-l-[3px] border-[var(--callout-danger-c)] bg-[var(--callout-danger-bg)] px-4 py-3 text-sm leading-normal text-[var(--callout-danger-ink)] peer-checked:hidden peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" data-noscript-notice role="note">
<span class="mt-0.5 inline-flex size-5 shrink-0 text-[var(--callout-danger-c)]">${lucideIconToHtml({ icon: TRIANGLE_ALERT_ICON, className: "size-5" })}</span>
<span class="min-w-0 flex-1"><strong class="font-semibold">JavaScript is disabled.</strong> The full plan content is readable. Interactive affordances such as sorting, collapse, maximize, and comments are unavailable.</span>
<label class="shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-[var(--callout-danger-c)] hover:underline" for="big-plan-noscript-dismiss" data-noscript-dismiss>Dismiss</label>
</aside>
</div>
</noscript>`;

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
<p class="${TOC_EYEBROW_CLASSES}" data-toc-header><a class="rounded-sm text-subtle hover:text-ink aria-[current=true]:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" data-overview-link href="#${encodeURIComponent(overviewId)}">Contents</a>${renderBulkCollapseControls()}</p>
<ol>
${items}
</ol>
</nav>`;
};

// Builds the sticky mobile TOC as a native disclosure.
// approved-metric: the mobile fold control inset, matching the row inset it
// sits over in the approved render.
const MOBILE_FOLD_CONTROL_CLASSES = "float-right mr-5 mb-1";

// approved-metric: the mobile bar's hairline shadow, which lifts the sticky bar
// off the text scrolling under it without the weight of a resting shadow.
const MOBILE_TOC_BAR_CLASSES =
  "sticky top-11 z-40 h-11 border-b border-edge bg-paper/95 text-sm leading-normal shadow-[0_1px_0_rgb(0_0_0/0.03)] backdrop-blur-sm wide:hidden";

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
  return `<nav class="${MOBILE_TOC_BAR_CLASSES}" data-mobile-toc aria-label="Contents">
<details class="group relative mx-auto h-full max-w-[74ch]">
<summary class="flex h-full cursor-pointer list-none items-center gap-3 px-6 py-2 [&amp;::-webkit-details-marker]:hidden">
<span class="font-semibold text-ink">Sections</span>
<span class="flex min-w-6 items-center justify-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium tabular-nums text-muted">${nav.length}</span>
<svg class="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" aria-hidden="true" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 4.96a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06L11.18 10 7.21 6.02a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" /></svg>
</summary>
<div class="absolute inset-x-0 top-full max-h-[min(70vh,24rem)] overflow-y-auto overscroll-contain bg-paper py-2 shadow-floating">
${renderBulkCollapseControls(MOBILE_FOLD_CONTROL_CLASSES)}
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
  title,
  contentIds,
  contentHtml,
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  // The plan's own title, shown quietly in the bar so a reader deep in a long
  // document can still see which plan they are in.
  readonly title: string;
  readonly contentIds: ReadonlyArray<string>;
  readonly contentHtml: string;
}): ShellResult => {
  const hasToc = nav.length > 0;
  const overviewId = createOverviewId(contentIds);
  const html = `<header class="sticky top-0 z-40 h-11 border-b border-edge bg-paper/90 backdrop-blur">
<div class="grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-6">
<a class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="https://big-plan.ai" target="_blank" rel="noreferrer">
<img class="w-27 h-auto" data-logo-light src="${LOGO_LIGHT_SRC}" alt="Big Plan" width="1200" height="220">
<img class="w-27 h-auto" data-logo-dark src="${LOGO_DARK_SRC}" alt="Big Plan" width="1200" height="220">
</a>
<p class="truncate text-center text-sm leading-none text-subtle"><span class="italic" data-plan-title title="${escapeHtml(title)}" aria-hidden="true">${escapeHtml(title)}</span></p>
${renderHeaderActions()}
</div>
  </header>
  ${hasToc ? renderMobileToc({ nav, overviewId }) : ""}
${renderNoScriptNotice()}
<div class="${hasToc ? LAYOUT_WITH_TOC : LAYOUT_WITHOUT_TOC}" data-reading-layout="${hasToc ? "with-toc" : "without-toc"}">
${hasToc ? renderDesktopToc({ nav, overviewId }) : ""}
<main class="min-w-0" id="${overviewId}">
<article>
${contentHtml}
</article>
</main>
</div>
${renderPreferencesDialog()}
${PREFERENCES_SCRIPT}
${VIEWER_SCRIPT}`;
  return {
    html,
    styles: GLOBAL_CSS,
    bodyClassName: BODY_CLASSES,
  };
};
