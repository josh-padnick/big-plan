// Tests HttpEndpoint's complete authored contract, scoped-body diagnostics,
// grouping, palette class selection, and semantic static card rendering.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { compileMarkdown, MarkdownDiagnosticsError } from "../../convert.js";
import type { ScopedChild } from "../../../../model/component-contract.js";
import { createDiagnosticCollector } from "../../../../model/diagnostics.js";
import { renderHttpEndpoint } from "./http-endpoint.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 24, column: 16, offset: 400 },
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

const fence = (source = '{ "ok": true }\n'): Element => ({
  type: "element",
  tagName: "pre",
  properties: {},
  children: [
    {
      type: "element",
      tagName: "code",
      properties: { className: ["language-json"] },
      children: [{ type: "text", value: source }],
    },
  ],
});

const scoped = ({
  name,
  attributes,
  children = [],
  line,
}: {
  readonly name: "Param" | "Request" | "Response";
  readonly attributes: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly line: number;
}): ScopedChild => ({
  name,
  attributes,
  children,
  position: positionAt(line),
});

const param = ({
  name = "planId",
  location = "path",
  line = 8,
}: {
  readonly name?: string;
  readonly location?: string;
  readonly line?: number;
} = {}): ScopedChild =>
  scoped({
    name: "Param",
    attributes: { name, in: location, type: "string", required: true },
    children: [paragraph()],
    line,
  });

const request = ({
  children = [fence()],
  line = 12,
}: {
  readonly children?: ReadonlyArray<ElementContent>;
  readonly line?: number;
} = {}): ScopedChild =>
  scoped({
    name: "Request",
    attributes: { contentType: "application/json" },
    children,
    line,
  });

const response = ({
  status = "200",
  children = [fence()],
  line = 16,
}: {
  readonly status?: string;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly line?: number;
} = {}): ScopedChild =>
  scoped({
    name: "Response",
    attributes: { status, label: "Result" },
    children,
    line,
  });

