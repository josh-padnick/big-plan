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
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { MONITOR_ICON } from "../../icons/lucide/monitor.js";
import { MOON_ICON } from "../../icons/lucide/moon.js";
import { PALETTE_ICON } from "../../icons/lucide/palette.js";
import { SETTINGS_ICON } from "../../icons/lucide/settings.js";
import { SUN_ICON } from "../../icons/lucide/sun.js";
import { SUN_MOON_ICON } from "../../icons/lucide/sun-moon.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { LOGO_DARK_SRC, LOGO_LIGHT_SRC } from "../branding.generated.js";
import { escapeHtml } from "../escape-html.js";
import { GLOBAL_CSS } from "../global.generated.js";
import {
  APPROVAL_MESSAGE_LIMIT,
  DEFAULT_APPROVAL_MESSAGE,
  PALETTES,
  type Palette,
} from "../preferences.js";
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

// approved-metric: the desktop TOC's sticky offset and bottom breathing room
// bound a long section list to the viewport without crowding the page edge.
const DESKTOP_TOC_CLASSES =
  "hidden text-sm leading-normal wide:sticky wide:top-[5.75rem] wide:flex wide:max-h-[calc(100dvh-5.75rem-3rem)] wide:self-start wide:flex-col";

// The sidebar's own eyebrow, sitting over the section list.
// approved-metric: the Contents eyebrow tracking
const TOC_EYEBROW_CLASSES =
  "mb-3 flex shrink-0 items-center justify-between gap-2 border-b border-edge pb-2 text-xs font-semibold uppercase tracking-[0.08em]";

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
<button class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-toolbar-edge bg-transparent px-2.5 py-1 text-xs font-medium text-ink hover:border-toolbar-edge-strong hover:bg-toolbar-surface aria-expanded:border-toolbar-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" type="button" data-comment-draft-open aria-label="Add review comment" aria-expanded="false">${lucideIconToHtml({ icon: MESSAGE_SQUARE_ICON, className: "size-3.5" })}<span>Comment</span></button>
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
<button class="inline-flex size-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-toolbar-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent wide:size-8" type="button" data-preferences-open aria-label="Open settings" aria-haspopup="dialog" aria-expanded="false">${lucideIconToHtml({ icon: SETTINGS_ICON, className: "size-4" })}</button>
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
<span class="flex shrink-0 overflow-hidden rounded-sm border border-edge" data-palette-swatch data-palette="${palette}" aria-hidden="true"><span data-swatch="paper"></span><span data-swatch="edge"></span><span data-swatch="accent"></span><span data-swatch="ink"></span></span>
<span class="min-w-0 grow truncate text-sm font-semibold leading-tight">${escapeHtml(title)}</span>
</label>`;

// One sidebar item, and the settings page it opens. The sidebar exists so a
// later setting joins the list instead of lengthening one page: a new entry
// here is a new item and a new panel, and nothing else moves.
const renderPreferencesSection = ({
  section,
  title,
  icon,
  selected,
}: {
  readonly section: string;
  readonly title: string;
  readonly icon: typeof SUN_ICON;
  readonly selected: boolean;
}): string =>
  `<button class="flex min-h-11 min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3 text-left text-sm font-medium text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-selected:bg-surface aria-selected:font-semibold aria-selected:text-ink wide:min-h-9 wide:w-full wide:px-2" type="button" role="tab" id="big-plan-settings-tab-${section}" aria-controls="big-plan-settings-panel-${section}" aria-selected="${selected ? "true" : "false"}" tabindex="${selected ? "0" : "-1"}" data-preferences-section="${section}">${lucideIconToHtml({ icon, className: "size-4 shrink-0" })}<span class="truncate">${escapeHtml(title)}</span></button>`;

// A settings page: its own heading, its own explanation, and one control
// group. Beside the sidebar the heading is the page title, so the pane says
// what it is once the reviewer's eye has left the sidebar. Stacked under the
// sidebar it would only repeat the chip one line above it, so there it stays
// in the accessibility tree and out of the reading order.
//
// Every page occupies the same grid cell, so the pane reserves the room its
// tallest page needs and the sheet cannot resize when the reviewer changes
// page. The page that is not showing yields its paint rather than its room,
// which is why it is marked hidden with an attribute of its own rather than
// with `hidden`.
const renderPreferencesPanel = ({
  section,
  title,
  description,
  controls,
  selected,
}: {
  readonly section: string;
  readonly title: string;
  readonly description: string;
  readonly controls: string;
  readonly selected: boolean;
}): string =>
  `<section class="col-start-1 row-start-1 min-w-0" id="big-plan-settings-panel-${section}" role="tabpanel" tabindex="-1" aria-labelledby="big-plan-settings-tab-${section}" data-preferences-panel="${section}"${selected ? "" : " data-preferences-page-hidden"}>
