// Renders DatabaseTableSchema's body: the psql-ordered columns grid with key
// badges and per-column detail lines, plus the Indexes and Checks sections.

import type { Element, ElementContent, Text } from "hast";
import type {
  TableColumn,
  TableIndex,
  TableSchema,
} from "./parse-table-schema.js";

const GRID_CLASSES = "table-schema-grid w-full";
const BADGE_CLASSES =
  "table-schema-badge inline-flex shrink-0 items-center rounded-full border px-[0.4rem] py-px align-middle font-sans text-[0.625rem] font-semibold uppercase tracking-wide";
const DETAIL_LINE_CLASSES =
  "table-schema-detail-line m-0 flex flex-wrap items-baseline gap-x-[0.35rem] text-[0.8125rem]";
const SECTION_LABEL_CLASSES =
  "table-schema-section-label m-0 text-xs font-semibold uppercase tracking-wide text-muted";
const SECTION_ITEM_CLASSES =
  "table-schema-section-item m-0 flex flex-wrap items-baseline gap-x-[0.45rem] text-[0.8125rem]";

const text = (value: string): Text => ({ type: "text", value });

const code = (value: string): Element => ({
  type: "element",
  tagName: "code",
  properties: {},
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

const columnBadges = (column: TableColumn): ReadonlyArray<Element> => [
  ...(column.primaryKey ? [badge({ kind: "pk", label: "PK" })] : []),
  ...(column.ref === undefined ? [] : [badge({ kind: "fk", label: "FK" })]),
  ...(column.unique ? [badge({ kind: "unique", label: "Unique" })] : []),
  ...(column.identity ? [badge({ kind: "identity", label: "Identity" })] : []),
];

const referentialActions = (column: TableColumn): string => {
  const actions = [
    ...(column.ref?.onDelete === undefined
      ? []
      : [`on delete ${column.ref.onDelete}`]),
    ...(column.ref?.onUpdate === undefined
      ? []
      : [`on update ${column.ref.onUpdate}`]),
  ];
  return actions.length === 0 ? "" : actions.join(", ");
};

// Foreign-key targets and notes render adjacent to their column as secondary
// lines, the placement psql's trailing constraint sections give up.
const detailLines = (column: TableColumn): ReadonlyArray<Element> => [
  ...(column.ref === undefined
    ? []
    : [
        {
          type: "element" as const,
          tagName: "p",
          properties: {
            className: DETAIL_LINE_CLASSES.split(" "),
            "data-schema-ref": "",
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
            ...(referentialActions(column) === ""
              ? []
              : [
                  {
                    type: "element" as const,
                    tagName: "span",
                    properties: { className: ["text-muted"] },
                    children: [text(referentialActions(column))],
                  },
                ]),
          ],
        },
      ]),
  ...(column.note === undefined
    ? []
    : [
        {
          type: "element" as const,
          tagName: "p",
          properties: {
            className: [...DETAIL_LINE_CLASSES.split(" "), "text-muted"],
            "data-schema-note": "",
          },
          children: [text(column.note)],
        },
      ]),
];

const columnRows = (column: TableColumn): ReadonlyArray<Element> => {
  const details = detailLines(column);
  const nameCell = cell({
    tagName: "th",
    className:
      "table-schema-cell-name font-mono text-[0.8125rem] font-semibold",
    properties: { scope: "row" },
    children: [
      // A cell must stay display: table-cell for grid alignment, so the
      // name/badge flex row lives on an inner span.
      {
        type: "element",
        tagName: "span",
        properties: {
          className: [
            "table-schema-name-line",
            "flex",
            "flex-wrap",
            "items-center",
            "gap-[0.45rem]",
          ],
        },
        children: [text(column.name), ...columnBadges(column)],
      },
    ],
  });
  const row: Element = {
    type: "element",
    tagName: "tr",
    properties: {
      className: ["table-schema-column-row"],
      "data-schema-column": column.name,
      ...(details.length === 0 ? {} : { "data-has-detail": "" }),
    },
    children: [
      nameCell,
      cell({
        tagName: "td",
        className: "table-schema-cell-type font-mono text-[0.8125rem]",
        children: [text(column.type)],
      }),
      cell({
        tagName: "td",
        className: "table-schema-cell-nullable text-[0.8125rem] text-muted",
        children: column.notNull ? [text("not null")] : [],
      }),
      cell({
        tagName: "td",
        className: "table-schema-cell-default font-mono text-[0.8125rem]",
        children:
          column.defaultValue === undefined ? [] : [code(column.defaultValue)],
      }),
    ],
  };
  if (details.length === 0) {
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
          className: "table-schema-cell-detail",
          properties: { colSpan: 4 },
          children: details,
        }),
      ],
    },
  ];
};

