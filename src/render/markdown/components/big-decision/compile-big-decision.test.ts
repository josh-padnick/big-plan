// Tests BigDecision's pure criteria-matrix compiler and end-to-end positional
// diagnostics across the complete authoring-validation matrix.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { compileMarkdown, MarkdownDiagnosticsError } from "../../convert.js";
import type {
  ComponentAttributeValue,
  ScopedChild,
} from "../component-contract.js";
import { createDiagnosticCollector } from "../diagnostics.js";
import { compileBigDecisionComponent } from "./compile-big-decision.js";

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
  readonly name: "Criterion" | "Details" | "Option" | "Reversibility" | "Score";
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

const criterion = ({
  title,
  line,
  detail = [],
}: {
  readonly title: string;
  readonly line: number;
  readonly detail?: ReadonlyArray<ElementContent>;
}): ScopedChild =>
  scoped({ name: "Criterion", attributes: { title }, children: detail, line });

const score = ({
  criterion: criterionTitle,
  verdict,
  tone,
  line,
  detail = [],
}: {
  readonly criterion: string;
  readonly verdict: string;
  readonly tone?: string;
  readonly line: number;
  readonly detail?: ReadonlyArray<ElementContent>;
}): ScopedChild =>
  scoped({
    name: "Score",
    attributes: {
      criterion: criterionTitle,
      verdict,
      ...(tone === undefined ? {} : { tone }),
    },
    children: detail,
    line,
  });

const option = ({
  title,
  line,
  recommended = false,
  chosen = false,
  summary,
  detail = [],
  scores = [],
}: {
  readonly title: string;
  readonly line: number;
  readonly recommended?: boolean;
  readonly chosen?: boolean;
  readonly summary?: string;
  readonly detail?: ReadonlyArray<ElementContent>;
  readonly scores?: ReadonlyArray<ScopedChild>;
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
    scopedChildren: scores,
    line,
  });

