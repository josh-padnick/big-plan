// Tests GrpcMethod's authored contract diagnostics, streaming-aware signature
// rendering, field grouping, and semantic static card rendering.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import type { ScopedChild } from "../../../../model/component-contract.js";
import { createDiagnosticCollector } from "../../../../model/diagnostics.js";
import type { CompiledComponent } from "../define-component.js";
import { reactToHast } from "../react-hast-adapter.js";
import { GRPC_METHOD_COMPONENT_DEFINITION } from "./grpc-method.js";

const parseRenderedElement = (compiled: CompiledComponent): Element => {
  const parsed = reactToHast(compiled.presentation());
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

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
  language = "proto",
  source = "rpc WatchComments(WatchCommentsRequest) returns (stream Comment);\n",
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

const BASE_ATTRIBUTES = {
  service: "bigplan.v1.CommentService",
  name: "WatchComments",
  request: "WatchCommentsRequest",
  response: "Comment",
} satisfies Readonly<Record<string, string>>;

const render = ({
  attributes = BASE_ATTRIBUTES,
  children = [],
  scopedChildren = [],
}: {
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const element = parseRenderedElement(
    GRPC_METHOD_COMPONENT_DEFINITION.compile({
      attributes,
      children,
      scopedChildren,
      position: POSITION,
      diagnostics,
    }),
  );
  return { element, diagnostics: diagnostics.diagnostics };
};

// Collects the rendered signature text so streaming placement is asserted on
// what a reader actually sees.
const textContent = (node: Element | ElementContent): string => {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type !== "element") {
    return "";
  }
  return node.children.map(textContent).join("");
};

const signatureText = (element: Element): string => {
  const rendered = JSON.stringify(element);
  expect(rendered).toContain("grpc-method-signature");
  const find = (node: Element): Element | undefined => {
    const classes = Array.isArray(node.properties["className"])
      ? node.properties["className"]
      : [];
    if (classes.includes("grpc-method-signature")) {
      return node;
    }
    for (const child of node.children) {
      if (child.type === "element") {
        const found = find(child);
        if (found !== undefined) {
          return found;
        }
      }
    }
    return undefined;
  };
  const signature = find(element);
  return signature === undefined ? "" : textContent(signature);
};

describe("renderGrpcMethod", () => {
  it("should diagnose missing required attributes", () => {
    const { diagnostics } = render({ attributes: {} });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Missing required attribute "service"; expected a string',
      'Missing required attribute "name"; expected a string',
      'Missing required attribute "request"; expected a string',
      'Missing required attribute "response"; expected a string',
    ]);
  });

  it("should diagnose an invalid streaming kind", () => {
    const { diagnostics } = render({
      attributes: { ...BASE_ATTRIBUTES, kind: "streaming" },
    });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Invalid value for attribute "kind"; expected one of: unary, serverStreaming, clientStreaming, bidiStreaming',
    ]);
  });

  it("should render a unary signature without stream keywords by default", () => {
    const { element, diagnostics } = render();
    expect(diagnostics).toEqual([]);
    expect(element.properties["data-grpc-kind"]).toBe("unary");
    expect(signatureText(element)).toBe(
      "rpc WatchComments(WatchCommentsRequest) returns (Comment)",
    );
  });

  it.each([
    [
      "serverStreaming",
      "rpc WatchComments(WatchCommentsRequest) returns (stream Comment)",
    ],
    [
      "clientStreaming",
      "rpc WatchComments(stream WatchCommentsRequest) returns (Comment)",
    ],
    [
      "bidiStreaming",
      "rpc WatchComments(stream WatchCommentsRequest) returns (stream Comment)",
    ],
  ])("should place the stream keyword for %s", (kind, expected) => {
    const { element, diagnostics } = render({
      attributes: { ...BASE_ATTRIBUTES, kind },
    });
    expect(diagnostics).toEqual([]);
    expect(signatureText(element)).toBe(expected);
    expect(JSON.stringify(element)).toContain(
      `grpc-method-kind-${kind.toLowerCase()}`,
    );
  });

  it("should group fields into request and response sections", () => {
    const { element, diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Field",
          attributes: { in: "response", name: "body", type: "string" },
          children: [paragraph("The comment body.")],
          line: 12,
        }),
        scoped({
          name: "Field",
          attributes: { in: "request", name: "plan_id", type: "string" },
          children: [paragraph("Required. The plan resource name.")],
          line: 8,
        }),
      ],
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    const requestIndex = rendered.indexOf('"value":"Request"');
    const responseIndex = rendered.indexOf('"value":"Response"');
    // The sections name their message types beside the labels.
    expect(rendered).toContain('"value":"WatchCommentsRequest"');
    expect(rendered.indexOf('"value":"Comment"')).toBeGreaterThan(-1);
    expect(requestIndex).toBeGreaterThan(-1);
    expect(responseIndex).toBeGreaterThan(requestIndex);
    expect(rendered).toContain('"data-grpc-field":"request"');
    expect(rendered).toContain('"data-grpc-field":"response"');
  });

  it("should diagnose duplicate field identities per side", () => {
    const { diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Field",
          attributes: { in: "request", name: "plan_id" },
          line: 8,
        }),
        scoped({
          name: "Field",
          attributes: { in: "request", name: "plan_id" },
          line: 11,
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 11,
        column: 1,
        message: 'Duplicate Field "plan_id" in "request"',
      },
    ]);
  });

  it("should diagnose an unknown error code", () => {
    const { diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Error",
          attributes: { code: "TEAPOT" },
          children: [paragraph()],
          line: 15,
        }),
      ],
    });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Invalid value for attribute "code"; expected one of: CANCELLED, UNKNOWN, INVALID_ARGUMENT, DEADLINE_EXCEEDED, NOT_FOUND, ALREADY_EXISTS, PERMISSION_DENIED, UNAUTHENTICATED, RESOURCE_EXHAUSTED, FAILED_PRECONDITION, ABORTED, OUT_OF_RANGE, UNIMPLEMENTED, INTERNAL, UNAVAILABLE, DATA_LOSS',
    ]);
  });

  it("should diagnose duplicate error codes", () => {
    const { diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Error",
          attributes: { code: "NOT_FOUND" },
          children: [paragraph()],
          line: 15,
        }),
        scoped({
          name: "Error",
          attributes: { code: "NOT_FOUND" },
          children: [paragraph()],
          line: 18,
        }),
      ],
    });
    expect(diagnostics).toEqual([
      { line: 18, column: 1, message: 'Duplicate Error code "NOT_FOUND"' },
    ]);
  });

  it("should diagnose a second proto and a wrong-language proto fence", () => {
    const { diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Proto",
          children: [fence({ language: "text" })],
          line: 20,
        }),
        scoped({ name: "Proto", children: [fence()], line: 24 }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 24,
        column: 1,
        message: "GrpcMethod cannot contain more than one Proto",
      },
      {
        line: 20,
        column: 1,
        message:
          "Proto expects exactly one fenced code block with language proto and no other content",
      },
    ]);
  });

  it("should group labeled examples under one example section", () => {
    const { element, diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Example",
          attributes: { label: "Request" },
          children: [
            fence({ language: "json", source: '{ "plan_id": "pln_42" }\n' }),
          ],
          line: 18,
        }),
        scoped({
          name: "Example",
          attributes: { label: "Stream" },
          children: [
            fence({
              language: "text",
              source: "status: queued\nstatus: done\n",
            }),
          ],
          line: 22,
        }),
      ],
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(rendered).toContain('"data-grpc-example":""');
    expect(rendered).toContain('"value":"Example"');
    expect(rendered).toContain('"value":"Stream"');
  });

  it("should diagnose an example without exactly one fence", () => {
    const { diagnostics } = render({
      scopedChildren: [
        scoped({ name: "Example", children: [paragraph()], line: 18 }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 18,
        column: 1,
        message:
          "Example expects exactly one fenced code block and no other content",
      },
    ]);
  });

  it("should render a bare header-only method without diagnostics", () => {
    const { element, diagnostics } = render();
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("figure");
    expect(element.properties["data-grpc-method"]).toBe("");
    expect(rendered).toContain('"value":"bigplan.v1.CommentService"');
    expect(rendered).not.toContain('"tagName":"section"');
  });

  it("should render errors and proto with their palette hooks", () => {
    const { element, diagnostics } = render({
      children: [paragraph("Streams new comments.")],
      scopedChildren: [
        scoped({
          name: "Error",
          attributes: { code: "NOT_FOUND" },
          children: [paragraph("The plan does not exist.")],
          line: 15,
        }),
        scoped({ name: "Proto", children: [fence()], line: 20 }),
      ],
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(rendered).toContain('"data-grpc-error":"NOT_FOUND"');
    expect(rendered).toContain("grpc-method-error-code");
    expect(rendered).toContain('"value":"Proto"');
  });

  it("should strike the method name when deprecated", () => {
    const { element, diagnostics } = render({
      attributes: { ...BASE_ATTRIBUTES, deprecated: true },
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(element.properties["data-grpc-deprecated"]).toBe("");
    expect(rendered).toContain('"line-through"');
    expect(rendered).toContain("grpc-method-deprecated");
  });
});
