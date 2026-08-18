// The small, inert HTML pages the service serves in its own right.
//
// These are not plan documents. A plan document is compiled through the
// renderer and carries the whole embedded stylesheet; these are short pages
// that must render before anyone has installed anything, so they carry a
// hand-written stylesheet in the same warm palette rather than importing a
// quarter-megabyte of plan CSS.
//
// Two rules govern how they look, both learned from wireframe review:
//
//  - Hierarchy carries containment (BIG-151). A value inside a card is never
//    louder than the card's own title, and a card title is never louder than
//    the page heading. The failure this prevents is a settings value rendering
//    as a headline because each element maximized its own emphasis.
//  - Nothing sits flush against the edge that contains it (BIG-152), and only
//    `:focus-visible` ever paints a focus ring.
//
// The content floor is the same as a plan's: every page is readable and every
// flow completable with scripts disabled. The stop flow is a link to a confirm
// page and a form post, not a JavaScript handler; the one script copies a
// command that is visible text whether or not it runs.

import { escapeHtml } from "../../render/escape-html.js";

// The plan document's own light and dark greys, so a visitor who lands here
// from a review does not feel they left the product. Kept deliberately small:
// the design system owns the scales, and these pages use a few steps of them.
const STYLES = `
:root {
  color-scheme: light dark;
  --paper: light-dark(#fefdfb, #1b1916);
  --surface: light-dark(#f7f5f0, #242119);
  --ink: light-dark(#211e1a, #ebe6da);
  --muted: light-dark(#4f4a3f, #c9c3b5);
  --edge: light-dark(#e2ddd1, #35312a);
  --accent: light-dark(#166534, #82c99a);
  --accent-ink: light-dark(#fefdfb, #1b1916);
  --danger: light-dark(#9f1239, #f4a2b4);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 1rem;
  line-height: 1.55;
}
header {
  display: flex;
  gap: 1rem;
  align-items: baseline;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--edge);
}
header .wordmark { font-size: 1.0625rem; font-weight: 700; letter-spacing: -0.01em; }
main { margin: 0 auto; max-width: 36rem; padding: 3rem 1.5rem; }
h1 { margin: 0 0 0.375rem; font-size: 1.75rem; font-weight: 700; line-height: 1.2; }
p { margin: 0 0 1rem; }
p.lede { color: var(--muted); }
.rule { margin: 1.75rem 0; border: 0; border-top: 1px solid var(--edge); }
.card {
  margin: 0 0 1.5rem;
  padding: 1.25rem 1.375rem;
  border: 1px solid var(--edge);
  border-radius: 0.625rem;
  background: var(--surface);
}
/* Containment: a card title steps down from the page heading, and the values
   inside it step down again. Never the other way round. */
.card h2 { margin: 0 0 0.75rem; font-size: 1.0625rem; font-weight: 600; line-height: 1.3; }
.card p { margin: 0 0 0.625rem; font-size: 0.9375rem; color: var(--muted); }
.card p:last-child { margin-bottom: 0; }
.card .actions { margin-top: 1.125rem; }
.actions { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
p.label { margin-bottom: 0.5rem; font-weight: 600; }
pre {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  border: 1px solid var(--edge);
  border-radius: 0.5rem;
  background: var(--surface);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875rem;
}
button, .button {
  display: inline-block;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--accent);
  border-radius: 0.5rem;
  background: var(--accent);
  color: var(--accent-ink);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
.button-danger {
  border-color: var(--danger);
  background: transparent;
  color: var(--danger);
}
.button-quiet {
  border-color: transparent;
  background: transparent;
  color: var(--muted);
  text-decoration: underline;
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
form { display: contents; }
footer { margin-top: 2.5rem; color: var(--muted); font-size: 0.875rem; }
`.trim();

// Copying is a convenience over text that is already on the page, so the
// script never gates anything and quietly does nothing where the clipboard is
// unavailable.
const COPY_SCRIPT = `
document.querySelectorAll("[data-copy]").forEach(function (button) {
  button.addEventListener("click", function () {
    var text = button.getAttribute("data-copy") || "";
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function () {
      button.textContent = "Copied";
    });
  });
});
`.trim();

const page = ({
  title,
  body,
  header = false,
}: {
  readonly title: string;
  readonly body: string;
  readonly header?: boolean;
}): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${header ? `<header><span class="wordmark">Big Plan</span></header>\n` : ""}<main>
${body}
</main>
<script>${COPY_SCRIPT}</script>
</body>
</html>
`;

// A clock time is what a person recognises in "the review stopped at 2:41 AM".
// The date is left off because every case this renders is recent by
// construction: a link clicked after a session ended.
const clockTime = (atMs: number): string =>
  Number.isFinite(atMs)
    ? new Date(atMs).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "an unknown time";

const restartBlock = ({ planPath }: { readonly planPath: string }): string => {
  const command = `big-plan review ${planPath}`;
  return `<p class="label">Start it again</p>
