// Proves the service's own pages stay inert and never claim more than the
// session files prove. The plan path and the stop reason are read from disk,
// so both are treated as text that could contain anything.

import { describe, expect, it } from "vitest";
import {
  confirmStopPage,
  endedReviewPage,
  identityPage,
  interruptedReviewPage,
  neverStartedReviewPage,
  serviceStoppedPage,
  unknownPlanPage,
} from "./pages.js";

const atMs = Date.parse("2026-08-17T14:41:00.000Z");

describe("service pages", () => {
  it("should quote the recorded ending rather than inventing one", () => {
    const html = endedReviewPage({
      planPath: "/work/plan.mdx",
      reason:
        "The review session ended normally after 30 minutes of inactivity.",
      atMs,
    });
    expect(html).toContain("This plan review has ended.");
    expect(html).toContain(
      "The review session ended normally after 30 minutes of inactivity.",
    );
    expect(html).toContain("big-plan review /work/plan.mdx");
  });

  it("should never claim a clean ending it cannot prove", () => {
    const html = interruptedReviewPage({
      planPath: "/work/plan.mdx",
      lastSeenAtMs: atMs,
    });
    expect(html).toContain("The review stopped unexpectedly.");
    expect(html).toContain("Last seen at");
    expect(html).not.toContain("ended normally");
  });

  it("should escape a plan path that contains markup", () => {
    const html = neverStartedReviewPage({
      planPath: '/work/<script>alert("x")</script>.mdx',
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("should escape a stop reason that contains markup", () => {
    const html = endedReviewPage({
      planPath: "/work/plan.mdx",
      reason: '</p><img src=x onerror="alert(1)">',
      atMs,
    });
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img");
  });

  it("should not enumerate other plans from an address it does not know", () => {
    // A directory of every live review is a separate capability, and guessing
    // addresses must not become a way to list someone's plans.
    const html = unknownPlanPage();
    expect(html).toContain("This machine has no review at this address.");
    expect(html).not.toContain("/plan/");
  });

  it("should welcome a visitor and name the service on the identity page", () => {
    const html = identityPage({ port: 8790, startedAtMs: atMs });
    expect(html).toContain("Welcome to Big Plan.");
    expect(html).toContain(
      "Reviewing agent plans is kind of a big deal. Do it better with Big Plan.",
    );
    expect(html).toContain("Big Plan service");
    expect(html).toContain(
      "Hosted at 127.0.0.1:8790. Plans on this machine are available here.",
    );
    expect(html).toContain("Running since");
    expect(html).toContain("Stop the service");
  });

  it("should keep the stop flow reachable with scripts disabled", () => {
    // The route out of a background process nobody wanted must not depend on
    // JavaScript: a link to a confirm page, then a form post.
    const identity = identityPage({ port: 8790, startedAtMs: atMs });
    expect(identity).toContain('href="/stop"');
    const confirm = confirmStopPage({ nonce: "nonce-value" });
    expect(confirm).toContain('method="post"');
    expect(confirm).toContain('action="/stop"');
    expect(confirm).toContain('value="nonce-value"');
  });

  it("should state the consequence and the command before the stop button", () => {
    const html = confirmStopPage({ nonce: "n" });
    expect(html).toContain("Stop the service?");
    expect(html).toContain(
      "Saved review links stop opening until the service starts again.",
    );
    expect(html).toContain(
      "Nothing is listening on this address after you stop.",
    );
    expect(html).toContain("Any big-plan command starts the service again.");
    expect(html).toContain("big-plan service stop");
    expect(html).toContain("Keep it running");
    // The consequence panel precedes the control that causes it.
    expect(html.indexOf("What changes")).toBeLessThan(
      html.indexOf('type="submit"'),
    );
  });

  it("should offer the start command rather than a button nothing can receive", () => {
    // By the time this page is read the listener is closing, so a Start button
    // would post into nothing.
    const html = serviceStoppedPage();
    expect(html).toContain("The service is stopped.");
    expect(html).toContain("big-plan service start");
    expect(html).not.toContain('href="/start"');
    expect(html).not.toContain('action="/start"');
  });

  it("should keep a value quieter than the box and the heading that contain it", () => {
    // Containment hierarchy: a settings value rendering as a headline is the
    // failure this ordering prevents.
    const html = identityPage({ port: 8790, startedAtMs: atMs });
    const heading = /h1 \{[^}]*font-size: ([\d.]+)rem/u.exec(html)?.[1];
    const cardTitle = /\.card h2 \{[^}]*font-size: ([\d.]+)rem/u.exec(
      html,
    )?.[1];
    const cardBody = /\.card p \{[^}]*font-size: ([\d.]+)rem/u.exec(html)?.[1];
    expect(Number(heading)).toBeGreaterThan(Number(cardTitle));
    expect(Number(cardTitle)).toBeGreaterThan(Number(cardBody));
  });

  it("should paint a focus ring only for keyboard focus", () => {
    const html = identityPage({ port: 8790, startedAtMs: atMs });
    expect(html).toContain(":focus-visible");
    expect(html).not.toMatch(/[^-]:focus\s*\{/u);
  });

  it("should reach every visitor without scripts and without outbound requests", () => {
    const pages = [
      endedReviewPage({ planPath: "/p.mdx", reason: "Stopped.", atMs }),
      interruptedReviewPage({ planPath: "/p.mdx", lastSeenAtMs: atMs }),
      neverStartedReviewPage({ planPath: "/p.mdx" }),
      unknownPlanPage(),
      identityPage({ port: 8790, startedAtMs: atMs }),
      confirmStopPage({ nonce: "n" }),
      serviceStoppedPage(),
    ];
    for (const html of pages) {
      expect(html).toContain("<!doctype html>");
      // Nothing is fetched, imported, or linked from anywhere else, which is
      // what keeps the product's no-external-requests promise intact.
      expect(html).not.toMatch(/<(link|img|iframe|source)\b/u);
      expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/u);
    }
  });
});
