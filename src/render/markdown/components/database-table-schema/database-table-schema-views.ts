// Renders DatabaseTableSchema's body: an equal-height columns grid whose
// Constraints cell carries keys, nullability, foreign keys, and checks in one
// separated inline run, a Comment column in the psql \d+ tradition, and the
// tinted name-first Indexes band below.

import type { Element, ElementContent, Text } from "hast";
import type {
  TableColumn,
  TableIndex,
  TableSchema,
} from "./parse-table-schema.js";

const BADGE_CLASSES =
  "table-schema-badge inline-flex shrink-0 items-center rounded-full border px-[0.4rem] py-px align-middle font-sans text-[0.625rem] font-semibold uppercase tracking-wide";
const SECTION_LABEL_CLASSES =
  "table-schema-section-label m-0 text-[0.6875rem] font-medium uppercase tracking-wider text-muted";

const GRID_HEADS: ReadonlyArray<{
  readonly label: string;
  readonly key: string;
}> = [
  { label: "Column", key: "column" },
  { label: "Type", key: "type" },
  { label: "Constraints", key: "constraints" },
  { label: "Default", key: "default" },
  { label: "Comment", key: "comment" },
];

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

// Interpunct separators give each constraint a visible boundary; the run is
// ordinary inline flow so a wrapped line never starts with a separator.
const separated = (
  items: ReadonlyArray<ElementContent>,
): ReadonlyArray<ElementContent> =>
  items.flatMap((item, index) => (index === 0 ? [item] : [muted(" · "), item]));

// The badge, arrow, and target wrap as one unit so a narrow cell never
// strands the arrow or the badge on its own line.
const foreignKeyTarget = (target: string): Element => ({
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
    badge({ kind: "fk", label: "FK" }),
    {
      type: "element",
      tagName: "span",
      properties: {
        className: ["table-schema-ref-arrow", "text-muted"],
        ariaHidden: "true",
      },
      children: [text("→")],
    },
    code(target),
  ],
});

// Each constraint becomes one atomic flex item carrying its own trailing
// separator, so wrapping a narrow cell can never strand an interpunct at the
// start of a line; at full width the run reads as a single separated line.
const constraintGroup = ({
  item,
  trailingSeparator,
}: {
  readonly item: ElementContent;
  readonly trailingSeparator: boolean;
}): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: [
      "table-schema-constraint",
      "inline-flex",
      "items-center",
      "gap-x-[0.45rem]",
      "whitespace-nowrap",
    ],
  },
  children: [item, ...(trailingSeparator ? [muted("·")] : [])],
});

// The one Constraints cell answers "what rules apply to this column"; every
// column states its nullability explicitly so a reader never infers it.
const constraintsCell = (column: TableColumn): Element => {
  const markers: ReadonlyArray<ElementContent> = [
    ...(column.primaryKey ? [badge({ kind: "pk", label: "PK" })] : []),
    ...(column.identity
      ? [badge({ kind: "identity", label: "Identity" })]
      : []),
    ...(column.unique ? [badge({ kind: "unique", label: "Unique" })] : []),
    muted(column.notNull ? "not null" : "nullable"),
  ];
  const fkItems: ReadonlyArray<ElementContent> =
    column.ref === undefined
      ? []
      : [
          foreignKeyTarget(column.ref.target),
          ...(column.ref.onDelete === undefined
            ? []
            : [code(`ON DELETE ${column.ref.onDelete.toUpperCase()}`)]),
          ...(column.ref.onUpdate === undefined
            ? []
            : [code(`ON UPDATE ${column.ref.onUpdate.toUpperCase()}`)]),
        ];
  const checkItems: ReadonlyArray<ElementContent> =
    column.check === undefined
      ? []
      : [code(`CHECK (${column.check})`, { "data-schema-check": "" })];
  const itemCount = markers.length + fkItems.length + checkItems.length;
  let position = 0;
  const group = (item: ElementContent): Element => {
    position += 1;
    return constraintGroup({ item, trailingSeparator: position < itemCount });
  };
  return cell({
    tagName: "td",
    className: "table-schema-cell-constraints text-[0.8125rem]",
    children: [
      {
        type: "element",
        tagName: "span",
        properties: {
          className: [
            "table-schema-constraints",
            "flex",
            "flex-wrap",
            "items-center",
            "gap-x-[0.45rem]",
            "gap-y-[0.2rem]",
          ],
        },
        children: [
          ...markers.map((item) => group(item)),
          // display: contents keeps the ref wrapper addressable for tests
          // and scripts while its groups participate in the cell's flex run.
          ...(fkItems.length === 0
            ? []
            : [
                {
                  type: "element" as const,
                  tagName: "span",
                  properties: {
                    className: ["contents"],
                    "data-schema-ref": "",
                  },
                  children: fkItems.map((item) => group(item)),
                },
              ]),
          ...checkItems.map((item) => group(item)),
        ],
      },
    ],
  });
};

