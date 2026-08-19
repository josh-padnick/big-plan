// The pages the local review-link service serves in its own right: the welcome
// page at `/`, the stop confirmation, the stopped notice, and the four answers
// a saved plan link can get.
//
// These live in the renderer, not in the service, for one reason: they are Big
// Plan surfaces and must look like Big Plan. They are composed from the same
// `renderShell` toolbar a review document renders, wrapped in the same
// `renderPage` envelope, carrying the same embedded stylesheet, and built from
// the same recipes the product already uses - the deck's slide card, the
// review UI's alert dialog and buttons, the Callout component's tip. Nothing
// here invents a visual vocabulary, and a change to the design system reaches
// these pages without anyone remembering they exist.
//
// The content floor matches a plan document's: every page reads and every flow
// completes with scripts disabled. Stopping is a link to a confirmation and a
// form post, never a scripted button, and these pages add no script of their
// own: copying is wired by the shell's viewer script exactly as it is for a
// fenced block in a plan.

import { escapeHtml } from "./escape-html.js";
import {
  copyLabel,
  FIGURE_CONTROL_BUTTON_CLASSES,
} from "../components/_model/figure-controls/figure-controls.js";
import { CHECK_ICON } from "../icons/lucide/check.js";
import { COPY_ICON } from "../icons/lucide/copy.js";
import { LIGHTBULB_ICON } from "../icons/lucide/lightbulb.js";
import { TRIANGLE_ALERT_ICON } from "../icons/lucide/triangle-alert.js";
import { renderPage } from "./page.js";
import { lucideIconToHtml } from "./shell/lucide-icon-html.js";
import { renderShell } from "./shell/shell.js";

// The deck's own slide card, so the service's one card is the card a reader
// already knows from every plan.
const CARD =
  "plan-slide plan-card box-border rounded-xl bg-raised shadow-raised";

// The review UI's shadcn Button recipes, copied by value because these pages
// are server-rendered HTML rather than the React island those primitives live
// in. Same tokens, same shapes, same states.
const BUTTON_BASE =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 no-underline transition hover:brightness-95 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-11 px-2 py-1 text-sm wide:min-h-0";
const BUTTON_DEFAULT =
  "rounded-md border border-transparent bg-accent font-semibold text-accent-ink shadow-raised hover:shadow-lifted active:inset-shadow-pressed";
const BUTTON_OUTLINE =
  "rounded-md border border-edge bg-transparent font-normal text-muted shadow-none hover:bg-surface hover:text-ink hover:shadow-raised active:inset-shadow-pressed";
const BUTTON_DESTRUCTIVE =
  "rounded-md border border-transparent bg-danger font-semibold text-danger-ink shadow-raised hover:shadow-lifted active:inset-shadow-pressed";

const button = ({
  label,
  variant,
  href,
  submit = false,
  copy,
  autofocus = false,
}: {
  readonly label: string;
  readonly variant: "default" | "outline" | "destructive";
  readonly href?: string;
  readonly submit?: boolean;
  readonly copy?: string;
  readonly autofocus?: boolean;
}): string => {
  const recipe =
    variant === "default"
      ? BUTTON_DEFAULT
      : variant === "outline"
        ? BUTTON_OUTLINE
        : BUTTON_DESTRUCTIVE;
  const className = `${BUTTON_BASE} ${recipe}`;
  const focus = autofocus ? " autofocus" : "";
  if (href !== undefined) {
    return `<a class="${className}" href="${escapeHtml(href)}"${focus}>${escapeHtml(label)}</a>`;
  }
  const copyAttribute =
    copy === undefined ? "" : ` data-copy="${escapeHtml(copy)}"`;
  return `<button class="${className}" type="${submit ? "submit" : "button"}"${copyAttribute}>${escapeHtml(label)}</button>`;
};