const compile = ({
  attributes = { question: "Which store?" },
  children = [],
  scopedChildren = [
    option({ title: "PostgreSQL", line: 3 }),
    option({ title: "SQLite", line: 7 }),
  ],
}: {
  readonly attributes?: Readonly<Record<string, ComponentAttributeValue>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const model = compileBigDecisionComponent({
    attributes,
    children,
    scopedChildren,
    position: POSITION,
    diagnostics,
  });
  return { model, diagnostics: diagnostics.diagnostics };
};

// Extracts typed author diagnostics while preserving renderer defects.
const diagnosticsFor = (markdown: string) => {
  try {
    compileMarkdown({ markdown });
  } catch (error) {
    if (error instanceof MarkdownDiagnosticsError) {
      return error.diagnostics;
    }
    throw error;
  }
  return [];
};

describe("compileBigDecisionComponent", () => {
  it("should compile the complete matrix model when every layer is authored", () => {
    const { model, diagnostics } = compile({
      attributes: { question: "Which store?", status: "open" },
      children: [paragraph("Context.")],
      scopedChildren: [
        criterion({
          title: "Setup",
          line: 2,
          detail: [paragraph("Why setup matters.")],
        }),
        criterion({ title: "Scale", line: 3 }),
        option({
          title: "PostgreSQL",
          line: 4,
          recommended: true,
          summary: "The team already runs it.",
          detail: [paragraph("Longer detail.")],
          scores: [
            score({
              criterion: "Setup",
              verdict: "Needs a server",
              tone: "bad",
              line: 5,
            }),
            score({
              criterion: "Scale",
              verdict: "Ready",
              tone: "good",
              line: 6,
              detail: [paragraph("Concurrent writers work today.")],
            }),
          ],
        }),
        option({
          title: "SQLite",
          line: 8,
          scores: [
            score({
              criterion: "Setup",
              verdict: "Zero setup",
              tone: "good",
              line: 9,
            }),
            score({ criterion: "Scale", verdict: "Single writer", line: 10 }),
          ],
        }),
        scoped({
          name: "Reversibility",
          attributes: { rating: "somewhat-hard" },
          children: [paragraph("A migration, not a rewrite.")],
          line: 11,
        }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model).toMatchObject({
      id: "decision-which-store",
      question: "Which store?",
      status: "open",
      reversibility: { rating: "somewhat-hard" },
      criteria: [
        { id: "decision-which-store-criterion-setup", title: "Setup" },
        { id: "decision-which-store-criterion-scale", title: "Scale" },
      ],
      options: [
        {
          id: "decision-which-store-option-postgresql",
          title: "PostgreSQL",
          recommended: true,
          scores: [
            { verdict: "Needs a server", tone: "bad" },
            { verdict: "Ready", tone: "good" },
          ],
        },
        {
          id: "decision-which-store-option-sqlite",
          title: "SQLite",
          scores: [
            { verdict: "Zero setup", tone: "good" },
            { verdict: "Single writer", tone: "neutral" },
          ],
        },
      ],
    });
    expect(model.criteria[0]?.detail).toHaveLength(1);
    expect(model.reversibility?.detail).toHaveLength(1);
    expect(model.options[0]?.scores[1]?.detail).toHaveLength(1);
    expect(model.chosenOption).toBeUndefined();
  });

  it("should default the status to open when none is authored", () => {
    const { model, diagnostics } = compile();
    expect(diagnostics).toEqual([]);
    expect(model.status).toBe("open");
    expect(model.criteria).toEqual([]);
  });

  it("should expose the chosen option when the decision is decided", () => {
    const { model, diagnostics } = compile({
      attributes: { question: "Which store?", status: "decided" },
      scopedChildren: [
        option({ title: "PostgreSQL", line: 3, chosen: true }),
        option({ title: "SQLite", line: 7 }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(model.chosenOption?.title).toBe("PostgreSQL");
  });

  it("should reject more than one Details", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        option({ title: "A", line: 3 }),
        option({ title: "B", line: 5 }),
        scoped({ name: "Details", line: 7 }),
        scoped({ name: "Details", line: 9 }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 9,
        column: 1,
        message: "BigDecision cannot contain more than one Details",
      },
    ]);
  });

  it("should reject more than one Reversibility", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        option({ title: "A", line: 3 }),
        option({ title: "B", line: 5 }),
        scoped({
          name: "Reversibility",
          attributes: { rating: "easy" },
          line: 7,
        }),
        scoped({
          name: "Reversibility",
          attributes: { rating: "hard" },
          line: 9,
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 9,
        column: 1,
        message: "BigDecision cannot contain more than one Reversibility",
      },
    ]);
  });

  it("should reject a verdict that exceeds the terseness cap", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        criterion({ title: "Setup", line: 2 }),
        option({
          title: "A",
          line: 3,
          scores: [
            score({
              criterion: "Setup",
              verdict: "This verdict is a full sentence that defeats scanning",
              line: 4,
            }),
          ],
        }),
        option({
          title: "B",
          line: 6,
          scores: [score({ criterion: "Setup", verdict: "Fine", line: 7 })],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 4,
        column: 1,
        message:
          "Score verdict must stay within 32 characters; move longer reasoning into the Score body",
      },
    ]);
  });

  it("should reject a score for an unknown criterion", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        criterion({ title: "Setup", line: 2 }),
        option({
          title: "A",
          line: 3,
          scores: [
            score({ criterion: "Setup", verdict: "Fine", line: 4 }),
            score({ criterion: "Speed", verdict: "Fast", line: 5 }),
          ],
        }),
        option({
          title: "B",
          line: 7,
          scores: [score({ criterion: "Setup", verdict: "Fine", line: 8 })],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message: 'Score references unknown criterion "Speed"',
      },
    ]);
  });

  it("should reject a duplicate score and report the missing one once", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        criterion({ title: "Setup", line: 2 }),
        option({
          title: "A",
          line: 3,
          scores: [
            score({ criterion: "Setup", verdict: "Fine", line: 4 }),
            score({ criterion: "Setup", verdict: "Again", line: 5 }),
          ],
        }),
        option({ title: "B", line: 7 }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message: 'Duplicate Score for criterion "Setup" in Option "A"',
      },
      {
        line: 7,
        column: 1,
        message: 'Option "B" is missing a Score for criterion "Setup"',
      },
    ]);
  });

  it("should reject duplicate criterion titles", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        criterion({ title: "Setup", line: 2 }),
        criterion({ title: "Setup", line: 3 }),
        option({
          title: "A",
          line: 4,
          scores: [score({ criterion: "Setup", verdict: "Fine", line: 5 })],
        }),
        option({
          title: "B",
          line: 7,
          scores: [score({ criterion: "Setup", verdict: "Fine", line: 8 })],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Duplicate Criterion title "Setup" in BigDecision',
      },
    ]);
  });

  it("should reject option and criterion titles duplicated by whitespace", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        criterion({ title: "Setup", line: 2 }),
        criterion({ title: " Setup ", line: 3 }),
        option({
          title: "A",
          line: 4,
          scores: [
            score({ criterion: "Setup", verdict: "Fine", line: 5 }),
            score({ criterion: " Setup ", verdict: "Fine", line: 6 }),
          ],
        }),
        option({
          title: " A ",
          line: 8,
          scores: [
            score({ criterion: "Setup", verdict: "Fine", line: 9 }),
            score({ criterion: " Setup ", verdict: "Fine", line: 10 }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Duplicate Criterion title "Setup" in BigDecision',
      },
      {
        line: 8,
        column: 1,
        message: 'Duplicate Option title "A" in BigDecision',
      },
    ]);
  });

  it("should reject a decision with fewer than two options", () => {
    const { diagnostics } = compile({
      scopedChildren: [option({ title: "Only", line: 3 })],
    });
    expect(diagnostics).toEqual([
      {
        line: 1,
        column: 1,
        message: "BigDecision must contain at least two Options",
      },
    ]);
  });

  it("should reject more than one recommended option", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        option({ title: "A", line: 3, recommended: true }),
        option({ title: "B", line: 7, recommended: true }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 7,
        column: 1,
        message: "BigDecision cannot contain more than one recommended Option",
      },
    ]);
  });

  it("should reject a chosen option when the decision is not decided", () => {
    const { diagnostics } = compile({
      scopedChildren: [
        option({ title: "A", line: 3, chosen: true }),
        option({ title: "B", line: 7 }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          'A chosen Option requires its BigDecision to have status "decided"',
      },
    ]);
  });

  it("should reject a decided decision without a chosen option", () => {
    const { diagnostics } = compile({
      attributes: { question: "Which store?", status: "decided" },
    });
    expect(diagnostics).toEqual([
      {
        line: 1,
        column: 1,
        message:
          'A BigDecision with status "decided" must contain exactly one chosen Option',
      },
    ]);
  });
});