const render = ({
  attributes = { method: "POST", path: "/api/plans/{planId}" },
  children = [],
  scopedChildren = [],
}: {
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const element = renderHttpEndpoint({
    attributes,
    children,
    scopedChildren,
    position: POSITION,
    diagnostics,
  });
  return { element, diagnostics: diagnostics.diagnostics };
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

describe("renderHttpEndpoint attributes", () => {
  it("should use shared schema diagnostics for the endpoint attributes", () => {
    expect(
      render({
        attributes: {
          method: "TRACE",
          path: "  ",
          deprecated: "true",
          compact: true,
        },
      }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message:
          'Invalid value for attribute "method"; expected one of: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
      },
      {
        line: 3,
        column: 1,
        message: 'Attribute "path" must be a non-empty string',
      },
      {
        line: 3,
        column: 1,
        message:
          'Attribute "deprecated" is a shorthand boolean; use the bare form',
      },
      {
        line: 3,
        column: 1,
        message: 'Unknown attribute "compact" on HttpEndpoint',
      },
    ]);
  });

  it("should report missing required endpoint attributes", () => {
    expect(render({ attributes: {} }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          'Missing required attribute "method"; expected one of: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
      },
      {
        line: 3,
        column: 1,
        message: 'Missing required attribute "path"; expected a string',
      },
    ]);
  });

  it("should render a valid bare endpoint as a header-only figure", () => {
    const { element, diagnostics } = render({
      attributes: { method: "HEAD", path: "/health" },
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("figure");
    expect(rendered).toContain('"data-http-endpoint":""');
    expect(rendered).toContain('"value":"/health"');
    expect(rendered).not.toContain('"tagName":"section"');
  });
});

describe("renderHttpEndpoint scoped contracts", () => {
  it("should use shared schema diagnostics for Param, Request, and Response", () => {
    const { diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Param",
          attributes: {
            name: true,
            in: "cookie",
            required: "yes",
            extra: true,
          },
          line: 7,
        }),
        scoped({
          name: "Request",
          attributes: { contentType: true, extra: true },
          children: [fence()],
          line: 11,
        }),
        scoped({
          name: "Response",
          attributes: { status: true, label: true, extra: true },
          line: 15,
        }),
      ],
    });
    expect(diagnostics).toEqual([
      { line: 7, column: 1, message: 'Attribute "name" must be a string' },
      {
        line: 7,
        column: 1,
        message:
          'Invalid value for attribute "in"; expected one of: path, query, header, body',
      },
      {
        line: 7,
        column: 1,
        message:
          'Attribute "required" is a shorthand boolean; use the bare form',
      },
      { line: 7, column: 1, message: 'Unknown attribute "extra" on Param' },
      {
        line: 11,
        column: 1,
        message: 'Attribute "contentType" must be a string',
      },
      { line: 11, column: 1, message: 'Unknown attribute "extra" on Request' },
      { line: 15, column: 1, message: 'Attribute "status" must be a string' },
      { line: 15, column: 1, message: 'Attribute "label" must be a string' },
      { line: 15, column: 1, message: 'Unknown attribute "extra" on Response' },
    ]);
  });

  it.each(["99", "600", "2xx", "020", ""])(
    "should reject malformed response status %s at the response position",
    (status) => {
      expect(
        render({ scopedChildren: [response({ status, line: 19 })] })
          .diagnostics,
      ).toContainEqual({
        line: 19,
        column: 1,
        message:
          'Attribute "status" on Response must be a three-digit HTTP status from 100 to 599',
      });
    },
  );

  it("should reject duplicate parameter identities at the second Param", () => {
    expect(
      render({
        scopedChildren: [
          param({ line: 7 }),
          param({ line: 13 }),
          param({ location: "query", line: 19 }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 13,
        column: 1,
        message: 'Duplicate Param "planId" in "path"',
      },
    ]);
  });

  it("should reject every Request after the first at its own position", () => {
    expect(
      render({
        scopedChildren: [request({ line: 7 }), request({ line: 15 })],
      }).diagnostics,
    ).toEqual([
      {
        line: 15,
        column: 1,
        message: "HttpEndpoint cannot contain more than one Request",
      },
    ]);
  });

  it("should reject duplicate response statuses at the second Response", () => {
    expect(
      render({
        scopedChildren: [
          response({ status: "204", line: 7 }),
          response({ status: "204", line: 15 }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 15,
        column: 1,
        message: 'Duplicate Response status "204"',
      },
    ]);
  });

  it.each([
    { children: [] },
    { children: [fence(), fence()] },
    { children: [paragraph("Prose is not a request example."), fence()] },
  ])(
    "should require exactly one Request fence with no other content",
    ({ children }) => {
      expect(
        render({ scopedChildren: [request({ children, line: 21 })] })
          .diagnostics,
      ).toEqual([
        {
          line: 21,
          column: 1,
          message:
            "Request expects exactly one fenced code block and no other content",
        },
      ]);
    },
  );

  it("should reject a second Response fence while allowing surrounding prose", () => {
    expect(
      render({
        scopedChildren: [
          response({
            children: [paragraph("First form."), fence(), fence()],
            line: 17,
          }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 17,
        column: 1,
        message:
          "Response bodies cannot contain more than one fenced code block",
      },
    ]);
    expect(
      render({
        scopedChildren: [
          response({ children: [paragraph("Optional prose."), fence()] }),
        ],
      }).diagnostics,
    ).toEqual([]);
  });
});

describe("HttpEndpoint scoped Markdown policy", () => {
  it.each(["Param", "Request", "Response"])(
    "should prohibit headings and typed components in %s bodies",
    (name) => {
      const attributes =
        name === "Param"
          ? 'name="id" in="path"'
          : name === "Response"
            ? 'status="200"'
            : "";
      const diagnostics = diagnosticsFor(
        `<HttpEndpoint method="GET" path="/plans/{id}">\n<${name} ${attributes}>\n### Nested heading\n\n<Callout type="note">\n\nNo nesting.\n\n</Callout>\n</${name}>\n</HttpEndpoint>\n`,
      );
      expect(diagnostics).toContainEqual({
        line: 3,
        column: 1,
        message: `${name} bodies cannot contain headings`,
      });
      expect(diagnostics).toContainEqual({
        line: 5,
        column: 1,
        message: `${name} bodies cannot contain typed components`,
      });
    },
  );

  it.each(["Param", "Request", "Response"])(
    "should prohibit footnotes in %s bodies",
    (name) => {
      const attributes =
        name === "Param"
          ? 'name="id" in="path"'
          : name === "Response"
            ? 'status="200"'
            : "";
      const diagnostics = diagnosticsFor(
        `<HttpEndpoint method="GET" path="/plans/{id}">\n<${name} ${attributes}>\nSee the note.[^note]\n\n[^note]: Scoped note.\n</${name}>\n</HttpEndpoint>\n`,
      );
      expect(diagnostics).toContainEqual({
        line: 3,
        column: 14,
        message: `${name} bodies cannot contain footnote references`,
      });
      expect(diagnostics).toContainEqual({
        line: 5,
        column: 1,
        message: `${name} bodies cannot contain footnote definitions`,
      });
    },
  );
});

describe("renderHttpEndpoint presentation", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])(
    "should select the %s method pill class",
    (method) => {
      const { element, diagnostics } = render({
        attributes: { method, path: "/health" },
      });
      expect(diagnostics).toEqual([]);
      expect(JSON.stringify(element)).toContain(
        `"http-endpoint-method-${method.toLowerCase()}"`,
      );
    },
  );

  it.each([
    ["100", "informational"],
    ["201", "success"],
    ["304", "redirect"],
    ["404", "client-error"],
    ["503", "server-error"],
  ])("should select the %s response status class", (status, statusClass) => {
    const { element, diagnostics } = render({
      scopedChildren: [response({ status })],
    });
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(element)).toContain(
      `"http-endpoint-status-${statusClass}"`,
    );
  });

  it("should tint each path placeholder without splitting literal path text", () => {
    const { element, diagnostics } = render({
      attributes: {
        method: "GET",
        path: "/api/plans/{planId}/comments/{commentId}",
      },
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(rendered.match(/http-endpoint-placeholder/gu)).toHaveLength(2);
    expect(rendered).toContain('"value":"{planId}"');
    expect(rendered).toContain('"value":"/comments/"');
    expect(rendered).toContain('"value":"{commentId}"');
  });

  it("should group parameters by location while preserving authored group order", () => {
    const { element, diagnostics } = render({
      scopedChildren: [
        param({ name: "payload", location: "body", line: 7 }),
        param({ name: "trace", location: "header", line: 11 }),
        param({ name: "page", location: "query", line: 15 }),
        param({ name: "planId", location: "path", line: 19 }),
        param({ name: "sort", location: "query", line: 23 }),
      ],
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    const locations = ["path", "query", "header", "body"].map((location) =>
      rendered.indexOf(`"data-http-param-location":"${location}"`),
    );
    expect(locations).toEqual(
      [...locations].sort((left, right) => left - right),
    );
    expect(rendered.indexOf('"value":"page"')).toBeLessThan(
      rendered.indexOf('"value":"sort"'),
    );
  });

  it("should render deprecation and authentication directly below the header", () => {
    const { element, diagnostics } = render({
      attributes: {
        method: "DELETE",
        path: "/api/plans/{planId}",
        summary: "Delete a plan",
        auth: "Bearer token",
        deprecated: true,
      },
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(element.properties["data-http-deprecated"]).toBe("");
    expect(rendered).toContain('"value":"Deprecated"');
    expect(rendered).toContain('"line-through"');
    expect(rendered).toContain('"data-lucide":"lock"');
    expect(rendered).toContain('"value":"Bearer token"');
  });

  it("should mark optional params and render an authored default beside them", () => {
    const { element, diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Param",
          attributes: {
            name: "force",
            in: "query",
            type: "boolean",
            default: "false",
          },
          children: [paragraph()],
          line: 8,
        }),
        param({ line: 10 }),
      ],
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(rendered).toContain('"value":"optional"');
    expect(rendered).toContain('"value":"default "');
    expect(rendered).toContain('"value":"false"');
    // The required param carries the required marker, never the optional one.
    expect(rendered.match(/"value":"optional"/gu)).toHaveLength(1);
    expect(rendered.match(/"value":"required"/gu)).toHaveLength(1);
  });

  it("should diagnose a default on a required param", () => {
    const { diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Param",
          attributes: {
            name: "planId",
            in: "path",
            required: true,
            default: "pln_1",
          },
          children: [paragraph()],
          line: 8,
        }),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 8,
        column: 1,
        message: 'Attribute "default" is only valid on an optional Param',
      },
    ]);
  });

  it("should split parameters into location sections and seat body fields in the request", () => {
    const { element, diagnostics } = render({
      scopedChildren: [
        param({ line: 6 }),
        scoped({
          name: "Param",
          attributes: { name: "verbose", in: "query", type: "boolean" },
          children: [paragraph()],
          line: 8,
        }),
        scoped({
          name: "Param",
          attributes: {
            name: "cacheKeys",
            in: "body",
            type: "string[]",
            required: true,
          },
          children: [paragraph()],
          line: 10,
        }),
        request({ line: 14 }),
      ],
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(rendered).not.toContain('"value":"Parameters"');
    const labels = ["Path parameters", "Query parameters", "Request body"];
    const indexes = labels.map((label) =>
      rendered.indexOf(`"value":"${label}"`),
    );
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
    // The body field renders inside the Request body section, before the
    // example fence, and no per-row location badge restates the sections.
    expect(rendered.indexOf('"value":"cacheKeys"')).toBeGreaterThan(
      rendered.indexOf('"value":"Request body"'),
    );
    expect(rendered.indexOf('"value":"cacheKeys"')).toBeLessThan(
      rendered.indexOf('"tagName":"pre"'),
    );
    // The fence is labeled as the body's example, between fields and code.
    expect(rendered.indexOf('"value":"Example"')).toBeGreaterThan(
      rendered.indexOf('"value":"cacheKeys"'),
    );
    expect(rendered.indexOf('"value":"Example"')).toBeLessThan(
      rendered.indexOf('"tagName":"pre"'),
    );
    expect(rendered).not.toContain('"value":"path"');
  });

  it("should render the request body section for body fields without a Request", () => {
    const { element, diagnostics } = render({
      scopedChildren: [
        scoped({
          name: "Param",
          attributes: { name: "reason", in: "body", type: "string" },
          children: [paragraph()],
          line: 10,
        }),
      ],
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(rendered).toContain('"value":"Request body"');
    expect(rendered).toContain('"value":"reason"');
  });
});
