// Tests DatabaseTableSchema's attribute and fence validation plus the
// rendered header identity, grid rows, badges, sections, and raw copy source.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../diagnostics.js";
import { renderDatabaseTableSchema } from "./database-table-schema.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 15, column: 15, offset: 200 },
};

const SOURCE = [
  "id bigint [pk, increment]",
  "customer_id bigint [not null, ref: > public.customers.id, delete: cascade]",
  "status text [not null, default: 'trialing', note: 'Denormalized']",
  "username text [check: 'char_length(username) > 4']",
  "indexes {",
  "  (customer_id, status) [unique, where: 'status = live']",
  "}",
  "Note: 'One row per subscription attempt.'",
  "",
].join("\n");

const fence = ({
  language = "dbml",
  source = SOURCE,
}: {
  readonly language?: string | null;
  readonly source?: string;
} = {}): Element => ({
  type: "element",
  tagName: "pre",
  properties: {},
  children: [
    {
      type: "element",
      tagName: "code",
      properties:
        language === null ? {} : { className: [`language-${language}`] },
      children: [{ type: "text", value: source }],
      position: {
        start: { line: 4, column: 1, offset: 40 },
        end: { line: 13, column: 4, offset: 190 },
      },
    },
  ],
});

const render = ({
  attributes = { name: "public.subscriptions" },
  children = [fence()],
}: {
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const element = renderDatabaseTableSchema({
    attributes,
    children,
    scopedChildren: [],
    position: POSITION,
    diagnostics,
  });
  return { element, diagnostics: diagnostics.diagnostics };
};

const collectText = (node: ElementContent | Element): string => {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type !== "element") {
    return "";
  }
  return node.children.map((child) => collectText(child)).join("");
};

const hasClass = (element: Element, name: string): boolean => {
  const className = element.properties.className;
  return Array.isArray(className) && className.includes(name);
};

const queryAll = (
  node: Element,
  matches: (element: Element) => boolean,
): ReadonlyArray<Element> => {
  const found: Array<Element> = [];
  const visit = (candidate: ElementContent): void => {
    if (candidate.type !== "element") {
      return;
    }
    if (matches(candidate)) {
      found.push(candidate);
    }
    for (const child of candidate.children) {
      visit(child);
    }
  };
  visit(node);
  return found;
};

describe("renderDatabaseTableSchema validation", () => {
  it("should require the name attribute", () => {
    expect(render({ attributes: {} }).diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: 'Missing required attribute "name"; expected a string',
    });
  });

  it("should diagnose unknown attributes on the component", () => {
    expect(
      render({ attributes: { name: "users", engine: "postgres" } }).diagnostics,
    ).toContainEqual({
      line: 3,
      column: 1,
      message: 'Unknown attribute "engine" on DatabaseTableSchema',
    });
  });

  const NO_CHILDREN: ReadonlyArray<ElementContent> = [];

  it.each([
    [NO_CHILDREN],
    [[fence({ language: "sql" })]],
    [[fence(), fence()]],
  ])("should require exactly one dbml fence", (children) => {
    expect(render({ children }).diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message:
        "DatabaseTableSchema expects exactly one fenced code block with language dbml and no other content",
    });
  });

  it("should remap grammar diagnostics onto fence-relative lines", () => {
    const { diagnostics } = render({
      children: [fence({ source: "id bigint\nbroken\n" })],
    });
    expect(diagnostics).toEqual([
      {
        line: 6,
        column: 1,
        message: 'Invalid schema line 2: Column "broken" is missing a type',
      },
    ]);
  });
});

