// Validate-health for the wireframe guidance's pattern section, which promises
// every snippet under it is paste-ready. That file is the authored input
// `scripts/gen-guidance.mjs` embeds into what `big-plan guidance` prints, so a
// snippet that fails compilation reaches an agent as an instruction to write a
// plan the compiler then refuses. Each snippet compiles through the real
// pipeline here, the same way every committed example does, rather than being
// read for shape.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compileMarkdown,
  MarkdownDiagnosticsError,
} from "./markdown/compile-markdown.js";

const GUIDANCE = readFileSync(
  new URL("../components/wireframe/wireframe.guidance.md", import.meta.url)
    .pathname,
  "utf8",
);

const PATTERNS_HEADING = "## Eight paste-ready patterns";

// One snippet per fenced mdx block after the pattern heading, labelled by the
// prose line that introduces it so a failure names the pattern that broke.
const pastReadyPatterns = (): ReadonlyArray<{
  readonly label: string;
  readonly source: string;
}> => {
  const section = GUIDANCE.slice(GUIDANCE.indexOf(PATTERNS_HEADING));
  const patterns: Array<{ label: string; source: string }> = [];
  let label = PATTERNS_HEADING;
  let open: { fence: string; lines: Array<string> } | undefined;
  for (const line of section.split("\n")) {
    const trimmed = line.trimEnd();
    // A snippet that itself contains a fenced block is written with a longer
    // fence, so the closing fence has to match the one that opened it.
    const opening = /^(`{3,})mdx$/u.exec(trimmed);
    if (open === undefined && opening !== null && opening[1] !== undefined) {
      open = { fence: opening[1], lines: [] };
      continue;
    }
    if (open === undefined) {
      if (trimmed.trim().endsWith(":")) {
        label = trimmed.trim();
      }
      continue;
    }
    if (trimmed === open.fence) {
      patterns.push({ label, source: open.lines.join("\n") });
      open = undefined;
      continue;
    }
    open.lines.push(line);
  }
  return patterns;
};

const PATTERNS = pastReadyPatterns();

// An agent pastes screens, so the harness supplies only the wireframe envelope
// around them - the same thing every example plan writes by hand.
const planFor = ({
  index,
  source,
}: {
  readonly index: number;
  readonly source: string;
}): string =>
  [
    "# Pattern",
    "",
    "One paste-ready pattern, compiled exactly as an agent would paste it.",
    "",
    `<Wireframe id="pattern-${index}">`,
    source,
    "</Wireframe>",
    "",
  ].join("\n");

describe("wireframe guidance patterns", () => {
  it("should find every pattern the section promises", () => {
    expect(PATTERNS.length).toBe(8);
  });

  it.each(PATTERNS.map((pattern, index) => ({ ...pattern, index })))(
    "should compile $label without diagnostics",
    ({ index, source }) => {
      const markdown = planFor({ index, source });
      let reported: ReadonlyArray<string> = [];
      try {
        compileMarkdown({ markdown });
      } catch (error) {
        if (!(error instanceof MarkdownDiagnosticsError)) {
          throw error;
        }
        reported = error.diagnostics.map((entry) => entry.message);
      }
      expect(reported).toEqual([]);
    },
  );
});
