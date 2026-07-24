// Tests SmallDecisionSet's pure compiler and end-to-end positional
// diagnostics across its authoring-validation matrix.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { compileMarkdown, MarkdownDiagnosticsError } from "../../convert.js";
import type {
  ComponentAttributeValue,
  ScopedChild,
} from "../component-contract.js";
import { createDiagnosticCollector } from "../diagnostics.js";
import { compileSmallDecisionSetComponent } from "./compile-small-decision-set.js";

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
  readonly name: "SmallDecision" | "Option";
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
  detail = [],
}: {
  readonly title: string;
  readonly line: number;
  readonly recommended?: boolean;
  readonly detail?: ReadonlyArray<ElementContent>;
}): ScopedChild =>
  scoped({
    name: "Option",
    attributes: { title, ...(recommended ? { recommended: true } : {}) },
    children: detail,
    line,
  });

const question = ({
  question = "Ship now?",
  line = 3,
  options = [
    option({ title: "Yes", line: 4 }),
    option({ title: "No", line: 6 }),
  ],
  context = [],
}: {
  readonly question?: string;
  readonly line?: number;
  readonly options?: ReadonlyArray<ScopedChild>;
  readonly context?: ReadonlyArray<ElementContent>;
} = {}): ScopedChild =>
  scoped({
    name: "SmallDecision",
    attributes: { question },
    children: context,
    scopedChildren: options,
    line,
  });

const compile = ({
  attributes = {},
  children = [],
  decisions = [question()],
}: {
  readonly attributes?: Readonly<Record<string, ComponentAttributeValue>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly decisions?: ReadonlyArray<ScopedChild>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const model = compileSmallDecisionSetComponent({
    attributes,
    children,
    scopedChildren: decisions,
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

describe("compileSmallDecisionSetComponent", () => {
  it("should compile the complete model when every layer is authored", () => {
    const { model, diagnostics } = compile({
      attributes: { title: "Open questions" },
      children: [paragraph("Intro.")],
      decisions: [
        question({
          question: "Ship now?",
          context: [paragraph("Context.")],
          options: [
            option({
              title: "Yes",
              line: 4,
              recommended: true,
              detail: [paragraph("Ships the safer default.")],
            }),
            option({ title: "No", line: 6 }),
          ],
        }),
        question({ question: "Rename later?", line: 9 }),
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(model).toMatchObject({
      title: "Open questions",
      decisions: [
        {
          id: "question-ship-now",
          question: "Ship now?",
          options: [
            { id: "option-yes", title: "Yes", recommended: true },
            { id: "option-no", title: "No", recommended: false },
          ],
        },
        { id: "question-rename-later", question: "Rename later?" },
      ],
    });
    expect(model.intro).toHaveLength(1);
    expect(model.decisions[0]?.context).toHaveLength(1);
    expect(model.decisions[0]?.options[0]?.detail).toHaveLength(1);
  });

  it("should deduplicate question ids when questions repeat", () => {
    const { model } = compile({
      decisions: [
        question({ question: "Same?", line: 3 }),
        question({ question: "Same?", line: 9 }),
      ],
    });
    expect(model.decisions.map(({ id }) => id)).toEqual([
      "question-same",
      "question-same-2",
    ]);
  });

  it("should reject a set with no questions", () => {
    const { diagnostics } = compile({ decisions: [] });
    expect(diagnostics).toEqual([
      {
        line: 1,
        column: 1,
        message: "SmallDecisionSet must contain at least one SmallDecision",
      },
    ]);
  });

  it("should reject a question with fewer than two options", () => {
    const { diagnostics } = compile({
      decisions: [question({ options: [option({ title: "Only", line: 4 })] })],
    });
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "SmallDecision must contain at least two Options",
      },
    ]);
  });

  it("should reject duplicate option titles at the duplicate's position", () => {
    const { diagnostics } = compile({
      decisions: [
        question({
          options: [
            option({ title: "Same", line: 4 }),
            option({ title: "Same", line: 6 }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 6,
        column: 1,
        message: 'Duplicate Option title "Same" in SmallDecision',
      },
    ]);
  });

  it("should reject more than one recommended option", () => {
    const { diagnostics } = compile({
      decisions: [
        question({
          options: [
            option({ title: "A", line: 4, recommended: true }),
            option({ title: "B", line: 6, recommended: true }),
          ],
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 6,
        column: 1,
        message:
          "SmallDecision cannot contain more than one recommended Option",
      },
    ]);
  });
});

describe("SmallDecisionSet end-to-end diagnostics", () => {
  it("should reject a missing question with the shared schema voice", () => {
    expect(
      diagnosticsFor(
        '<SmallDecisionSet>\n\n<SmallDecision>\n\n<Option title="A" />\n\n<Option title="B" />\n\n</SmallDecision>\n\n</SmallDecisionSet>\n',
      ),
    ).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Missing required attribute "question"; expected a string',
      },
    ]);
  });

  it("should reject the chosen attribute options do not support here", () => {
    expect(
      diagnosticsFor(
        '<SmallDecisionSet>\n\n<SmallDecision question="Q?">\n\n<Option title="A" chosen />\n\n<Option title="B" />\n\n</SmallDecision>\n\n</SmallDecisionSet>\n',
      ),
    ).toEqual([
      {
        line: 5,
        column: 1,
        message: 'Unknown attribute "chosen" on Option',
      },
    ]);
  });

  it("should leave SmallDecision unknown outside its set", () => {
    expect(
      diagnosticsFor(
        '<SmallDecision question="Q?">\n\n<Option title="A" />\n\n<Option title="B" />\n\n</SmallDecision>\n',
      ),
    ).toEqual([
      {
        line: 1,
        column: 1,
        message: 'Unknown component "SmallDecision"',
      },
      {
        line: 3,
        column: 1,
        message: 'Unknown component "Option"',
      },
      {
        line: 5,
        column: 1,
        message: 'Unknown component "Option"',
      },
    ]);
  });

  it("should enforce the Option body policy against headings", () => {
    expect(
      diagnosticsFor(
        '<SmallDecisionSet>\n\n<SmallDecision question="Q?">\n\n<Option title="A">\n\n# Heading\n\n</Option>\n\n<Option title="B" />\n\n</SmallDecision>\n\n</SmallDecisionSet>\n',
      ),
    ).toEqual([
      {
        line: 7,
        column: 1,
        message: "Option bodies cannot contain headings",
      },
    ]);
  });
});
