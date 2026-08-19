// Proves the service's pages are Big Plan surfaces rather than lookalikes:
// the same toolbar a review document renders, the same embedded stylesheet,
// and the same card, callout, dialog, and button recipes the product already
// uses. A bespoke visual vocabulary here would drift the moment the design
// system moved.

import { describe, expect, it } from "vitest";
import { GLOBAL_CSS } from "./global.generated.js";
import {
  renderPlanEndedPage,
  renderPlanInterruptedPage,
  renderPlanNeverStartedPage,
  renderPlanUnknownPage,
  renderServiceStopConfirmPage,
  renderServiceStoppedPage,
  renderServiceWelcomePage,
} from "./service-page.js";
const atMs = Date.parse("2026-08-17T14:41:00.000Z");

const welcome = (): string =>
  renderServiceWelcomePage({ port: 8790, startedAtMs: atMs });

describe("the service's pages", () => {
  it("should render the same toolbar a review document renders", () => {
    // Not a lookalike: the shell's own branding bar, from renderShell.
    const html = welcome();
    expect(html).toContain(
      '<header class="sticky top-0 z-40 h-11 border-b border-edge bg-paper/90 backdrop-blur">',
    );
    expect(html).toContain("data-logo-light");
    expect(html).toContain("data-logo-dark");
    expect(html).toContain("https://big-plan.ai");
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
    // The consequence belongs beside the button, not only behind it.
    const html = welcome();
    expect(html).toContain(
      "Stopping means Big Plans on this machine will no longer be accessible through the web browser.",
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
    expect(html).not.toContain("data-copy=");
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

  it("should not seize focus when the alert opens", () => {
    // An uninvited focus ring reads as an error state. Tabbing still works,
    // because :focus-visible paints only what the keyboard asked for.
    const html = renderServiceStopConfirmPage({
      port: 8790,
      startedAtMs: atMs,
      nonce: "n",
    });
    expect(html).not.toContain("autofocus");
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
    // The card still says plans are reachable here, which is the ratified
    // wireframe's line; what is gone is any enumeration of them.
    expect(html).toContain("Plans on this machine are available here.");
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
