// Tests DecisionSet's pure nested compiler and end-to-end positional
// diagnostics across the complete authoring-validation matrix.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { compileMarkdown, MarkdownDiagnosticsError } from "../../convert.js";
import type {
  ComponentAttributeValue,
  ScopedChild,
} from "../component-contract.js";
import { createDiagnosticCollector } from "../diagnostics.js";
import { compileDecisionSetComponent } from "./compile-decision-set.js";

const POSITION = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 20, column: 15, offset: 400 },
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
  recommended = false,
  chosen = false,
  summary,
  detail = [],
  tradeoffs = [],
}: {
  readonly title: string;
  readonly line: number;
  readonly recommended?: boolean;
  readonly chosen?: boolean;
  readonly summary?: string;
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
  question = "Which store?",
  status,
  line = 3,
  options,
  context = [],
}: {
  readonly question?: string;
  readonly status?: string;
  readonly line?: number;
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

const compile = ({
  attributes = {},
  children = [],
  decisions = [],
}: {
  readonly attributes?: Readonly<Record<string, ComponentAttributeValue>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly decisions?: ReadonlyArray<ScopedChild>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const model = compileDecisionSetComponent({
    attributes,
    children,
    scopedChildren: decisions,
    position: POSITION,
    diagnostics,
  });
  return { model, diagnostics: diagnostics.diagnostics };
};

// Extracts author diagnostics while preserving unexpected renderer failures.
const diagnosticsFor = (markdown: string) => {
  try {
    compileMarkdown({ markdown });
  } catch (error: unknown) {
    if (error instanceof MarkdownDiagnosticsError) {
      return error.diagnostics;
    }
    throw error;
  }
  throw new Error("Expected markdown compilation to fail");
};

describe("compileDecisionSetComponent model", () => {
  it("should compile every prose layer and nested tradeoff when the contract is valid", () => {
    const first = option({
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
    });
    const { model, diagnostics } = compile({
      attributes: { title: "Persistence decisions" },
      children: [paragraph("Set intro.")],
      decisions: [
        decision({
          context: [paragraph("Decision context.")],
          options: [first, option({ title: "SQLite", line: 14 })],
        }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model).toMatchObject({
      title: "Persistence decisions",
      openCount: 1,
      intro: [paragraph("Set intro.")],
      decisions: [
        {
          id: "decision-which-store",
          question: "Which store?",
          status: "open",
          context: [paragraph("Decision context.")],
          options: [
            {
              id: "option-postgresql",
              title: "PostgreSQL",
              summary: "Operated relational store.",
              recommended: true,
              chosen: false,
              detail: [paragraph("Long detail.")],
              tradeoffs: [
                { kind: "pro", children: [paragraph("Mature tooling.")] },
                { kind: "con", children: [paragraph("Needs a server.")] },
              ],
            },
            { id: "option-sqlite", title: "SQLite" },
          ],
        },
      ],
    });
  });

  it("should default status to open and accept the minimum two options", () => {
    const { model, diagnostics } = compile({
      decisions: [
        decision({
          options: [
            option({ title: "A", line: 5 }),
            option({ title: "B", line: 7 }),
          ],
        }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model.decisions[0]?.status).toBe("open");
    expect(model.decisions[0]?.options).toHaveLength(2);
  });

  it("should deduplicate stable decision and option ids within the set", () => {
    const { model } = compile({
      decisions: [
        decision({
          question: "Store?",
          line: 3,
          options: [
            option({ title: "A", line: 5 }),
            option({ title: "B", line: 7 }),
          ],
        }),
        decision({
          question: "Store?",
          line: 10,
          options: [
            option({ title: "A", line: 12 }),
            option({ title: "C", line: 14 }),
          ],
        }),
      ],
    });

    expect(model.decisions.map(({ id }) => id)).toEqual([
      "decision-store",
      "decision-store-2",
    ]);
    expect(
      model.decisions.flatMap(({ options }) => options.map(({ id }) => id)),
    ).toEqual(["option-a", "option-b", "option-a-2", "option-c"]);
  });
});

describe("compileDecisionSetComponent validation", () => {
  it("should use shared schema diagnostics for every grammar level", () => {
    const invalidOption = scoped({
      name: "Option",
      attributes: {
        title: true,
        summary: true,
        recommended: "yes",
        extra: true,
      },
      scopedChildren: [
        scoped({ name: "Pro", attributes: { extra: true }, line: 9 }),
      ],
      line: 7,
    });
    const { diagnostics } = compile({
      attributes: { title: true, extra: true },
      decisions: [
        scoped({
          name: "Decision",
          attributes: { status: "pending", extra: true },
          scopedChildren: [invalidOption],
          line: 3,
        }),
      ],
    });

    expect(diagnostics).toEqual([
      { line: 1, column: 1, message: 'Attribute "title" must be a string' },
      {
        line: 1,
        column: 1,
        message: 'Unknown attribute "extra" on DecisionSet',
      },
      {
        line: 3,
        column: 1,
        message: 'Missing required attribute "question"; expected a string',
      },
      {
        line: 3,
        column: 1,
        message:
          'Invalid value for attribute "status"; expected one of: open, decided, deferred',
      },
      { line: 3, column: 1, message: 'Unknown attribute "extra" on Decision' },
      { line: 7, column: 1, message: 'Attribute "title" must be a string' },
      { line: 7, column: 1, message: 'Attribute "summary" must be a string' },
      {
        line: 7,
        column: 1,
        message:
          'Attribute "recommended" is a shorthand boolean; use the bare form',
      },
      { line: 7, column: 1, message: 'Unknown attribute "extra" on Option' },
      { line: 9, column: 1, message: 'Unknown attribute "extra" on Pro' },
      {
        line: 3,
        column: 1,
        message: "Decision must contain at least two Options",
      },
    ]);
  });

  it("should report missing and empty required labels at their owning nodes", () => {
    const { diagnostics } = compile({
      decisions: [
        scoped({
          name: "Decision",
          attributes: { question: "  " },
          scopedChildren: [
            scoped({ name: "Option", line: 7 }),
            scoped({
              name: "Option",
              attributes: { title: " " },
              line: 11,
            }),
          ],
          line: 3,
        }),
      ],
    });

    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Attribute "question" must be a non-empty string',
      },
      {
        line: 7,
        column: 1,
        message: 'Missing required attribute "title"; expected a string',
      },
      {
        line: 11,
        column: 1,
        message: 'Attribute "title" must be a non-empty string',
      },
    ]);
  });

  it("should reject an empty set at the set position", () => {
    expect(compile().diagnostics).toEqual([
      {
        line: 1,
        column: 1,
        message: "DecisionSet must contain at least one Decision",
      },
    ]);
  });

  it("should reject a decision with fewer than two options", () => {
    expect(
      compile({
        decisions: [
          decision({ options: [option({ title: "Only", line: 6 })] }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message: "Decision must contain at least two Options",
      },
    ]);
  });

  it("should reject a duplicate title at the repeated option", () => {
    expect(
      compile({
        decisions: [
          decision({
            options: [
              option({ title: "SQLite", line: 6 }),
              option({ title: "SQLite", line: 10 }),
            ],
          }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 10,
        column: 1,
        message: 'Duplicate Option title "SQLite" in Decision',
      },
    ]);
  });

  it("should reject every recommendation after the first", () => {
    expect(
      compile({
        decisions: [
          decision({
            options: [
              option({ title: "A", recommended: true, line: 6 }),
              option({ title: "B", recommended: true, line: 10 }),
            ],
          }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 10,
        column: 1,
        message: "Decision cannot contain more than one recommended Option",
      },
    ]);
  });

  it.each(["open", "deferred"])(
    "should reject a chosen option when status is %s",
    (status) => {
      expect(
        compile({
          decisions: [
            decision({
              status,
              options: [
                option({ title: "A", chosen: true, line: 6 }),
                option({ title: "B", line: 10 }),
              ],
            }),
          ],
        }).diagnostics,
      ).toEqual([
        {
          line: 6,
          column: 1,
          message:
            'A chosen Option requires its Decision to have status "decided"',
        },
      ]);
    },
  );

  it("should reject a decided decision without a chosen option", () => {
    expect(
      compile({
        decisions: [
          decision({
            status: "decided",
            options: [
              option({ title: "A", line: 6 }),
              option({ title: "B", line: 10 }),
            ],
          }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message:
          'A Decision with status "decided" must contain exactly one chosen Option',
      },
    ]);
  });

  it("should reject every chosen option after the first on a decided decision", () => {
    expect(
      compile({
        decisions: [
          decision({
            status: "decided",
            options: [
              option({ title: "A", chosen: true, line: 6 }),
              option({ title: "B", chosen: true, line: 10 }),
            ],
          }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 10,
        column: 1,
        message: "Decision cannot contain more than one chosen Option",
      },
    ]);
  });
});

describe("DecisionSet end-to-end diagnostics", () => {
  it("should report an unknown set attribute at its exact position", () => {
    const markdown = `<DecisionSet compact>\n<Decision question="Choose?">\n<Option title="A" />\n<Option title="B" />\n</Decision>\n</DecisionSet>\n`;
    expect(diagnosticsFor(markdown)).toEqual([
      {
        line: 1,
        column: 1,
        message: 'Unknown attribute "compact" on DecisionSet',
      },
    ]);
  });

  it("should leave Pro unknown when it appears outside Option", () => {
    const markdown = `<DecisionSet>\n<Decision question="Choose?">\n<Pro>\nWrong level.\n</Pro>\n<Option title="A" />\n<Option title="B" />\n</Decision>\n</DecisionSet>\n`;
    expect(diagnosticsFor(markdown)).toEqual([
      { line: 3, column: 1, message: 'Unknown component "Pro"' },
    ]);
  });

  it("should prohibit a heading inside a Pro body at exact nested positions", () => {
    const markdown = `<DecisionSet>\n<Decision question="Choose?">\n<Option title="A">\n<Pro>\n### Heading\n</Pro>\n</Option>\n<Option title="B" />\n</Decision>\n</DecisionSet>\n`;
    expect(diagnosticsFor(markdown)).toEqual([
      {
        line: 5,
        column: 1,
        message: "Decision bodies cannot contain headings",
      },
      {
        line: 5,
        column: 1,
        message: "Option bodies cannot contain headings",
      },
      {
        line: 5,
        column: 1,
        message: "Pro bodies cannot contain headings",
      },
    ]);
  });

  it("should prohibit footnotes and typed components inside an Option body", () => {
    const markdown = `<DecisionSet>\n<Decision question="Choose?">\n<Option title="A">\nSee the note.[^note]\n\n<Callout type="note">\n\nNo nesting.\n\n</Callout>\n\n[^note]: Scoped note.\n</Option>\n<Option title="B" />\n</Decision>\n</DecisionSet>\n`;
    const diagnostics = diagnosticsFor(markdown);

    expect(diagnostics).toContainEqual({
      line: 4,
      column: 14,
      message: "Decision bodies cannot contain footnote references",
    });
    expect(diagnostics).toContainEqual({
      line: 6,
      column: 1,
      message: "Decision bodies cannot contain typed components",
    });
    expect(diagnostics).toContainEqual({
      line: 12,
      column: 1,
      message: "Decision bodies cannot contain footnote definitions",
    });
    expect(diagnostics).toContainEqual({
      line: 4,
      column: 14,
      message: "Option bodies cannot contain footnote references",
    });
    expect(diagnostics).toContainEqual({
      line: 6,
      column: 1,
      message: "Option bodies cannot contain typed components",
    });
    expect(diagnostics).toContainEqual({
      line: 12,
      column: 1,
      message: "Option bodies cannot contain footnote definitions",
    });
  });
});