<h3 class="sr-only m-0 text-lg font-semibold leading-tight wide:not-sr-only" id="big-plan-${section}-label">${escapeHtml(title)}</h3>
<p class="mt-1 text-sm leading-normal text-muted">${escapeHtml(description)}</p>
${controls}
</section>`;

// The one setting that is written rather than chosen. The default wording is
// server-rendered into the field, so a document with no storage and no script
// still shows the note an approval would carry rather than an empty box.
//
// The bound is the field's own maxlength as well as the contract's, because a
// reviewer pasting a long note should be stopped by the control rather than by
// a record that silently fails to parse on the next reload.
//
// The field is drawn the way the island draws its own inputs - the input ground
// inside an edge-strong hairline - rather than as a well. A well is a recess in
// a surface, and it reads as one only where the surface is lighter than the
// recess; in dark, where the well and the page are the same colour, the field
// lost its edges and the one thing on this page a reviewer can type into did
// not look like it.
const renderApprovalMessageControls = (): string =>
  `<div class="mt-3 min-w-0 wide:mt-4">
<label class="mb-1 block text-xs font-medium text-muted" for="big-plan-approval-message">Message</label>
<textarea class="block min-h-32 w-full resize-y rounded-md border border-edge-strong bg-input px-3 py-2 text-sm leading-normal text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent" id="big-plan-approval-message" data-approval-message-input maxlength="${APPROVAL_MESSAGE_LIMIT}" aria-describedby="big-plan-approval-message-hint">${escapeHtml(DEFAULT_APPROVAL_MESSAGE)}</textarea>
<p class="mt-2 text-xs leading-normal text-muted" id="big-plan-approval-message-hint">The approval id, the pinned version, and your recorded answers are always attached; this text is the covering note.</p>
<p class="mt-2 text-xs leading-normal text-[var(--callout-warning-c)]" id="big-plan-approval-message-error" data-approval-message-error hidden>This note could not be saved. It is still here, but it will be lost if you close this page.</p>
<div class="mt-3">
<button class="-ml-2 inline-flex min-h-9 cursor-pointer items-center rounded-md border-0 bg-transparent px-2 text-sm font-medium text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" type="button" data-approval-message-reset>Reset to default</button>
</div>
</div>`;

// The dialog is a settings surface rather than one long page: a sidebar of
// settings on the left, the chosen one on the right. Every setting is a peer
// there, so none competes with another for the reviewer's attention and the
// next one costs one more sidebar item. The pane that stacks those pages is a
// one-column grid whose track is named so a long control cannot floor an
// implicit column past the sheet (BIG-185).
//
// Beside the page the sidebar is a column and grows downward. Above it, on a
// phone, it wraps onto a second row rather than scrolling sideways: a settings
// category the reviewer has to discover by dragging a row is a category they
// never find.
//
// The sheet is titled rather than labelled: Settings names the whole surface
// and sits one type step above the page title it contains, so the ladder reads
// sheet, then page, then body. An all-caps tracked kicker was the other way of
// keeping the two apart and read as a label left behind rather than a title.
//
// The saving caption belongs to the title rather than to the sheet's last
// edge. It says how every page here behaves, so it reads as the title's
// subtitle; parked at the bottom it sat below whichever page was showing and
// read as a footnote to that one page.
const renderPreferencesDialog = (): string =>
  `<div class="fixed inset-0 z-50 flex items-center justify-center bg-backdrop/70 p-3 wide:p-4" data-preferences-backdrop hidden>
