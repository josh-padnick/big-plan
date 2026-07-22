// Tests DecisionSet's static HAST anatomy, state emphasis, native disclosure,
// and end-to-end rendering of the recursively scoped grammar.

import type { Element, ElementContent, Root } from "hast";
import { describe, expect, it } from "vitest";
import { compileMarkdown, serializeMarkdown } from "../../convert.js";
import type {
  ComponentAttributeValue,
  ScopedChild,
} from "../component-contract.js";
import { createDiagnosticCollector } from "../diagnostics.js";
import { renderDecisionSet } from "./decision-set.js";

const POSITION = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 30, column: 15, offset: 600 },
};

const positionAt = (line: number) => ({
  start: { line, column: 1, offset: line * 20 },
  end: { line: line + 1, column: 10, offset: line * 20 + 30 },
});

const paragraph = (value: string): Element => ({
  type: "element",
  tagName: "p",
  properties: {},
  children: [{ type: "text", value }],
});

const scoped = ({
  name,
  attributes = {},
  children = [],
  scopedChildren,
  line,
}: {
  readonly name: "Decision" | "Option" | "Pro" | "Con";
  readonly attributes?: Readonly<Record<string, ComponentAttributeValue>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
  readonly line: number;
}): ScopedChild => ({
  name,
  attributes,
  children,
  ...(scopedChildren === undefined ? {} : { scopedChildren }),
  position: positionAt(line),
});

const option = ({
  title,
  line,
  summary,
  recommended = false,
  chosen = false,
  detail = [],
  tradeoffs = [],
}: {
  readonly title: string;
  readonly line: number;
  readonly summary?: string;
  readonly recommended?: boolean;
  readonly chosen?: boolean;
  readonly detail?: ReadonlyArray<ElementContent>;
  readonly tradeoffs?: ReadonlyArray<ScopedChild>;
}): ScopedChild =>
  scoped({
    name: "Option",
    attributes: {
      title,
      ...(summary === undefined ? {} : { summary }),
      ...(recommended ? { recommended: true } : {}),
      ...(chosen ? { chosen: true } : {}),
    },
    children: detail,
    scopedChildren: tradeoffs,
    line,
  });

const decision = ({
  question,
  line,
  status,
  options,
  context = [],
}: {
  readonly question: string;
  readonly line: number;
  readonly status?: "open" | "decided" | "deferred";
  readonly options: ReadonlyArray<ScopedChild>;
  readonly context?: ReadonlyArray<ElementContent>;
}): ScopedChild =>
  scoped({
    name: "Decision",
    attributes: {
      question,
      ...(status === undefined ? {} : { status }),
    },
    children: context,
    scopedChildren: options,
    line,
  });

const render = ({
  attributes = {},
  children = [],
  decisions,
}: {
  readonly attributes?: Readonly<Record<string, ComponentAttributeValue>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly decisions: ReadonlyArray<ScopedChild>;
}) => {
  const diagnostics = createDiagnosticCollector();
  const element = renderDecisionSet({
    attributes,
    children,
    scopedChildren: decisions,
    position: POSITION,
    diagnostics,
  });
  const root: Root = { type: "root", children: [element] };
  return {
    element,
    html: serializeMarkdown({ root }),
    diagnostics: diagnostics.diagnostics,
  };
};