describe("renderDatabaseTableSchema rendering", () => {
  it("should split the header into schema prefix and table name", () => {
    const { element, diagnostics } = render();
    expect(diagnostics).toEqual([]);
    const schemaSpan = queryAll(element, (candidate) =>
      hasClass(candidate, "table-schema-name-schema"),
    );
    const tableSpan = queryAll(element, (candidate) =>
      hasClass(candidate, "table-schema-name-table"),
    );
    expect(collectText(schemaSpan[0] ?? element)).toBe("public.");
    expect(collectText(tableSpan[0] ?? element)).toBe("subscriptions");
    expect(element.properties["data-schema-table-name"]).toBe(
      "public.subscriptions",
    );
  });

  it("should keep an unqualified name whole with no schema prefix", () => {
    const { element } = render({ attributes: { name: "subscriptions" } });
    expect(
      queryAll(element, (candidate) =>
        hasClass(candidate, "table-schema-name-schema"),
      ),
    ).toHaveLength(0);
  });

  it("should render one grid row per column with the dense column order", () => {
    const { element } = render();
    const columnsGrid = queryAll(
      element,
      (candidate) => candidate.tagName === "table",
    )[0];
    const headLabels = queryAll(
      columnsGrid ?? element,
      (candidate) =>
        candidate.tagName === "th" && candidate.properties.scope === "col",
    ).map((head) => collectText(head));
    expect(headLabels).toEqual([
      "Column",
      "Type",
      "Constraints",
      "Default",
      "Comment",
    ]);
    const rows = queryAll(
      element,
      (candidate) => candidate.properties["data-schema-column"] !== undefined,
    );
    expect(rows.map((row) => row.properties["data-schema-column"])).toEqual([
      "id",
      "customer_id",
      "status",
      "username",
    ]);
  });

  it("should badge keys and imply not null for the primary key", () => {
    const { element } = render();
    const idRow = queryAll(
      element,
      (candidate) => candidate.properties["data-schema-column"] === "id",
    )[0];
    expect(idRow).toBeDefined();
    const badges = queryAll(
      idRow ?? element,
      (candidate) =>
        typeof candidate.properties["data-schema-badge"] === "string",
    ).map((found) => found.properties["data-schema-badge"]);
    expect(badges).toEqual(["pk", "identity"]);
    expect(collectText(idRow ?? element)).toContain("not null");
  });

  it("should state nullability explicitly when a column has no not null", () => {
    const { element } = render();
    const usernameRow = queryAll(
      element,
      (candidate) => candidate.properties["data-schema-column"] === "username",
    )[0];
    expect(collectText(usernameRow ?? element)).toContain("nullable");
  });

  it("should keep a commented column to one row with the note in its Comment cell", () => {
    const { element } = render();
    const statusRow = queryAll(
      element,
      (candidate) => candidate.properties["data-schema-column"] === "status",
    )[0];
    expect(statusRow).toBeDefined();
    const note = queryAll(
      statusRow ?? element,
      (candidate) => candidate.properties["data-schema-note"] !== undefined,
    )[0];
    expect(collectText(note ?? element)).toBe("Denormalized");
    expect(
      queryAll(element, (candidate) =>
        hasClass(candidate, "table-schema-detail-row"),
      ),
    ).toHaveLength(0);
  });

  it("should render the foreign key inside its column's constraints cell", () => {
    const { element } = render();
    const customerRow = queryAll(
      element,
      (candidate) =>
        candidate.properties["data-schema-column"] === "customer_id",
    )[0];
    expect(customerRow).toBeDefined();
    const refLine = queryAll(
      customerRow ?? element,
      (candidate) => candidate.properties["data-schema-ref"] !== undefined,
    )[0];
    const rendered = collectText(refLine ?? element);
    expect(rendered).toContain("public.customers.id");
    expect(rendered).toContain("ON DELETE CASCADE");
  });

  it("should render the check expression inside its column's row", () => {
    const { element } = render();
    const usernameRow = queryAll(
      element,
      (candidate) => candidate.properties["data-schema-column"] === "username",
    )[0];
    expect(usernameRow).toBeDefined();
    const check = queryAll(
      usernameRow ?? element,
      (candidate) => candidate.properties["data-schema-check"] !== undefined,
    )[0];
    expect(collectText(check ?? element)).toBe(
      "CHECK (char_length(username) > 4)",
    );
  });

  it("should render the table note in the header band and the index entry", () => {
    const { element } = render();
    const header = queryAll(
      element,
      (candidate) => candidate.tagName === "figcaption",
    )[0];
    const note = queryAll(
      header ?? element,
      (candidate) =>
        candidate.properties["data-schema-table-note"] !== undefined,
    )[0];
    expect(collectText(note ?? element)).toBe(
      "One row per subscription attempt.",
    );
    const index = queryAll(
      element,
      (candidate) => candidate.properties["data-schema-index"] !== undefined,
    )[0];
    const indexText = collectText(index ?? element);
    expect(indexText).toContain("INDX 1");
    expect(indexText).toContain("customer_id, status");
    expect(indexText).toContain("Unique");
    expect(indexText).toContain("WHERE status = live");
  });

  it("should mark participating columns with the band's INDX labels", () => {
    const { element } = render();
    const customerRow = queryAll(
      element,
      (candidate) =>
        candidate.properties["data-schema-column"] === "customer_id",
    )[0];
    const marker = queryAll(
      customerRow ?? element,
      (candidate) => candidate.properties["data-schema-badge"] === "idx",
    )[0];
    expect(collectText(marker ?? element)).toBe("INDX 1");
    const idRow = queryAll(
      element,
      (candidate) => candidate.properties["data-schema-column"] === "id",
    )[0];
    expect(
      queryAll(
        idRow ?? element,
        (candidate) => candidate.properties["data-schema-badge"] === "idx",
      ),
    ).toHaveLength(0);
  });

  it("should give each index definition its own overflow container", () => {
    const { element } = render();
    const definition = queryAll(element, (candidate) =>
      hasClass(candidate, "table-schema-index-definition"),
    )[0];
    // The Indexes band sits outside the grid's scroll container, so a long
    // no-wrap definition must scroll in place instead of widening the page.
    expect(definition).toBeDefined();
    expect(hasClass(definition ?? element, "overflow-x-auto")).toBe(true);
  });

  it("should omit the sections wrapper when no indexes or checks exist", () => {
    const { element } = render({
      children: [fence({ source: "id bigint [pk]\n" })],
    });
    expect(
      queryAll(element, (candidate) =>
        hasClass(candidate, "table-schema-sections"),
      ),
    ).toHaveLength(0);
  });

  it("should carry the raw fence source for the copy control", () => {
    const { element } = render();
    const textarea = queryAll(
      element,
      (candidate) => candidate.properties["data-schema-source"] !== undefined,
    )[0];
    expect(collectText(textarea ?? element)).toBe(SOURCE);
  });
});
