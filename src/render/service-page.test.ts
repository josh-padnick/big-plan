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
import type { ServicePlanRow } from "./service-page.js";

const atMs = Date.parse("2026-08-17T14:41:00.000Z");
const plans: ReadonlyArray<ServicePlanRow> = [
  { name: "review front door", href: "/plan/1111111111111111", state: "live" },
  { name: "retry queue", href: "/plan/2222222222222222", state: "ended" },
];

const welcome = (): string =>
  renderServiceWelcomePage({ port: 8790, startedAtMs: atMs, plans });

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

  it("should ask before stopping with the review UI's alert dialog", () => {
    const html = renderServiceStopConfirmPage({
      port: 8790,
      startedAtMs: atMs,
      plans,
      nonce: "nonce-value",
    });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(
      'class="w-full max-w-lg rounded-xl border border-edge bg-paper p-6 text-ink shadow-floating"',
    );
    // The destructive and outline button recipes, by value from ui.browser.tsx.
    expect(html).toContain("bg-danger font-semibold text-danger-ink");
    expect(html).toContain("border border-edge bg-transparent font-normal");
  });

  it("should keep the stop flow working with scripts disabled", () => {
    expect(welcome()).toContain('href="/stop"');
    const confirm = renderServiceStopConfirmPage({
      port: 8790,
      startedAtMs: atMs,
      plans,
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
      plans,
      nonce: "n",
    });
    expect(html).toContain("Plans on this machine stop opening.");
    expect(html).toContain("big-plan service stop");
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
    expect(html).toContain("Start it again to open plans on this machine.");
    expect(html).toContain("big-plan service start");
    // No start control, because nothing is listening to receive one.
    expect(html).not.toContain('action="/start"');
    expect(html).not.toContain('href="/start"');
  });

  it("should list the plans it answers for, and say so when it has none", () => {
    const html = welcome();
    expect(html).toContain("Plans on this machine");
    expect(html).toContain('href="/plan/1111111111111111"');
    expect(html).toContain("review front door");
    expect(html).toContain("Open now");
    expect(html).toContain("retry queue");
    expect(html).toContain("Ended");

    const empty = renderServiceWelcomePage({
      port: 8790,
      startedAtMs: atMs,
      plans: [],
    });
    expect(empty).toContain("None yet.");
  });

  it("should never enumerate plans from an address it does not know", () => {
    // Guessing addresses must not become a way to list someone's work.
    const html = renderPlanUnknownPage();
    expect(html).toContain("This machine has no review at this address.");
    expect(html).not.toContain("Plans on this machine");
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