<pre>${escapeHtml(command)}</pre>
<p class="actions"><button type="button" data-copy="${escapeHtml(command)}">Copy this command</button></p>
<footer>Run it in any terminal, then reload this page.</footer>`;
};

// One screen answers every ending. What changes is the sentence under the
// heading, because that is the only part the session files can speak to.
const endingPage = ({
  planPath,
  lede,
}: {
  readonly planPath: string;
  readonly lede: string;
}): string =>
  page({
    title: "This plan review has ended",
    body: `<h1>This plan review has ended.</h1>
<p class="lede">${escapeHtml(lede)}</p>
${restartBlock({ planPath })}`,
  });

/** The page a saved link reaches once its review session has ended. */
export const endedReviewPage = ({
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
export const interruptedReviewPage = ({
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
export const neverStartedReviewPage = ({
  planPath,
}: {
  readonly planPath: string;
}): string =>
  page({
    title: "No review has run for this plan",
    body: `<h1>No review has run for this plan.</h1>
<p class="lede">This address is reserved for it, and will open the review once one starts.</p>
${restartBlock({ planPath })}`,
  });

/**
 * The page for an address this machine knows nothing about.
 *
 * It deliberately does not list the reviews this machine does know about. A
 * directory of every live review is a separate, paid capability, and guessing
 * addresses should not be a way to enumerate someone's plans.
 */
export const unknownPlanPage = (): string =>
  page({
    title: "No review at this address",
    body: `<h1>This machine has no review at this address.</h1>
<p class="lede">The link may belong to another machine, or the plan it points at may have been removed.</p>
<p class="label">Start a review</p>
<pre>${escapeHtml("big-plan review <your-plan.mdx>")}</pre>`,
  });

const WELCOME = `<h1>Welcome to Big Plan.</h1>
<p class="lede">Reviewing agent plans is kind of a big deal. Do it better with Big Plan.</p>
<hr class="rule">`;

/**
 * The page at `/`: what this process is, to someone who found the port.
 *
 * Opening a listening port in a browser is the first thing a curious person
 * does, so this answers completely on its own and offers the way out. Stop is
 * a link rather than a scripted button, so the whole flow works with scripts
 * disabled.
 */
export const identityPage = ({
  port,
  startedAtMs,
}: {
  readonly port: number;
  readonly startedAtMs: number;
}): string =>
  page({
    header: true,
    title: "Welcome to Big Plan",
    body: `${WELCOME}
<section class="card">
<h2>Big Plan service</h2>
<p>Hosted at 127.0.0.1:${port}. Plans on this machine are available here.</p>
<p>Running since ${escapeHtml(clockTime(startedAtMs))}.</p>
<p class="actions"><a class="button button-danger" href="/stop">Stop the service</a></p>
</section>`,
  });

/**
 * The confirmation shown immediately before the service stops.
 *
 * The nonce is minted per boot, lives only in memory, and is embedded only in
 * pages this process served. It is what lets a browser stop the service
 * without ever holding the owner token that authorizes the CLI.
 */
export const confirmStopPage = ({
  nonce,
}: {
  readonly nonce: string;
}): string =>
  page({
    header: true,
    title: "Stop the service?",
    body: `<h1>Stop the service?</h1>
<p class="lede">Saved review links stop opening until the service starts again.</p>
<section class="card">
<h2>What changes</h2>
<p>Nothing is listening on this address after you stop.</p>
<p>Any big-plan command starts the service again.</p>
<p>No plan, comment, or feedback file is touched.</p>
</section>
<p class="lede">Same as running: <code>big-plan service stop</code></p>
<p class="actions">
<form method="post" action="/stop">
<input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
<button class="button-danger" type="submit">Stop the service</button>
</form>
<a class="button button-quiet" href="/">Keep it running</a>
</p>`,
  });

/**
 * The last page this process serves, rendered on its way out.
 *
 * It offers the start command rather than a Start button, because by the time
 * anyone could click one nothing would be listening to receive it. Reloading
 * this address after now correctly fails.
 */
export const serviceStoppedPage = (): string =>
  page({
    header: true,
    title: "The service is stopped",
    body: `<h1>The service is stopped.</h1>
<p class="lede">Nothing is listening on this address, so saved review links will not open until it starts again.</p>
<p class="label">Start it again</p>
<pre>${escapeHtml("big-plan service start")}</pre>
<p class="actions"><button type="button" data-copy="big-plan service start">Copy this command</button></p>
<footer>Any <code>big-plan</code> command that prints a review link also starts it again.</footer>`,
  });
