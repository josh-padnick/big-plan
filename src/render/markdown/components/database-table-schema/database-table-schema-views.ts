// Renders DatabaseTableSchema's body: a dense columns grid whose Constraints
// cell carries key badges, nullability, foreign keys, and checks beside their
// column, plus the structured Indexes section below it.

import type { Element, ElementContent, Text } from "hast";
import type {
  TableColumn,
  TableIndex,
  TableSchema,
} from "./parse-table-schema.js";

const BADGE_CLASSES =
  "table-schema-badge inline-flex shrink-0 items-center rounded-full border px-[0.4rem] py-px font-sans text-[0.625rem] font-semibold uppercase tracking-wide";
const CONSTRAINT_LINE_CLASSES =
  "table-schema-constraints flex flex-wrap items-center gap-x-[0.45rem] gap-y-[0.2rem]";
const SECTION_LABEL_CLASSES =
  "table-schema-section-label m-0 text-[0.6875rem] font-medium uppercase tracking-wide text-muted";
const SECTION_ITEM_CLASSES =
  "table-schema-section-item m-0 flex flex-wrap items-baseline gap-x-[0.55rem] gap-y-[0.1rem] text-[0.8125rem]";

const text = (value: string): Text => ({ type: "text", value });

const code = (
  value: string,
  properties: Element["properties"] = {},
): Element => ({
  type: "element",
  tagName: "code",
  properties,
  children: [text(value)],
});

const muted = (value: string): Element => ({
  type: "element",
  tagName: "span",
  properties: { className: ["text-muted"] },
  children: [text(value)],
});

const badge = ({
  kind,
  label,
}: {
  readonly kind: string;
  readonly label: string;
}): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: BADGE_CLASSES.split(" "),
    "data-schema-badge": kind,
  },
  children: [text(label)],
});

const cell = ({
  tagName,
  className,
  children,
  properties = {},
}: {
  readonly tagName: "th" | "td";
  readonly className: string;
  readonly children: ReadonlyArray<ElementContent>;
  readonly properties?: Element["properties"];
}): Element => ({
  type: "element",
  tagName,
  properties: { ...properties, className: className.split(" ") },
  children: [...children],
});

// SQL fragments render in uppercase SQL voice as code, while semantic
// classifications (keys, identity, uniqueness) stay badges.
const referentialActionFragments = (
  column: TableColumn,
): ReadonlyArray<Element> => [
  ...(column.ref?.onDelete === undefined
    ? []
    : [code(`ON DELETE ${column.ref.onDelete.toUpperCase()}`)]),
  ...(column.ref?.onUpdate === undefined
    ? []
    : [code(`ON UPDATE ${column.ref.onUpdate.toUpperCase()}`)]),
];

// The one Constraints cell answers "what rules apply to this column": key
// badges first, then nullability, then the foreign key with its actions,
// then the check expression, all beside the column they govern.
const constraintsCell = (column: TableColumn): Element => {
  const fkParts: ReadonlyArray<Element> =
    column.ref === undefined
      ? []
      : [
          {
            type: "element",
            tagName: "span",
            properties: {
              className: [
                ...CONSTRAINT_LINE_CLASSES.split(" "),
                "table-schema-ref",
              ],
              "data-schema-ref": "",
            },
            children: [
              badge({ kind: "fk", label: "FK" }),
              // The arrow and its target wrap as one unit so a narrow
              // Constraints cell never strands the arrow on its own line.
              {
                type: "element",
                tagName: "span",
                properties: {
                  className: [
                    "table-schema-ref-target",
                    "inline-flex",
                    "items-center",
                    "gap-[0.35rem]",
                    "whitespace-nowrap",
                  ],
                },
                children: [
                  {
                    type: "element" as const,
                    tagName: "span",
                    properties: {
                      className: ["table-schema-ref-arrow", "text-muted"],
                      ariaHidden: "true",
                    },
                    children: [text("→")],
                  },
                  code(column.ref.target),
                ],
              },
              ...referentialActionFragments(column),
            ],
          },
        ];
  return cell({
    tagName: "td",
    className: "table-schema-cell-constraints text-[0.8125rem]",
    children: [
      {
        type: "element",
        tagName: "span",
        properties: { className: CONSTRAINT_LINE_CLASSES.split(" ") },
        children: [
          ...(column.primaryKey ? [badge({ kind: "pk", label: "PK" })] : []),
          ...(column.identity
            ? [badge({ kind: "identity", label: "Identity" })]
            : []),
          ...(column.unique
            ? [badge({ kind: "unique", label: "Unique" })]
            : []),
          ...(column.notNull ? [muted("not null")] : []),
          ...fkParts,
          ...(column.check === undefined
            ? []
            : [
                code(`CHECK (${column.check})`, {
                  "data-schema-check": "",
                }),
              ]),
        ],
      },
    ],
  });
};

