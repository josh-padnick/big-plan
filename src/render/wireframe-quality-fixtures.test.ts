// Diagnostic-health for every committed wireframe quality fixture: each
// deliberately-bad document must fail compilation with the exact blocking
// diagnostic it exists to prove, so the quality-bar gates cannot silently
// drift away from their negative proof.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MarkdownDiagnosticsError, renderDocument } from "./render-document.js";

const FIXTURES_DIR = new URL(
  "../../test/wireframe-quality-fixtures",
  import.meta.url,
).pathname;

const EXPECTED_DIAGNOSTICS: Readonly<Record<string, string>> = {
  "ambiguous-progress.mdx":
    'Screen "check" Stepper needs exactly one current Step; found 2',
  "equal-thirds.mdx":
    'Desktop Screen "ticket" draws 3 flexible panes in one Row; keep the primary surface dominant and wrap secondary content in Rail',
  "manual-primary-width.mdx": 'Unknown attribute "span" on Panel',
  "tablet-browser-shell.mdx":
    'Attribute "url" is unavailable on device="tablet"; browser chrome belongs only to device="desktop"',
  "tablet-choice-workspace.mdx":
    'Tablet Screen "choose" puts a ChoiceGroup beside a competing region; the decision must dominate one centered column, never a miniature list-and-inspector workspace',
  "tablet-false-choice-outcome.mdx":
    'ChoiceCard "Ask about my loan" on Screen "choose" navigates to "purchase-selected" without selecting that same title and consequence; every option needs its own truthful visible outcome',
  "tablet-premature-choice-continuation.mdx":
    'Screen "choose" shows a primary continuation before any ChoiceCard is selected; hide it until a deliberate tap reveals the selected state',
  "tablet-preselected-choice.mdx":
    'Initial Screen "choose" preselects a consequential ChoiceCard; start unselected and reveal the selected state only after a deliberate tap',
  "two-jobs.mdx":
    'Screen "handoff" draws 2 PageHeaders; keep one page-level job and move the other task into another Screen',
  "vertical-ipad-phone.mdx":
    'Phone Screen "phone" cannot contain AppShell or Sidebar; use TopBar, one content column, and BottomBar',
};

const diagnosticsOf = (markdown: string): ReadonlyArray<string> => {
  try {
    renderDocument({ markdown, fallbackTitle: "fixture" });
  } catch (error) {
    if (error instanceof MarkdownDiagnosticsError) {
      return error.diagnostics.map((diagnostic) => diagnostic.message);
    }
    throw error;
  }
  return [];
};

describe("wireframe quality fixtures", () => {
  it("should pair every fixture file with an expected diagnostic", () => {
    const files = readdirSync(FIXTURES_DIR)
      .filter((name) => name.endsWith(".mdx"))
      .sort();
    expect(files).toEqual(Object.keys(EXPECTED_DIAGNOSTICS).sort());
  });

  it.each(Object.entries(EXPECTED_DIAGNOSTICS))(
    "should reject %s with its blocking diagnostic",
    (name, message) => {
      const markdown = readFileSync(join(FIXTURES_DIR, name), "utf8");
      expect(diagnosticsOf(markdown)).toContain(message);
    },
  );
});