describe("renderDecisionSet anatomy", () => {
  it("should render the complete static review surface when all layers are authored", () => {
    const { element, html, diagnostics } = render({
      attributes: { title: "Persistence decisions" },
      children: [paragraph("Intro prose.")],
      decisions: [
        decision({
          question: "Which store?",
          line: 3,
          context: [paragraph("Context prose.")],
          options: [
            option({
              title: "PostgreSQL",
              summary: "Operated relational store.",
              recommended: true,
              line: 7,
              detail: [paragraph("Long detail.")],
              tradeoffs: [
                scoped({
                  name: "Pro",
                  children: [paragraph("Mature tooling.")],
                  line: 9,
                }),
                scoped({
                  name: "Con",
                  children: [paragraph("Needs a server.")],
                  line: 11,
                }),
              ],
            }),
            option({ title: "SQLite", line: 14 }),
          ],
        }),
        decision({
          question: "Where should output live?",
          status: "decided",
          line: 18,
          options: [
            option({ title: "Alongside source", chosen: true, line: 20 }),
            option({ title: "Cache", line: 22 }),
          ],
        }),
        decision({
          question: "When should migration happen?",
          status: "deferred",
          line: 25,
          options: [
            option({ title: "Now", line: 27 }),
            option({ title: "Later", line: 29 }),
          ],
        }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("figure");
    expect(element.properties["data-decision-set"]).toBe("");
    expect(html).toContain("Persistence decisions");
    expect(html).toContain("3 decisions · 1 open");
    expect(html).toContain("Intro prose.");
    expect(html).toContain('id="decision-which-store"');
    expect(html).toContain('data-decision-status="open"');
    expect(html).toContain('data-decision-status="decided"');
    expect(html).toContain('data-decision-status="deferred"');
    expect(html).toContain("Context prose.");
    expect(html).toContain('id="option-postgresql"');
    expect(html).toContain("data-option-recommended");
    expect(html).toContain("Recommended");
    expect(html).toContain('data-decision-tradeoff="pro"');
    expect(html).toContain('data-lucide="check"');
    expect(html).toContain('data-decision-tradeoff="con"');
    expect(html).toContain('data-lucide="minus"');
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Details");
    expect(html).toContain("Long detail.");
  });

  it("should lead a decided decision with its outcome and mute only losing options", () => {
    const { html, diagnostics } = render({
      decisions: [
        decision({
          question: "Which store?",
          status: "decided",
          line: 3,
          options: [
            option({ title: "PostgreSQL", chosen: true, line: 6 }),
            option({ title: "SQLite", line: 10 }),
          ],
        }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(html).toContain("data-decision-outcome");
    expect(html).toContain("Chosen: PostgreSQL");
    expect(html.indexOf("Chosen: PostgreSQL")).toBeLessThan(
      html.indexOf("data-decision-options"),
    );
    expect(html).toContain("decision-set-option-chosen");
    expect(html).toContain("decision-set-option-muted");
    expect(html.match(/decision-set-option-muted/gu)).toHaveLength(1);
    expect(html).toContain("SQLite");
  });

  it("should omit the open clause when every decision is closed", () => {
    const { html, diagnostics } = render({
      decisions: [
        decision({
          question: "Resolved?",
          status: "decided",
          line: 3,
          options: [
            option({ title: "Yes", chosen: true, line: 5 }),
            option({ title: "No", line: 7 }),
          ],
        }),
        decision({
          question: "Deferred?",
          status: "deferred",
          line: 10,
          options: [
            option({ title: "Soon", line: 12 }),
            option({ title: "Later", line: 14 }),
          ],
        }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(html).toContain("2 decisions");
    expect(html).not.toContain("0 open");
  });

  it("should omit a summary line when an option has no summary", () => {
    const { html, diagnostics } = render({
      decisions: [
        decision({
          question: "Choose?",
          line: 3,
          options: [
            option({ title: "No summary", line: 5 }),
            option({ title: "With summary", summary: "One line.", line: 7 }),
          ],
        }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(html).toContain("No summary");
    expect(html.match(/One line\./gu)).toHaveLength(1);
    expect(html).not.toContain("undefined");
  });

  it("should omit Details when an option contains tradeoffs only", () => {
    const { html, diagnostics } = render({
      decisions: [
        decision({
          question: "Choose?",
          line: 3,
          options: [
            option({
              title: "Tradeoffs only",
              line: 5,
              tradeoffs: [
                scoped({
                  name: "Pro",
                  children: [paragraph("Simple.")],
                  line: 6,
                }),
              ],
            }),
            option({ title: "Other", line: 9 }),
          ],
        }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(html).toContain("Simple.");
    expect(html).not.toContain("<details");
  });
});

describe("DecisionSet end-to-end rendering", () => {
  it("should preserve inline Markdown through every recursively scoped level", () => {
    const markdown = `<DecisionSet title="Storage">\n\nIntro with **importance**.\n\n<Decision question="Which store?">\n\nContext with a [link](https://example.com).\n\n<Option title="PostgreSQL" recommended summary="Managed store.">\n\n<Pro>\nMature **tooling**.\n</Pro>\n<Con>\nNeeds a server.\n</Con>\n\nLong detail with \`code\`.\n\n</Option>\n\n<Option title="SQLite" />\n\n</Decision>\n\n</DecisionSet>\n`;
    const { root } = compileMarkdown({ markdown });
    const html = serializeMarkdown({ root });

    expect(html).toContain('<figure class="decision-set');
    expect(html).toContain("Intro with <strong>importance</strong>.");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain("Mature <strong>tooling</strong>.");
    expect(html).toContain("Long detail with <code>code</code>.");
    expect(html).toContain("data-option-recommended");
  });
});