/** Renders the semantic columns grid in psql's column order. */
export const renderTableSchemaGrid = ({
  schema,
}: {
  readonly schema: TableSchema;
}): Element => ({
  type: "element",
  tagName: "table",
  properties: { className: GRID_CLASSES.split(" ") },
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
          children: ["Column", "Type", "Nullable", "Default"].map((label) =>
            cell({
              tagName: "th",
              className: "table-schema-head text-xs uppercase tracking-wide",
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
});

// Index entries echo psql's definition lines: the column tuple, then UNIQUE,
// the non-default method, the partial predicate, and the muted name.
const indexItem = (index: TableIndex): Element => ({
  type: "element",
  tagName: "li",
  properties: {
    className: SECTION_ITEM_CLASSES.split(" "),
    "data-schema-index": "",
  },
  children: [
    code(
      index.columns.length === 1
        ? (index.columns[0] ?? "").replaceAll("`", "")
        : `(${index.columns.join(", ")})`,
    ),
    ...(index.unique ? [badge({ kind: "unique", label: "Unique" })] : []),
    ...(index.method === undefined
      ? []
      : [
          {
            type: "element" as const,
            tagName: "span",
            properties: { className: ["text-muted"] },
            children: [text(index.method)],
          },
        ]),
    ...(index.where === undefined ? [] : [code(`WHERE ${index.where}`)]),
    ...(index.name === undefined
      ? []
      : [
          {
            type: "element" as const,
            tagName: "span",
            properties: { className: ["text-muted"] },
            children: [text(index.name)],
          },
        ]),
    ...(index.note === undefined
      ? []
      : [
          {
            type: "element" as const,
            tagName: "span",
            properties: {
              className: ["table-schema-item-note", "w-full", "text-muted"],
            },
            children: [text(index.note)],
          },
        ]),
  ],
});

const checkItem = ({
  columnName,
  check,
}: {
  readonly columnName: string;
  readonly check: string;
}): Element => ({
  type: "element",
  tagName: "li",
  properties: {
    className: SECTION_ITEM_CLASSES.split(" "),
    "data-schema-check": "",
  },
  children: [
    {
      type: "element",
      tagName: "span",
      properties: { className: ["text-muted"] },
      children: [text(`${columnName}:`)],
    },
    code(`CHECK (${check})`),
  ],
});

const section = ({
  label,
  items,
}: {
  readonly label: string;
  readonly items: ReadonlyArray<Element>;
}): Element => ({
  type: "element",
  tagName: "section",
  properties: { className: ["table-schema-section"] },
  children: [
    // A styled paragraph rather than a real heading keeps component chrome
    // out of the document outline the section navigator is built from.
    {
      type: "element",
      tagName: "p",
      properties: { className: SECTION_LABEL_CLASSES.split(" ") },
      children: [text(label)],
    },
    {
      type: "element",
      tagName: "ul",
      properties: { className: ["table-schema-section-list", "m-0", "p-0"] },
      children: [...items],
    },
  ],
});

/** Renders the labeled sections below the grid; absent when empty. */
export const renderTableSchemaSections = ({
  schema,
}: {
  readonly schema: TableSchema;
}): ReadonlyArray<Element> => {
  const checks = schema.columns.filter((column) => column.check !== undefined);
  const sections = [
    ...(schema.indexes.length === 0
      ? []
      : [
          section({
            label: "Indexes",
            items: schema.indexes.map((index) => indexItem(index)),
          }),
        ]),
    ...(checks.length === 0
      ? []
      : [
          section({
            label: "Checks",
            items: checks.map((column) =>
              checkItem({
                columnName: column.name,
                check: column.check ?? "",
              }),
            ),
          }),
        ]),
  ];
  if (sections.length === 0) {
    return [];
  }
  return [
    {
      type: "element",
      tagName: "div",
      properties: {
        className: [
          "table-schema-sections",
          "flex",
          "flex-col",
          "gap-3",
          "border-t",
          "border-edge",
          "px-[0.9rem]",
          "py-[0.6rem]",
        ],
      },
      children: sections,
    },
  ];
};
