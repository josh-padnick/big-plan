// Tests BigDecision's pure nested compiler and end-to-end positional
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
  readonly name: "Option" | "Pro" | "Con";
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

const compile = ({
  attributes = { question: "Which store?" },
  children = [],
  options = [
    option({ title: "PostgreSQL", line: 3 }),
    option({ title: "SQLite", line: 7 }),
  ],
}: {
  readonly attributes?: Readonly<Record<string, ComponentAttributeValue>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly options?: ReadonlyArray<ScopedChild>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const model = compileBigDecisionComponent({
    attributes,
    children,
    scopedChildren: options,
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
  it("should compile the complete nested model when every layer is authored", () => {
    const { model, diagnostics } = compile({
      attributes: { question: "Which store?", status: "open" },
      children: [paragraph("Context.")],
      options: [
        option({
          title: "PostgreSQL",
          line: 3,
          recommended: true,
          summary: "Managed store.",
          detail: [paragraph("Longer detail.")],
          tradeoffs: [
            scoped({
              name: "Pro",
              children: [paragraph("Mature tooling.")],
              line: 4,
            }),
            scoped({
              name: "Con",
              children: [paragraph("Needs a server.")],
              line: 5,
            }),
          ],
        }),
        option({ title: "SQLite", line: 8 }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model).toMatchObject({
      id: "decision-which-store",
      question: "Which store?",
      status: "open",
      options: [
        {
          id: "option-postgresql",
          title: "PostgreSQL",
          summary: "Managed store.",
          recommended: true,
          chosen: false,
          tradeoffs: [{ kind: "pro" }, { kind: "con" }],
        },
        { id: "option-sqlite", title: "SQLite", recommended: false },
      ],
    });
    expect(model.context).toHaveLength(1);
    expect(model.chosenOption).toBeUndefined();
  });

  it("should default the status to open when none is authored", () => {
    const { model, diagnostics } = compile();
    expect(diagnostics).toEqual([]);
    expect(model.status).toBe("open");
  });

  it("should expose the chosen option when the decision is decided", () => {
    const { model, diagnostics } = compile({
      attributes: { question: "Which store?", status: "decided" },
      options: [
        option({ title: "PostgreSQL", line: 3, chosen: true }),
        option({ title: "SQLite", line: 7 }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(model.chosenOption?.title).toBe("PostgreSQL");
  });

  it("should deduplicate option ids when titles repeat while diagnosing", () => {
    const { model } = compile({
      options: [
        option({ title: "Same", line: 3 }),
        option({ title: "Same", line: 7 }),
      ],
    });
    expect(model.options.map(({ id }) => id)).toEqual([
      "option-same",
      "option-same-2",
    ]);
  });

  it("should reject a decision with fewer than two options", () => {
    const { diagnostics } = compile({
      options: [option({ title: "Only", line: 3 })],
    });
    expect(diagnostics).toEqual([
      {
        line: 1,
        column: 1,
        message: "BigDecision must contain at least two Options",
      },
    ]);
  });

  it("should reject duplicate option titles at the duplicate's position", () => {
    const { diagnostics } = compile({
      options: [
        option({ title: "Same", line: 3 }),
        option({ title: "Same", line: 7 }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 7,
        column: 1,
        message: 'Duplicate Option title "Same" in BigDecision',
      },
    ]);
  });

  it("should reject more than one recommended option", () => {
    const { diagnostics } = compile({
      options: [
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
    for (const status of [undefined, "deferred"]) {
      const { diagnostics } = compile({
        attributes: {
          question: "Which store?",
          ...(status === undefined ? {} : { status }),
        },
        options: [
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
    }
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

  it("should reject a decided decision with two chosen options", () => {
    const { diagnostics } = compile({
      attributes: { question: "Which store?", status: "decided" },
      options: [
        option({ title: "A", line: 3, chosen: true }),
        option({ title: "B", line: 7, chosen: true }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 7,
        column: 1,
        message: "BigDecision cannot contain more than one chosen Option",
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

  it("should reject an unknown status value with the enum voice", () => {
    expect(
      diagnosticsFor(
        '<BigDecision question="Q?" status="settled">\n\n<Option title="A" />\n\n<Option title="B" />\n\n</BigDecision>\n',
      ),
    ).toEqual([
      {
        line: 1,
        column: 1,
        message:
          'Invalid value for attribute "status"; expected one of: open, decided, deferred',
      },
    ]);
  });

  it("should reject an unknown attribute on an option", () => {
    expect(
      diagnosticsFor(
        '<BigDecision question="Q?">\n\n<Option title="A" weight="3" />\n\n<Option title="B" />\n\n</BigDecision>\n',
      ),
    ).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Unknown attribute "weight" on Option',
      },
    ]);
  });

  it("should leave Pro unknown when it skips its Option parent", () => {
    expect(
      diagnosticsFor(
        '<BigDecision question="Q?">\n\n<Pro>\nStranded.\n</Pro>\n\n<Option title="A" />\n\n<Option title="B" />\n\n</BigDecision>\n',
      ),
    ).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Unknown component "Pro"',
      },
    ]);
  });

  it("should enforce the Pro body policy against headings", () => {
    expect(
      diagnosticsFor(
        '<BigDecision question="Q?">\n\n<Option title="A">\n\n<Pro>\n# Heading\n</Pro>\n\n</Option>\n\n<Option title="B" />\n\n</BigDecision>\n',
      ),
    ).toEqual([
      {
        line: 6,
        column: 1,
        message: "Pro bodies cannot contain headings",
      },
    ]);
  });
});
