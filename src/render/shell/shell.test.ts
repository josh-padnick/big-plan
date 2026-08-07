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

describe("scripts-disabled notice", () => {
  it("should ship the readable-content notice in every rendered shell", () => {
    const html = shellFor("<p>Readable plan content.</p>");
    expect(html).toContain("<noscript>");
    expect(html).toContain("data-noscript-notice");
    expect(html).toContain("The full plan content is readable");
    expect(html).toContain(
      "Interactive affordances such as sorting, collapse, maximize, and comments are unavailable.",
    );
  });
});
