// Proves the service's pages are Big Plan surfaces rather than lookalikes:
// the same toolbar a review document renders, the same embedded stylesheet,
// and the same card, callout, dialog, and button recipes the product already
// uses. A bespoke visual vocabulary here would drift the moment the design
// system moved.

import type { Element, Root } from "hast";
import { fromHtml } from "hast-util-from-html";
import { describe, expect, it, vi } from "vitest";
import { GLOBAL_CSS } from "./global.generated.js";
import {
  AGENT_SETUP_PROMPT,
  renderPlanEndedPage,
  renderPlanInterruptedPage,
  renderPlanNeverStartedPage,
  renderPlanRestartingPage,
  renderPlanUnknownPage,
  renderServiceStopConfirmPage,
  renderServiceStoppedPage,
  renderServiceWelcomePage,
} from "./service-page.js";
const atMs = Date.parse("2026-08-17T14:41:00.000Z");

const welcome = (): string =>
  renderServiceWelcomePage({ port: 8790, startedAtMs: atMs, now: atMs });

// Finds a rendered element without coupling assertions to serializer ordering.
const firstElement = (
  root: Root | Element,
  tagName: string,
): Element | undefined => {
  for (const child of root.children) {
    if (child.type !== "element") continue;
    if (child.tagName === tagName) return child;
    const nested = firstElement(child, tagName);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

// A page is formatted with whatever locale the machine running it has, so a
// rule about how a moment reads can only be checked against a locale the test
// names.
const formatTime = Date.prototype.toLocaleTimeString;
const formatDate = Date.prototype.toLocaleDateString;
const inLocale = (locale: string, render: () => string): string => {
  const pinnedTime = vi
    .spyOn(Date.prototype, "toLocaleTimeString")
    .mockImplementation(function (
      this: Date,
      _locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ): string {
      return formatTime.call(this, locale, options);
    });
  const pinnedDate = vi
    .spyOn(Date.prototype, "toLocaleDateString")
    .mockImplementation(function (
      this: Date,
      _locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ): string {
      return formatDate.call(this, locale, options);
    });
  try {
    return render();
  } finally {
    pinnedTime.mockRestore();
    pinnedDate.mockRestore();
  }
};

// `now` decides whether the service started today.
const welcomeIn = (
  locale: string,
  startedAtMs: number,
  now: number = startedAtMs,
): string =>
  inLocale(locale, () =>
    renderServiceWelcomePage({ port: 8790, startedAtMs, now }),
  );

describe("the service's pages", () => {
  it("should render the shell toolbar with its fixed stacking contract", () => {
    // Not a lookalike: the shell's own branding bar, from renderShell.
    const html = welcome();
    const header = firstElement(fromHtml(html), "header");
    expect(header?.properties.className).toEqual(
      expect.arrayContaining(["fixed", "inset-x-0", "top-0", "z-50"]),
    );
    expect(header?.properties.className).not.toContain("z-40");
    expect(html).toContain("data-logo-light");
    expect(html).toContain("data-logo-dark");
    expect(html).toContain("https://bigplan.dev");
  });

  it("should carry the product's own stylesheet, not one of its own", () => {
    expect(welcome()).toContain(GLOBAL_CSS);
  });

  it("should draw its card with the deck's slide card recipe", () => {
    expect(welcome()).toContain(
      'class="plan-slide plan-card box-border rounded-xl bg-raised shadow-raised"',
    );
  });

  it("should draw a tip with the Callout component's markup", () => {
    const html = welcome();
    expect(html).toContain('data-callout="tip"');
    expect(html).toContain('class="callout-title text-sm leading-5">Tip<');
  });

  it("should say what stopping does before the control is clicked", () => {
    // The consequence belongs beside the button, not only behind it, and it
    // reads as an aside to the control rather than as another instruction.
    const html = welcome();
    expect(html).toContain(
      '<em data-authored-prose="">Stopping means Big Plans on this machine will no longer be accessible through the web browser.</em>',
    );
  });

  it("should state where it lives and how long it has run in one line", () => {
    const html = welcome();
    expect(html).toContain(
      'Hosted at <span class="font-mono">127.0.0.1:8790</span>. Running since',
    );
    // An address is monospace, not a code chip: the chip belongs to commands.
    expect(html).not.toContain('<code data-authored-prose="">127.0.0.1');
    // The old second sentence and its separate line are gone.
    expect(html).not.toContain("Plans on this machine are available here.");
  });

  it("should write a time the way a person says it", () => {
    // "6:15 PM" is how a formatter writes it; "6:15pm" is how a person does.
    const quarterPastSix = Date.parse("2026-08-18T18:15:00");
    const spoken = welcomeIn("en-US", quarterPastSix);
    expect(spoken).toContain("Running since 6:15pm.");
    expect(spoken).not.toMatch(/\d\s(AM|PM)/u);
  });

  it("should leave a 24-hour locale's time exactly as that locale writes it", () => {
    // There is no meridiem to rewrite, and inventing one would be wrong.
    expect(welcomeIn("en-GB", Date.parse("2026-08-18T18:15:00"))).toContain(
      "Running since 18:15.",
    );
  });

  it("should name the day when this process did not start today", () => {
    // The service has no idle timeout, so a bare clock on a process that
    // started days ago would read as this afternoon.
    const quarterPastSix = Date.parse("2026-08-18T18:15:00");
    const threeDaysLater = Date.parse("2026-08-21T09:00:00");
    expect(welcomeIn("en-US", quarterPastSix, threeDaysLater)).toContain(
      "Running since Aug 18, 6:15pm.",
    );
  });

  it("should say nothing about the day for a service started today", () => {
    // The approved one-line form, unchanged in the case a reader sees most.
    const quarterPastSix = Date.parse("2026-08-18T18:15:00");
    const laterToday = Date.parse("2026-08-18T23:59:00");
    const html = welcomeIn("en-US", quarterPastSix, laterToday);
    expect(html).toContain("Running since 6:15pm.");
    expect(html).not.toMatch(/Running since \w+ \d+,/u);
  });

  it("should name who the service page is for", () => {
    const html = welcome();
    expect(html).toContain(
      "Managing the Big Plan service is for advanced users only.",
    );
    expect(html).toContain(
      "will automatically start this service when it needs to.",
    );
  });

  it("should copy a command with the product's own control", () => {
    // The hover-revealed icon control from the figure-control vocabulary, so
    // the viewer script wires it exactly as it wires a fenced block in a plan.
    const html = renderServiceStoppedPage();
    expect(html).toContain("data-copy-code");
    expect(html).toContain('class="code-figure');
    expect(html).toContain('data-lucide="copy"');
    expect(html).toContain('data-lucide="check"');
    // The bespoke green button is gone.
    expect(html).not.toContain("Copy this command");
  });

  it("should ask before stopping with the review UI's alert dialog", () => {
    const html = renderServiceStopConfirmPage({
      port: 8790,
      startedAtMs: atMs,
      nonce: "nonce-value",
    });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    // A defined backdrop, so the page behind an alert is visibly dimmed, and a
    // raised surface, so the dialog reads as floating through colour.
    expect(html).toContain("bg-backdrop/70");
    expect(html).toContain("data-modal-backdrop");
    expect(html).toContain(
      'class="w-full max-w-lg rounded-xl border border-edge bg-raised p-6 text-ink shadow-floating"',
    );
    // Danger is the destructive action's alone; the dialog carries no tint.
    expect(html).not.toContain("bg-danger p-6");
    // The destructive and outline button recipes, by value from ui.browser.tsx.
    expect(html).toContain("bg-danger font-semibold text-danger-ink");
    expect(html).toContain("border border-edge bg-transparent font-normal");
  });

  it("should keep the stop flow working with scripts disabled", () => {
    expect(welcome()).toContain('href="/stop"');
    const confirm = renderServiceStopConfirmPage({
      port: 8790,
      startedAtMs: atMs,
      nonce: "nonce-value",
    });
    expect(confirm).toContain('method="post"');
    expect(confirm).toContain('action="/stop"');
    expect(confirm).toContain('value="nonce-value"');
  });

  it("should say what stopping means without listing consequences twice", () => {
    const html = renderServiceStopConfirmPage({
      port: 8790,
      startedAtMs: atMs,
      nonce: "n",
    });
    expect(html).toContain(
      "Big Plans on this machine will no longer be accessible through the web browser.",
    );
    expect(html).toContain("To start the service again, run any");
    expect(html).toContain("Stopping the service here is the same as running");
    expect(html).toContain("Keep it running");
    // The wordier earlier copy is gone rather than merely demoted.
    expect(html).not.toContain("What changes");
    expect(html).not.toContain(
      "Saved review links stop opening until the service starts again.",
    );
  });

  it("should tell a reader of the stopped page one plain thing to do", () => {
    const html = renderServiceStoppedPage();
    expect(html).toContain("The service is stopped.");
    expect(html).toContain("Reviewing agent plans is kind of a big deal.");
    expect(html).toContain(
      "Run this in a terminal to open plans again on this machine:",
    );
    expect(html).toContain("big-plan service start");
    // A warning, not a tip: reloading this page fails, and that reads as a
    // caution rather than as advice.
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain(
      "<strong>Reloading this page will show a browser connection error</strong> because nothing is listening on this address any more.",
    );
    // No start control, because nothing is listening to receive one.
    expect(html).not.toContain('action="/start"');
    expect(html).not.toContain('href="/start"');
  });

  it("should not list the plans on this machine anywhere", () => {
    // Ruled a paid upgrade: the free service answers an address it is given
    // and never becomes a directory of someone's work.
    const html = welcome();
    expect(html).not.toContain(
      '<h2 data-authored-prose="">Plans on this machine</h2>',
    );
    expect(html).not.toContain("/plan/");
  });

  it("should never enumerate plans from an address it does not know", () => {
    // Guessing addresses must not become a way to list someone's work.
    const html = renderPlanUnknownPage();
    expect(html).toContain("This machine has no review at this address.");
    expect(html).not.toContain("/plan/");
  });

  it("should hand the unknown-address reader the agent prompt before the CLI", () => {
    const html = renderPlanUnknownPage();
    expect(html).toContain(AGENT_SETUP_PROMPT);
    expect(html).toContain('aria-label="Copy prompt"');
    expect(html).toContain("data-copy-label");
    expect(html.indexOf(AGENT_SETUP_PROMPT)).toBeLessThan(
      html.indexOf("big-plan review &lt;your-plan.mdx&gt;"),
    );
    expect(html).toContain("Or run this yourself:");
  });

  it("should quote a recorded ending and never invent one", () => {
    const ended = renderPlanEndedPage({
      planPath: "/work/plan.mdx",
      reason: "The review session was stopped by the reviewer.",
      atMs,
    });
    expect(ended).toContain("This plan review has ended.");
    expect(ended).toContain("The review session was stopped by the reviewer.");
    expect(ended).toContain("big-plan review /work/plan.mdx");

    const interrupted = renderPlanInterruptedPage({
      planPath: "/work/plan.mdx",
      lastSeenAtMs: atMs,
    });
    expect(interrupted).toContain("The review stopped unexpectedly.");
    expect(interrupted).not.toContain("ended normally");
  });

  it("should hold an unexpectedly stopped review at its stable address", () => {
    const restarting = renderPlanRestartingPage({
      planPath: "/work/plan.mdx",
    });
    expect(restarting).toContain("The review is restarting.");
    expect(restarting).toContain("Reload this page");
    expect(restarting).toContain("big-plan review /work/plan.mdx");
    expect(restarting).not.toContain("ended normally");
  });

  it("should name the day an ending fell on", () => {
    // A review now stays up until someone stops it, so an ending is no longer
    // recent by construction: a saved link clicked days later would read a
    // bare clock time as today.
    const lastWeek = Date.parse("2026-08-12T02:41:00");
    expect(
      inLocale("en-US", () =>
        renderPlanEndedPage({
          planPath: "/work/plan.mdx",
          reason: "The review session was stopped by the reviewer.",
          atMs: lastWeek,
        }),
      ),
    ).toContain("The review stopped at Aug 12, 2:41am.");
    expect(
      inLocale("en-US", () =>
        renderPlanInterruptedPage({
          planPath: "/work/plan.mdx",
          lastSeenAtMs: lastWeek,
        }),
      ),
    ).toContain("Last seen at Aug 12, 2:41am.");
  });

  it("should name the day even for an ending that happened today", () => {
    // The reader cannot tell which day they saved the link on, so the page
    // never leaves them to infer it.
    const thisMorning = Date.parse("2026-08-19T09:12:00");
    expect(
      inLocale("en-US", () =>
        renderPlanEndedPage({
          planPath: "/work/plan.mdx",
          reason: "The review session was stopped by the reviewer.",
          atMs: thisMorning,
        }),
      ),
    ).toContain("The review stopped at Aug 19, 9:12am.");
  });

  it("should still speak plainly about an ending it cannot date", () => {
    // A session file with no usable moment must not print "Invalid Date".
    const undated = inLocale("en-US", () =>
      renderPlanEndedPage({
        planPath: "/work/plan.mdx",
        reason: "The review session was stopped by the reviewer.",
        atMs: Number.NaN,
      }),
    );
    expect(undated).toContain("The review stopped at an unknown time.");
    expect(undated).not.toContain("Invalid Date");
  });

  it("should hand over a command that runs for a path with a space in it", () => {
    // The page exists to give the reader the one command that restarts the
    // review; unquoted, the shell would split this path into two arguments.
    const html = renderPlanNeverStartedPage({
      planPath: "/work/My Plans/plan.mdx",
    });
    expect(html).toContain("big-plan review '/work/My Plans/plan.mdx'");
    // An ordinary path still reads exactly as it was ratified.
    expect(
      renderPlanNeverStartedPage({ planPath: "/work/plan.mdx" }),
    ).toContain("big-plan review /work/plan.mdx");
  });

  it("should escape a plan path and a stop reason read from disk", () => {
    const html = renderPlanNeverStartedPage({
      planPath: '/work/<script>alert("x")</script>.mdx',
    });
    expect(html).not.toContain('<script>alert("x")</script>.mdx');
    expect(html).toContain("&lt;script&gt;");

    const ended = renderPlanEndedPage({
      planPath: "/work/plan.mdx",
      reason: '</p><img src=x onerror="alert(1)">',
      atMs,
    });
    expect(ended).not.toContain('<img src=x onerror="alert(1)">');
  });
});