// The Callout component's markup, so a tip on a service page is the same tip a
// plan author writes. The palette comes from the [data-callout] rules the
// stylesheet already carries.
// Authored prose is what the stylesheet styles: the markdown pipeline stamps
// this attribute on every element it emits, and prose.css keys its whole type
// and list scale off it. Hand-written content on these pages carries it for
// the same reason, so a heading here is the heading a plan renders rather than
// a browser default.
const PROSE = ' data-authored-prose=""';

const callout = ({
  type,
  bodyHtml,
}: {
  readonly type: "tip" | "warning";
  readonly bodyHtml: string;
}): string => {
  const icon = type === "tip" ? LIGHTBULB_ICON : TRIANGLE_ALERT_ICON;
  const title = type === "tip" ? "Tip" : "Warning";
  // The palette is assigned on the element rather than inherited from an
  // `article` ancestor rule, so a callout is itself wherever it is drawn -
  // inside the reading column or inside a dialog over it. Every value is a
  // design token; nothing here picks a colour.
  return `<aside class="callout my-6 max-w-[var(--measure)] rounded-r-md border-l-4 px-4 py-3" data-callout="${type}" style="--callout-accent: var(--callout-${type}-c); --callout-bg: var(--callout-${type}-bg); --callout-ink: var(--callout-${type}-ink); background: var(--callout-bg); border-color: var(--edge-c); border-left-color: var(--callout-accent);">
<header class="callout-header mb-2 flex items-center gap-2 font-semibold text-[var(--callout-accent)] [&_svg]:size-4 [&_svg]:shrink-0">${lucideIconToHtml({ icon, className: "size-4" })}<span class="callout-title text-sm leading-5">${title}</span></header>
<div class="callout-body text-[var(--callout-ink)] [&>:last-child]:mb-0">${bodyHtml}</div>
</aside>`;
};

const tip = ({ bodyHtml }: { readonly bodyHtml: string }): string =>
  callout({ type: "tip", bodyHtml });

const warning = ({ bodyHtml }: { readonly bodyHtml: string }): string =>
  callout({ type: "warning", bodyHtml });

const servicePage = ({
  title,
  contentHtml,
  overlayHtml = "",
}: {
  readonly title: string;
  readonly contentHtml: string;
  readonly overlayHtml?: string;
}): string => {
  // The overlay goes inside the article rather than beside it. Fixed
  // positioning is viewport-relative either way, and component styles such as
  // the Callout palette are scoped to `article` - a dialog rendered outside it
  // would quietly lose them.
  const shell = renderShell({
    nav: [],
    title,
    contentIds: [],
    contentHtml: `${contentHtml}${overlayHtml}`,
    chrome: "standalone",
  });
  return renderPage({
    title,
    styles: shell.styles,
    bodyClassName: shell.bodyClassName,
    bodyHtml: shell.html,
    // Tells the review island this page carries no plan, so it does not boot.
    rootAttributes: { "data-standalone": "" },
  });
};