<section class="max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-lg overflow-y-auto overscroll-contain rounded-xl border border-edge bg-paper p-4 text-ink shadow-floating wide:max-h-[calc(100dvh-2rem)] wide:max-w-3xl wide:p-8" data-preferences-dialog role="dialog" aria-modal="true" aria-labelledby="big-plan-preferences-title">
<div class="flex items-start justify-between gap-4">
<div class="min-w-0">
<h2 class="m-0 text-2xl font-semibold tracking-tight" id="big-plan-preferences-title">Settings</h2>
<p class="mt-1 text-xs leading-normal text-muted" data-preferences-status>Changes are saved in browser local storage and apply to every review document in this browser.</p>
</div>
<button class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" type="button" data-preferences-close aria-label="Close settings">${lucideIconToHtml({ icon: X_ICON, className: "size-4" })}</button>
</div>
<div class="mt-4 border-t border-edge pt-4 wide:mt-6 wide:grid wide:grid-cols-[12rem_1fr] wide:gap-6 wide:pt-6">
<div class="flex min-w-0 flex-wrap gap-1 border-b border-edge pb-3 wide:flex-col wide:flex-nowrap wide:border-r wide:border-b-0 wide:pr-4 wide:pb-0" role="tablist" aria-label="Settings sections" data-preferences-sections>
${renderPreferencesSection({ section: "appearance", title: "Appearance", icon: SUN_MOON_ICON, selected: true })}
${renderPreferencesSection({ section: "palette", title: "Color theme", icon: PALETTE_ICON, selected: false })}
${renderPreferencesSection({ section: "approval-message", title: "Approval message", icon: MESSAGE_SQUARE_ICON, selected: false })}
</div>
<div class="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] wide:mt-0">
${renderPreferencesPanel({
  section: "appearance",
  title: "Appearance",
  description: "Choose how light or dark Big Plan looks.",
  selected: true,
  controls: `<fieldset class="mt-3 grid min-w-0 grid-cols-1 gap-2 border-0 p-0 wide:mt-4 wide:grid-cols-3 wide:gap-3" aria-labelledby="big-plan-appearance-label" role="radiogroup">
<legend class="sr-only">Appearance</legend>
${renderPreferenceOption({ mode: "light", title: "Light", description: "Always light", icon: SUN_ICON })}
${renderPreferenceOption({ mode: "dark", title: "Dark", description: "Always dark", icon: MOON_ICON })}
${renderPreferenceOption({ mode: "system", title: "System", description: "Match device", icon: MONITOR_ICON })}
</fieldset>`,
})}
${renderPreferencesPanel({
  section: "palette",
  title: "Color theme",
  description:
    "Choose which colors Big Plan uses. Each theme works in both light and dark.",
  selected: false,
  controls: `<fieldset class="mt-3 grid min-w-0 grid-cols-1 gap-2 border-0 p-0 wide:mt-4" aria-labelledby="big-plan-palette-label" role="radiogroup">
<legend class="sr-only">Color theme</legend>
${PALETTE_OPTIONS.map(renderPaletteOption).join("\n")}
</fieldset>`,
})}
${renderPreferencesPanel({
  section: "approval-message",
  title: "Approval message",
  description: "Sent to your agent each time you approve a plan.",
  selected: false,
  controls: renderApprovalMessageControls(),
})}
</div>
</div>
</section>
</div>`;

// The right side of the branding bar keeps status, Feedback, and Settings as
// separate peer actions with one closed spacing-scale step between them.
// Feedback belongs to a document under review; a surface with no plan in it
// omits it and keeps Settings, which still applies everywhere.
const renderHeaderActions = ({
  feedback,
}: {
  readonly feedback: boolean;
}): string =>
  `<div class="ml-auto flex items-center gap-1">