// One row per column, always: comments live in their own grid column so a
// commented column never grows taller than its neighbors.
const columnRow = (column: TableColumn): Element => ({
  type: "element",
  tagName: "tr",
  properties: {
    className: ["table-schema-column-row"],
    "data-schema-column": column.name,
  },
  children: [
    cell({
      tagName: "th",
      className:
        "table-schema-cell-name font-mono text-[0.8125rem] font-medium",
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
    cell({
      tagName: "td",
      className: "table-schema-cell-comment text-xs leading-snug text-muted",
      children:
        column.note === undefined
          ? []
          : [
              {
                type: "element",
                tagName: "span",
                properties: { "data-schema-note": "" },
                children: [text(column.note)],
              },
            ],
    }),
  ],
});

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
              children: GRID_HEADS.map(({ label, key }) =>
                cell({
                  tagName: "th",
                  className: `table-schema-head table-schema-head-${key} text-[0.625rem] uppercase tracking-wider`,
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
          children: schema.columns.map((column) => columnRow(column)),
        },
      ],
    },
  ],
});

const INDEX_HEADS: ReadonlyArray<{
  readonly label: string;
  readonly key: string;
}> = [
  { label: "Index", key: "index" },
  { label: "Columns", key: "columns" },
  { label: "Properties", key: "properties" },
  { label: "Comment", key: "comment" },
];

// One equal-rhythm row per index, mirroring the columns grid: the name
// engineers reference, the column list, the properties run in SQL voice, and
// the invariant note in its own Comment cell.
const indexRow = (index: TableIndex): Element => ({
  type: "element",
  tagName: "tr",
  properties: {
    className: ["table-schema-index-row"],
    "data-schema-index": "",
  },
  children: [
    cell({
      tagName: "th",
      className:
        "table-schema-cell-index-name font-mono text-[0.8125rem] font-medium",
      properties: { scope: "row" },
      children: index.name === undefined ? [] : [text(index.name)],
    }),
    cell({
      tagName: "td",
      className: "table-schema-cell-index-columns font-mono text-[0.8125rem]",
      children: [
        code(
          index.columns.map((column) => column.replaceAll("`", "")).join(", "),
        ),
      ],
    }),
    cell({
      tagName: "td",
      className: "table-schema-cell-index-properties text-[0.8125rem]",
      children: separated([
        ...(index.unique ? [badge({ kind: "unique", label: "Unique" })] : []),
        ...(index.method === undefined ? [] : [muted(index.method)]),
        ...(index.where === undefined ? [] : [code(`WHERE ${index.where}`)]),
      ]),
    }),
    cell({
      tagName: "td",
      className: "table-schema-cell-comment text-xs leading-snug text-muted",
      children: index.note === undefined ? [] : [text(index.note)],
    }),
  ],
});

/** Renders the tinted Indexes table below the grid; absent without indexes. */
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
          "pt-[0.55rem]",
        ],
      },
      children: [
        // A styled paragraph rather than a real heading keeps component
        // chrome out of the document outline the section navigator uses.
        {
          type: "element",
          tagName: "p",
          properties: {
            className: [...SECTION_LABEL_CLASSES.split(" "), "px-[0.75rem]"],
          },
          children: [text("Indexes")],
        },
        {
          type: "element",
          tagName: "div",
          properties: {
            // The same scroll-container contract as the columns grid, so the
            // global table transform never adds its own wrapper here either.
            className: ["table-schema-scroll", "min-w-0", "overflow-x-auto"],
            "data-table-scroll-container": "",
          },
          children: [
            {
              type: "element",
              tagName: "table",
              properties: {
                className: [
                  "table-schema-grid",
                  "table-schema-index-grid",
                  "w-full",
                ],
              },
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
                      children: INDEX_HEADS.map(({ label, key }) =>
                        cell({
                          tagName: "th",
                          className: `table-schema-head table-schema-head-${key} text-[0.625rem] uppercase tracking-wider`,
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
                  children: schema.indexes.map((index) => indexRow(index)),
                },
              ],
            },
          ],
        },
      ],
    },
  ];
};
