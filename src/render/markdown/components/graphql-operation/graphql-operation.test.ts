// Tests GraphqlOperation's authored contract diagnostics, example-fence
// language enforcement, and semantic static card rendering.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import type { ScopedChild } from "../component-contract.js";
import { createDiagnosticCollector } from "../diagnostics.js";
import { renderGraphqlOperation } from "./graphql-operation.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 30, column: 20, offset: 500 },
};

const positionAt = (line: number) => ({
  start: { line, column: 1, offset: line * 20 },
  end: { line: line + 2, column: 12, offset: line * 20 + 40 },
});

const paragraph = (value = "Documented behavior."): Element => ({
  type: "element",
  tagName: "p",
  properties: {},
  children: [{ type: "text", value }],
});

const fence = ({
  language = "graphql",
  source = "query { plan { id } }\n",
}: {
  readonly language?: string;
  readonly source?: string;
} = {}): Element => ({
  type: "element",
  tagName: "pre",
  properties: {},
  children: [
    {
      type: "element",
      tagName: "code",
      properties: { className: [`language-${language}`] },
      children: [{ type: "text", value: source }],
    },
  ],
});

const scoped = ({
  name,
  attributes = {},
  children = [],
  line = 8,
}: {
  readonly name: string;
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly line?: number;
}): ScopedChild => ({
  name,
  attributes,
  children,
  position: positionAt(line),
});

const render = ({
  attributes = { kind: "mutation", name: "commentCreate" },
  children = [],
  scopedChildren = [],
}: {
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const element = renderGraphqlOperation({
    attributes,
    children,
    scopedChildren,
    position: POSITION,
    diagnostics,
  });
  return { element, diagnostics: diagnostics.diagnostics };
};

describe("renderGraphqlOperation", () => {
  it("should diagnose missing required attributes", () => {
    const { diagnostics } = render({ attributes: {} });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Missing required attribute "kind"; expected one of: query, mutation, subscription',
      'Missing required attribute "name"; expected a string',
    ]);
  });

  it("should diagnose a deprecation reason without the deprecated flag", () => {
    const { diagnostics } = render({
      attributes: {
        kind: "query",
        name: "plan",
        deprecationReason: "Use planById.",
      },
    });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Attribute "deprecationReason" requires the "deprecated" attribute',
    ]);
  });

  it("should diagnose duplicate arguments by name", () => {
    const { diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Argument",
          attributes: { name: "input", type: "CommentCreateInput!" },
          children: [paragraph()],
          line: 6,
        }),
        scoped({
          name: "Argument",
          attributes: { name: "input", type: "String" },
          children: [paragraph()],
          line: 9,
        }),
      ],
    });
    expect(diagnostics).toEqual([
      { line: 9, column: 1, message: 'Duplicate Argument "input"' },
    ]);
  });

  it("should diagnose repeated single-instance children", () => {
    const { diagnostics } = render({
      scopedChildren: [
        scoped({ name: "Operation", children: [fence()], line: 10 }),
        scoped({ name: "Operation", children: [fence()], line: 14 }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 14,
        column: 1,
        message: "GraphqlOperation cannot contain more than one Operation",
      },
    ]);
  });

  it.each([
    ["Operation", "graphql", "json"],
    ["Variables", "json", "graphql"],
    ["Response", "json", "text"],
  ])(
    "should diagnose a %s example without its %s fence",
    (name, language, wrongLanguage) => {
      const { diagnostics } = render({
        scopedChildren: [
          ...(name === "Variables"
            ? [scoped({ name: "Operation", children: [fence()], line: 6 })]
            : []),
          scoped({
            name,
            children: [fence({ language: wrongLanguage })],
            line: 12,
          }),
        ],
      });
      expect(diagnostics).toEqual([
        {
          line: 12,
          column: 1,
          message: `${name} expects exactly one fenced code block with language ${language} and no other content`,
        },
      ]);
    },
  );

  it("should diagnose variables without an operation example", () => {
    const { diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Variables",
          children: [fence({ language: "json" })],
          line: 11,
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 11,
        column: 1,
        message: "Variables requires an Operation example beside it",
      },
    ]);
  });

  it("should render a bare header-only operation without diagnostics", () => {
    const { element, diagnostics } = render();
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("figure");
    expect(element.properties["data-graphql-operation"]).toBe("");
    expect(element.properties["data-graphql-kind"]).toBe("mutation");
    expect(rendered).toContain('"value":"commentCreate"');
    expect(rendered).not.toContain('"tagName":"section"');
  });

  it.each(["query", "mutation", "subscription"])(
    "should select the %s kind pill class",
    (kind) => {
      const { element } = render({
        attributes: { kind, name: "plan" },
      });
      expect(JSON.stringify(element)).toContain(
        `graphql-operation-kind-${kind}`,
      );
    },
  );

  it("should render the full card anatomy in contract order", () => {
    const { element, diagnostics } = render({
      attributes: {
        kind: "mutation",
        name: "commentCreate",
        access: "Requires plan write access",
      },
      children: [paragraph("Creates a comment.")],
      scopedChildren: [
        scoped({
          name: "Argument",
          attributes: { name: "input", type: "CommentCreateInput!" },
          children: [paragraph("The payload.")],
          line: 6,
        }),
        scoped({
          name: "Returns",
          attributes: { type: "CommentCreatePayload" },
          children: [paragraph("The created comment.")],
          line: 10,
        }),
        scoped({ name: "Operation", children: [fence()], line: 14 }),
        scoped({
          name: "Variables",
          children: [fence({ language: "json" })],
          line: 18,
        }),
        scoped({
          name: "Response",
          children: [fence({ language: "json" })],
          line: 22,
        }),
      ],
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(rendered).toContain('"data-lucide":"lock"');
    expect(rendered).toContain('"value":"Requires plan write access"');
    expect(rendered).toContain('"value":"CommentCreateInput!"');
    const labels = [
      "Arguments",
      "Returns",
      "Operation",
      "Variables",
      "Response",
    ];
    const indexes = labels.map((label) =>
      rendered.indexOf(`"value":"${label}"`),
    );
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it("should strike the name and badge the reason when deprecated", () => {
    const { element, diagnostics } = render({
      attributes: {
        kind: "query",
        name: "plan",
        deprecated: true,
        deprecationReason: "Use planById.",
      },
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(element.properties["data-graphql-deprecated"]).toBe("");
    expect(rendered).toContain('"line-through"');
    expect(rendered).toContain("graphql-operation-deprecated");
    expect(rendered).toContain('"value":"Use planById."');
  });

  it("should diagnose an unknown attribute", () => {
    const { diagnostics } = render({
      attributes: { kind: "query", name: "plan", verb: "GET" },
    });
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Unknown attribute "verb" on GraphqlOperation',
      },
    ]);
  });

  it("should close the card with a review checklist when authored", () => {
    const { element, diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Review",
          children: [paragraph("Should this mutation be idempotent?")],
          line: 20,
        }),
      ],
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(rendered).toContain('"data-review-checklist":""');
    expect(rendered).toContain('"value":"Review checklist"');
  });
});
