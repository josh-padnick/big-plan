// The small, inert HTML pages the service serves in its own right.
//
// These are not plan documents. A plan document is compiled through the
// renderer and carries the whole embedded stylesheet; these are four short
// pages that must render before anyone has installed anything, so they carry
// a hand-written stylesheet in the same warm palette rather than importing a
// quarter-megabyte of plan CSS.
//
// The content floor is the same as a plan's: everything a visitor needs is
// readable with scripts disabled. The one script copies a command to the
// clipboard, and the command is visible text whether or not it runs.

import { escapeHtml } from "../../render/escape-html.js";

// The plan document's own light and dark greys, so a visitor who lands here
// from a review does not feel they left the product. Kept deliberately small:
// the design system owns the scales, and this page uses four of them.
const STYLES = `
:root {
  color-scheme: light dark;
  --paper: light-dark(#fefdfb, #1b1916);
  --surface: light-dark(#efece3, #242119);
  --ink: light-dark(#211e1a, #ebe6da);
  --muted: light-dark(#4f4a3f, #e2ddd1);
  --edge: light-dark(#e2ddd1, #35312a);
  --accent: light-dark(#166534, #82c99a);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 3rem 1.25rem;
  background: var(--paper);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 1rem;
  line-height: 1.55;
}
main { margin: 0 auto; max-width: 34rem; }
h1 { margin: 0 0 0.5rem; font-size: 1.5rem; font-weight: 700; line-height: 1.25; }
p { margin: 0 0 1rem; }
p.lede { color: var(--muted); }
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
button {
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--accent);
  border-radius: 0.5rem;
  background: var(--accent);
  color: var(--paper);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
}: {
  readonly title: string;
  readonly body: string;
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
<main>
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
<button type="button" data-copy="${escapeHtml(command)}">Copy this command</button>
<footer>Run it in any terminal, then reload this page.</footer>`;
};

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
  page({
    title: "This plan review has ended",
    body: `<h1>This plan review has ended.</h1>
<p class="lede">Stopped at ${escapeHtml(clockTime(atMs))}. ${escapeHtml(reason)}</p>
${restartBlock({ planPath })}`,
  });

/**
 * The page for a session that stopped without recording a reason.
 *
 * A crash cannot write an ending, so the honest claim is that it stopped and
 * when it was last seen. Nothing here says "ended normally", because nothing
 * on disk proves it.
 */
export const interruptedReviewPage = ({
  planPath,
  lastSeenAtMs,
}: {
  readonly planPath: string;
  readonly lastSeenAtMs: number;
}): string =>
  page({
    title: "This plan review stopped unexpectedly",
    body: `<h1>This plan review stopped unexpectedly.</h1>
<p class="lede">Last seen at ${escapeHtml(clockTime(lastSeenAtMs))}.</p>
${restartBlock({ planPath })}`,
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

/**
 * The placeholder identity page at `/`.
 *
 * Someone who found a listening port and opened it deserves an answer before
 * the full identity page ships, so this names the process and how to stop it.
 */
export const identityPage = ({
  port,
  startedAtMs,
}: {
  readonly port: number;
  readonly startedAtMs: number;
}): string =>
  page({
    title: "Big Plan service",
    body: `<h1>This is the Big Plan service.</h1>
<p class="lede">It answers saved review links on 127.0.0.1:${port}, so a link still works after the review session behind it ends. It is reachable from this machine only.</p>
<p>Running since ${escapeHtml(clockTime(startedAtMs))}.</p>
<p class="label">Stop it</p>
<pre>${escapeHtml("big-plan service stop")}</pre>
<button type="button" data-copy="big-plan service stop">Copy this command</button>
<footer>Any <code>big-plan</code> command starts it again when it needs to.</footer>`,
  });
