// Tests the shell's script-dependent affordances at the markup level, where
// their no-JS behaviour is decided. Reading-journey behaviour belongs in the
// Playwright specs; this file only asserts what the emitted HTML promises.

import { describe, expect, it } from "vitest";
import { renderShell } from "./shell.js";

const shellFor = (contentHtml: string) =>
  renderShell({
    nav: [{ id: "one", label: "One" }],
    title: "Test plan",
    contentIds: ["one"],
    contentHtml,
  }).html;

const standaloneShellFor = (contentHtml: string) =>
  renderShell({
    nav: [],
    title: "Big Plan service",
    contentIds: [],
    contentHtml,
    chrome: "standalone",
  }).html;

const COLLAPSIBLE_CONTENT =
  '<div data-collapsible="slide" data-collapse-id="one"><div data-collapse-header><button data-collapse-toggle></button></div><div data-collapse-body><p>Body.</p></div></div>';

describe("bulk collapse controls", () => {
  it("should offer expand-all and collapse-all beside the contents label", () => {
    const html = shellFor(COLLAPSIBLE_CONTENT);
    expect(html).toMatch(
      /class="[^"]*\bflex\b[^"]*\bjustify-between\b[^"]*" data-toc-header>/,
    );
    expect(html).toContain("data-expand-all");
    expect(html).toContain("data-collapse-all");
    expect(html).toContain('aria-label="Expand all sections"');
    expect(html).toContain('aria-label="Collapse all sections"');
  });

  it("should draw both controls from the icon catalog rather than local paths", () => {
    const html = shellFor(COLLAPSIBLE_CONTENT);
    expect(html).toContain('data-lucide="chevrons-up-down"');
    expect(html).toContain('data-lucide="chevrons-down-up"');
  });

  it("should ship the controls hidden so a scripts-disabled document offers nothing it cannot honour", () => {
    const html = shellFor(COLLAPSIBLE_CONTENT);
    // The viewer script removes `hidden` and sets data-shown; until then the
    // zero-specificity [hidden] rule must win, so the markup carries no
    // competing display utility of its own.
    expect(html).toMatch(
      /<span class="[^"]*"\s+data-collapse-all-controls\s+hidden>/,
    );
    // A bare `inline-flex` here would beat [hidden] and leak the control into
    // a scripts-disabled document; only the data-shown variant may set display.
    expect(html).not.toMatch(
      /class="(?![^"]*data-\[shown\]:)[^"]*\binline-flex\b[^"]*"\s+data-collapse-all-controls/,
    );
  });
});

describe("approval brand slot", () => {
  it("should keep one hidden slot beside the wordmark on a plan document", () => {
    const html = shellFor("<p>Plan.</p>");
    expect(html).toMatch(
      /data-logo-dark[\s\S]*?<\/a>\s*<span data-review-approval-brand-slot hidden><\/span>/,
    );
    expect(html).not.toContain("data-review-approval-slot");
  });

  it("should omit the slot from standalone chrome", () => {
    const html = standaloneShellFor("<p>Welcome to Big Plan.</p>");
    expect(html).not.toContain("data-review-approval-brand-slot");
  });

  it("should start the contents list at the top of the sidebar", () => {
    const html = shellFor("<p>Plan.</p>");
    expect(html).toMatch(
      /aria-label="Contents">\s*<p class="[^"]*" data-toc-header>/,
    );
  });
});

describe("scripts-disabled notice", () => {
  it("should ship the readable-content notice in every rendered document", () => {
    const html = shellFor("<p>Readable plan content.</p>");
    expect(html).toContain("<noscript>");
    expect(html).toContain("data-noscript-notice");
    expect(html).toContain("The full plan content is readable");
    expect(html).toContain(
      "Interactive affordances such as sorting, collapse, maximize, and comments are unavailable; comment screenshots require the local <code>big-plan review</code> runtime.",
    );
  });

  it("should not describe a plan on a page that has none", () => {
    // Standalone chrome serves the service's own pages: no plan content, no
    // comments, and nothing sortable or collapsible to lose.
    const html = standaloneShellFor("<p>Welcome to Big Plan.</p>");
    expect(html).not.toContain("data-noscript-notice");
    expect(html).not.toContain("The full plan content is readable");
  });
});