${feedback ? renderCommentDraftControl() : ""}
${renderPreferencesControl()}
</div>`;

// What it names - plan content, sorting, collapse, maximize, comments - is
// true of a plan document and of nothing else, so a standalone page does not
// carry it: there is no plan there to describe.
//
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
<span class="w-5 text-[var(--callout-danger-c)]" data-leading-icon>${lucideIconToHtml({ icon: TRIANGLE_ALERT_ICON, className: "size-5" })}</span>
<span class="min-w-0 flex-1"><strong class="font-semibold">JavaScript is disabled.</strong> The full plan content is readable. Interactive affordances such as sorting, collapse, maximize, and comments are unavailable; comment screenshots require the local <code>big-plan review</code> runtime.</span>
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
  return `<nav class="${DESKTOP_TOC_CLASSES}" data-desktop-toc aria-label="Contents">
<p class="${TOC_EYEBROW_CLASSES}" data-toc-header><a class="rounded-sm text-subtle hover:text-ink aria-[current=true]:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" data-overview-link href="#${encodeURIComponent(overviewId)}">Contents</a>${renderBulkCollapseControls()}</p>
<ol class="min-h-0 overflow-y-auto overscroll-contain pr-1" data-desktop-toc-list>
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
  "sticky top-11 z-40 h-11 border-b border-edge bg-toolbar text-sm leading-normal shadow-[0_1px_0_rgb(0_0_0/0.03)] wide:hidden";

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
  return `<nav class="${MOBILE_TOC_BAR_CLASSES}" data-mobile-toc data-shell-chrome aria-label="Contents">
<details class="group relative mx-auto h-full max-w-[74ch]">
<summary class="flex h-full cursor-pointer list-none items-center gap-3 px-6 py-2 [&amp;::-webkit-details-marker]:hidden">
<span class="font-semibold text-ink">Sections</span>
<span class="flex min-w-6 items-center justify-center rounded-full bg-toolbar-surface px-2 py-0.5 text-xs font-medium tabular-nums text-muted">${nav.length}</span>
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
  chrome = "document",
}: {
  readonly nav: ReadonlyArray<NavEntry>;
  // The plan's own title, shown quietly in the bar so a reader deep in a long
  // document can still see which plan they are in.
  readonly title: string;
  readonly contentIds: ReadonlyArray<string>;
  readonly contentHtml: string;
  /**
   * How much of the bar this surface earns.
   *
   * A plan document gets the whole bar. A standalone page the service serves
   * is not a plan: there is no title worth echoing and nothing to give
   * feedback on, so it keeps the wordmark and Settings and drops the rest.
   */
  readonly chrome?: "document" | "standalone";
}): ShellResult => {
  const standalone = chrome === "standalone";
  const hasToc = nav.length > 0;
  const overviewId = createOverviewId(contentIds);
  const html = `<header class="sticky top-0 z-40 h-11 border-b border-edge bg-toolbar" data-shell-chrome>
<div class="grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-6">
<a class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href="https://big-plan.ai" target="_blank" rel="noreferrer">
<img class="w-27 h-auto" data-logo-light src="${LOGO_LIGHT_SRC}" alt="Big Plan" width="1200" height="220">
<img class="w-27 h-auto" data-logo-dark src="${LOGO_DARK_SRC}" alt="Big Plan" width="1200" height="220">
</a>
${standalone ? "<p></p>" : `<p class="truncate text-center text-sm text-muted"><span class="italic" data-plan-title title="${escapeHtml(title)}" aria-hidden="true">${escapeHtml(title)}</span></p>`}
${renderHeaderActions({ feedback: !standalone })}
</div>
  </header>
  ${hasToc ? renderMobileToc({ nav, overviewId }) : ""}
${standalone ? "" : renderNoScriptNotice()}
<div class="${hasToc ? LAYOUT_WITH_TOC : LAYOUT_WITHOUT_TOC}" data-reading-layout="${hasToc ? "with-toc" : "without-toc"}">
${hasToc ? renderDesktopToc({ nav, overviewId }) : ""}
<main class="min-w-0" id="${overviewId}">
<div class="${hasToc ? "mb-3 wide:hidden" : "mb-3"}" data-review-approval-slot hidden></div>
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