describe("BigDecision end-to-end diagnostics", () => {
  it("should reject a missing question with the shared schema voice", () => {
    expect(
      diagnosticsFor(
        '<BigDecision>\n\n<Option title="A" />\n\n<Option title="B" />\n\n</BigDecision>\n',
      ),
    ).toEqual([
      {
        line: 1,
        column: 1,
        message: 'Missing required attribute "question"; expected a string',
      },
    ]);
  });

  it("should reject an unknown reversibility rating with the enum voice", () => {
    expect(
      diagnosticsFor(
        '<BigDecision question="Q?">\n\n<Option title="A" />\n\n<Option title="B" />\n\n<Reversibility rating="moderate" />\n\n</BigDecision>\n',
      ),
    ).toEqual([
      {
        line: 7,
        column: 1,
        message:
          'Invalid value for attribute "rating"; expected one of: easy, somewhat-hard, hard',
      },
    ]);
  });

  it("should reject an unknown tone with the enum voice", () => {
    expect(
      diagnosticsFor(
        '<BigDecision question="Q?">\n\n<Criterion title="Setup" />\n\n<Option title="A">\n\n<Score criterion="Setup" verdict="Fine" tone="great" />\n\n</Option>\n\n<Option title="B">\n\n<Score criterion="Setup" verdict="Fine" />\n\n</Option>\n\n</BigDecision>\n',
      ),
    ).toEqual([
      {
        line: 7,
        column: 1,
        message:
          'Invalid value for attribute "tone"; expected one of: good, bad, mixed, neutral',
      },
    ]);
  });

  it("should leave Score unknown when it skips its Option parent", () => {
    expect(
      diagnosticsFor(
        '<BigDecision question="Q?">\n\n<Score criterion="Setup" verdict="Fine" />\n\n<Option title="A" />\n\n<Option title="B" />\n\n</BigDecision>\n',
      ),
    ).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Unknown component "Score"',
      },
    ]);
  });

  it("should enforce the Score body policy against headings", () => {
    expect(
      diagnosticsFor(
        '<BigDecision question="Q?">\n\n<Criterion title="Setup" />\n\n<Option title="A">\n\n<Score criterion="Setup" verdict="Fine">\n\n# Heading\n\n</Score>\n\n</Option>\n\n<Option title="B">\n\n<Score criterion="Setup" verdict="Fine" />\n\n</Option>\n\n</BigDecision>\n',
      ),
    ).toEqual([
      {
        line: 9,
        column: 1,
        message: "Score bodies cannot contain headings",
      },
    ]);
  });
});
