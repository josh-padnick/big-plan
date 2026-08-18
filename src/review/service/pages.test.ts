// Proves the service's own pages stay inert and never claim more than the
// session files prove. The plan path and the stop reason are read from disk,
// so both are treated as text that could contain anything.

import { describe, expect, it } from "vitest";
import {
  endedReviewPage,
  identityPage,
  interruptedReviewPage,
  neverStartedReviewPage,
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
    expect(html).toContain("stopped unexpectedly");
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

  it("should name the process and how to stop it on the identity page", () => {
    const html = identityPage({ port: 8790, startedAtMs: atMs });
    expect(html).toContain("Big Plan service");
    expect(html).toContain("127.0.0.1:8790");
    expect(html).toContain("big-plan service stop");
  });

  it("should reach every visitor without scripts and without outbound requests", () => {
    const pages = [
      endedReviewPage({ planPath: "/p.mdx", reason: "Stopped.", atMs }),
      interruptedReviewPage({ planPath: "/p.mdx", lastSeenAtMs: atMs }),
      neverStartedReviewPage({ planPath: "/p.mdx" }),
      unknownPlanPage(),
      identityPage({ port: 8790, startedAtMs: atMs }),
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