const columnRows = (column: TableColumn): ReadonlyArray<Element> => {
  const row: Element = {
    type: "element",
    tagName: "tr",
    properties: {
      className: ["table-schema-column-row"],
      "data-schema-column": column.name,
      ...(column.note === undefined ? {} : { "data-has-detail": "" }),
    },
    children: [
      cell({
        tagName: "th",
        className:
          "table-schema-cell-name font-mono text-[0.8125rem] font-semibold",
        properties: { scope: "row" },
        children: [text(column.name)],
      }),
      cell({
        tagName: "td",
        className: "table-schema-cell-type font-mono text-[0.8125rem]",
        children: [text(column.type)],
      }),
      constraintsCell(column),
      cell({
        tagName: "td",
        className: "table-schema-cell-default font-mono text-[0.8125rem]",
        children:
          column.defaultValue === undefined ? [] : [code(column.defaultValue)],
      }),
    ],
  };
  if (column.note === undefined) {
    return [row];
  }
  return [
    row,
    {
      type: "element",
      tagName: "tr",
      properties: { className: ["table-schema-detail-row"] },
      children: [
        cell({
          tagName: "td",
          className: "table-schema-cell-detail text-xs text-muted",
          properties: { colSpan: 4 },
          children: [
            {
              type: "element",
              tagName: "p",
              properties: {
                className: ["table-schema-detail-line", "m-0"],
                "data-schema-note": "",
              },
              children: [text(column.note)],
            },
          ],
        }),
      ],
    },
  ];
};

/** Renders the columns grid inside its own figure-styled scroll container. */
export const renderTableSchemaGrid = ({
  schema,
}: {
  readonly schema: TableSchema;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    // Emitting the document-wide scroll-container contract here keeps the
    // global table transform from adding a second, chrome-bearing wrapper.
    className: ["table-schema-scroll", "min-w-0", "overflow-x-auto"],
    "data-table-scroll-container": "",
  },
  children: [
    {
      type: "element",
      tagName: "table",
      properties: { className: ["table-schema-grid", "w-full"] },
      children: [
        {
          type: "element",
          tagName: "thead",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "tr",
              properties: {},
              children: ["Column", "Type", "Constraints", "Default"].map(
                (label) =>
                  cell({
                    tagName: "th",
                    className: `table-schema-head table-schema-head-${label.toLowerCase()} text-[0.6875rem] uppercase tracking-wide`,
                    properties: { scope: "col" },
                    children: [text(label)],
                  }),
              ),
            },
          ],
        },
        {
          type: "element",
          tagName: "tbody",
          properties: {},
          children: schema.columns.flatMap((column) => columnRows(column)),
        },
      ],
    },
  ],
});

// One row per index: a leading kind label, the column list and predicate in
// SQL voice, the muted index name, and the invariant note on its own line.
const indexItem = (index: TableIndex): Element => ({
  type: "element",
  tagName: "li",
  properties: {
    className: SECTION_ITEM_CLASSES.split(" "),
    "data-schema-index": "",
  },
  children: [
    index.unique
      ? badge({ kind: "unique", label: "Unique" })
      : {
          type: "element",
          tagName: "span",
          properties: {
            className: [
              "table-schema-index-kind",
              "font-sans",
              "text-[0.625rem]",
              "font-semibold",
              "uppercase",
              "tracking-wide",
              "text-muted",
            ],
          },
          children: [text("Index")],
        },
    code(index.columns.map((column) => column.replaceAll("`", "")).join(", ")),
    ...(index.method === undefined ? [] : [muted(index.method)]),
    ...(index.where === undefined ? [] : [code(`WHERE ${index.where}`)]),
    ...(index.name === undefined ? [] : [muted(index.name)]),
    ...(index.note === undefined
      ? []
      : [
          {
            type: "element" as const,
            tagName: "span",
            properties: {
              className: [
                "table-schema-item-note",
                "w-full",
                "text-xs",
                "text-muted",
              ],
            },
            children: [text(index.note)],
          },
        ]),
  ],
});

/** Renders the Indexes section below the grid; absent when no indexes exist. */
export const renderTableSchemaSections = ({
  schema,
}: {
  readonly schema: TableSchema;
}): ReadonlyArray<Element> => {
  if (schema.indexes.length === 0) {
    return [];
  }
  return [
    {
      type: "element",
      tagName: "section",
      properties: {
        className: [
          "table-schema-section",
          "border-t",
          "border-edge",
          "px-[0.9rem]",
          "py-[0.5rem]",
        ],
      },
      children: [
        // A styled paragraph rather than a real heading keeps component
        // chrome out of the document outline the section navigator uses.
        {
          type: "element",
          tagName: "p",
          properties: { className: SECTION_LABEL_CLASSES.split(" ") },
          children: [text("Indexes")],
        },
        {
          type: "element",
          tagName: "ul",
          properties: {
            className: [
              "table-schema-section-list",
              "m-0",
              "flex",
              "flex-col",
              "gap-[0.3rem]",
              "p-0",
            ],
          },
          children: schema.indexes.map((index) => indexItem(index)),
        },
      ],
    },
  ];
};