// A clock time is what a person recognises in "the review stopped at 2:41 AM".
// The date is left off because every case this renders is recent by
// construction: a link clicked after a session ended.
const clockTime = (atMs: number): string => {
  if (!Number.isFinite(atMs)) return "an unknown time";
  const spoken = new Date(atMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  // "6:15 PM" is how a formatter writes it; "6:15pm" is how a person does.
  // A 24-hour locale has no meridiem to fix, so it passes through untouched.
  return spoken.replace(
    /\s*([AP])\.?M\.?$/iu,
    (_match, half: string) => `${half.toLowerCase()}m`,
  );
};

const commandBlock = ({ command }: { readonly command: string }): string => {
  const label = copyLabel("code");
  // The same figure the markdown pipeline builds around a fenced block, so the
  // control is the product's own: hover-revealed, icon-only, and wired by the
  // shell's viewer script through data-copy-code rather than by a script here.
  return `<figure class="code-figure group/code-figure relative max-w-[var(--measure)] mb-6 [&>pre]:mb-0">
<div class="figure-control-bar absolute top-[0.3rem] right-[0.4rem] z-[1] flex flex-row items-center justify-end gap-1 p-0 opacity-0 motion-safe:transition-opacity motion-safe:duration-150 group-hover/code-figure:opacity-100 group-focus-within/code-figure:opacity-100">
<button class="${FIGURE_CONTROL_BUTTON_CLASSES}" type="button" aria-label="${label}" data-tooltip="${label}" data-tooltip-delay="1s" data-copy-code hidden>${lucideIconToHtml({ icon: COPY_ICON, className: "size-4" })}${lucideIconToHtml({ icon: CHECK_ICON, className: "size-4", hidden: true })}</button>
</div>
<pre${PROSE} data-figure-body><code${PROSE}>${escapeHtml(command)}</code></pre>
</figure>`;
};

const restartBlock = ({ planPath }: { readonly planPath: string }): string =>
  `<h2${PROSE}>Start it again</h2>
${commandBlock({ command: `big-plan review ${planPath}` })}
${tip({ bodyHtml: '<p data-authored-prose="">Run it in any terminal, then reload this page. The address you are on now is the one it will open.</p>' })}`;

// One screen answers every ending. What changes is the sentence under the
// heading, because that is the only part the session files can speak to.
const endingPage = ({
  planPath,
  lede,
}: {
  readonly planPath: string;
  readonly lede: string;
}): string =>
  servicePage({
    title: "This plan review has ended",
    contentHtml: `<h1${PROSE}>This plan review has ended.</h1>
<p${PROSE}>${escapeHtml(lede)}</p>
${restartBlock({ planPath })}`,
  });

/** The page a saved link reaches once its review session has ended. */
export const renderPlanEndedPage = ({
  planPath,
  reason,
  atMs,
}: {
  readonly planPath: string;
  readonly reason: string;
  readonly atMs: number;
}): string =>
  endingPage({
    planPath,
    lede: `The review stopped at ${clockTime(atMs)}. ${reason}`,
  });

/**
 * The page for a session that stopped without recording a reason.
 *
 * A crash cannot write an ending, so the honest claim is that it stopped and
 * when it was last seen. Nothing here says it ended normally, because nothing
 * on disk proves it.
 */
export const renderPlanInterruptedPage = ({
  planPath,
  lastSeenAtMs,
}: {
  readonly planPath: string;
  readonly lastSeenAtMs: number;
}): string =>
  endingPage({
    planPath,
    lede: `The review stopped unexpectedly. Last seen at ${clockTime(lastSeenAtMs)}.`,
  });

/** The page for a plan the service knows about but has never seen reviewed. */
export const renderPlanNeverStartedPage = ({
  planPath,
}: {
  readonly planPath: string;
}): string =>
  servicePage({
    title: "No review has run for this plan",
    contentHtml: `<h1${PROSE}>No review has run for this plan.</h1>
<p${PROSE}>This address is reserved for it, and will open the review once one starts.</p>
${restartBlock({ planPath })}`,
  });

/**
 * The page for an address this machine knows nothing about.
 *
 * It deliberately does not list the plans this machine does know about, so
 * guessing addresses cannot become a way to enumerate someone's work.
 */
export const renderPlanUnknownPage = (): string =>
  servicePage({
    title: "No review at this address",
    contentHtml: `<h1${PROSE}>This machine has no review at this address.</h1>
<p${PROSE}>The link may belong to another machine, or the plan it points at may have been removed.</p>
<h2${PROSE}>Start a review</h2>
${commandBlock({ command: "big-plan review <your-plan.mdx>" })}`,
  });

// The address is set in the monospace token rather than as <code>, because
// inline code in this product carries a chip and an address is not a command
// you would run. The tip below keeps its chip for `big-plan`, which is one.
const welcomeContent = ({
  port,
  startedAtMs,
}: {
  readonly port: number;
  readonly startedAtMs: number;
}): string => `<h1${PROSE}>Welcome to Big Plan.</h1>
<p${PROSE}>Reviewing agent plans is kind of a big deal.</p>
<section class="${CARD}">
<h2 class="plan-slide-title m-0 border-b-0 pb-0 text-2xl">Big Plan service</h2>
<p${PROSE}>Hosted at <span class="font-mono">127.0.0.1:${port}</span>. Running since ${escapeHtml(clockTime(startedAtMs))}.</p>
<p${PROSE}>${button({ label: "Stop the service", variant: "destructive", href: "/stop" })}</p>
<p${PROSE}><em${PROSE}>Stopping means Big Plans on this machine will no longer be accessible through the web browser.</em></p>
</section>
${tip({ bodyHtml: `<p${PROSE}>Managing the Big Plan service is for advanced users only. Any <code${PROSE}>big-plan</code> command will automatically start this service when it needs to.</p>` })}`;

/** The page at `/`: what this process is, to someone who found the port. */
export const renderServiceWelcomePage = ({
  port,
  startedAtMs,
}: {
  readonly port: number;
  readonly startedAtMs: number;
}): string =>
  servicePage({
    title: "Welcome to Big Plan",
    contentHtml: welcomeContent({ port, startedAtMs }),
  });

/**
 * The confirmation, drawn as the review UI's own alert dialog over the page it
 * acts on, so the surface behind it stays legible and the decision reads as
 * one modal question rather than a second page.
 *
 * The nonce is minted per boot, lives only in memory, and is embedded only in
 * pages this process served. It is what lets a browser stop the service
 * without ever holding the owner token that authorizes the CLI.
 */
export const renderServiceStopConfirmPage = ({
  port,
  startedAtMs,
  nonce,
}: {
  readonly port: number;
  readonly startedAtMs: number;
  readonly nonce: string;
}): string =>
  servicePage({
    title: "Stop the service?",
    contentHtml: welcomeContent({ port, startedAtMs }),
    overlayHtml: `<div class="fixed inset-0 z-50 grid place-items-center bg-backdrop/70 p-4" data-modal-backdrop>
<div class="w-full max-w-lg rounded-xl border border-edge bg-raised p-6 text-ink shadow-floating" role="alertdialog" aria-modal="true" aria-labelledby="service-stop-title" aria-describedby="service-stop-description">
<h2 class="m-0 text-xl font-semibold" id="service-stop-title">Stop the service?</h2>
<p class="mt-3 text-base text-muted" id="service-stop-description">Big Plans on this machine will no longer be accessible through the web browser.</p>
<p class="mt-3 text-base text-muted">To start the service again, run any <code${PROSE}>big-plan</code> command (or request a new big plan)</p>
<div class="mt-4">
${tip({ bodyHtml: `<p${PROSE}>Stopping the service here is the same as running <code${PROSE}>big-plan service stop</code> in a terminal.</p>` })}
</div>
<div class="mt-6 flex justify-end gap-2">
${button({ label: "Keep it running", variant: "outline", href: "/" })}
<form method="post" action="/stop">
<input name="nonce" type="hidden" value="${escapeHtml(nonce)}">
${button({ label: "Stop the service", variant: "destructive", submit: true })}
</form>
</div>
</div>
</div>`,
  });

/**
 * The last page this process serves, rendered on its way out.
 *
 * It offers the start command rather than a Start button, because by the time
 * anyone could click one nothing would be listening to receive it.
 */
export const renderServiceStoppedPage = (): string =>
  servicePage({
    title: "The service is stopped",
    contentHtml: `<h1${PROSE}>The service is stopped.</h1>
<p${PROSE}>Reviewing agent plans is kind of a big deal.</p>
<p${PROSE}>Run this in a terminal to open plans again on this machine:</p>
${commandBlock({ command: "big-plan service start" })}
${warning({ bodyHtml: `<p${PROSE}><strong>Reloading this page will show a browser connection error</strong> because nothing is listening on this address any more.</p>` })}`,
  });
