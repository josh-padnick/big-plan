// Renders DatabaseTableSchema's body: an equal-height columns grid whose
// Constraints cell carries keys, nullability, foreign keys, checks, and
// numbered INDX references in one separated inline run, a Comment column in
// the psql \d+ tradition, and the tinted numbered Indexes band below.

import type { Element, ElementContent, Text } from "hast";
import { indexParticipation } from "./derive-index-participation.js";
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

const indxLabel = (position: number): string => `INDX ${position}`;

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
const constraintsCell = (
  column: TableColumn,
  markers: ReadonlyArray<ElementContent>,
): Element => {
  const base: ReadonlyArray<ElementContent> = [
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
          // Actions read in SQL voice but stay muted: they qualify the
          // relationship rather than define it.
          ...(column.ref.onDelete === undefined
            ? []
            : [
                code(`ON DELETE ${column.ref.onDelete.toUpperCase()}`, {
                  className: ["text-muted"],
                }),
              ]),
          ...(column.ref.onUpdate === undefined
            ? []
            : [
                code(`ON UPDATE ${column.ref.onUpdate.toUpperCase()}`, {
                  className: ["text-muted"],
                }),
              ]),
        ];
  const checkItems: ReadonlyArray<ElementContent> =
    column.check === undefined
      ? []
      : [code(`CHECK (${column.check})`, { "data-schema-check": "" })];
  const itemCount =
    base.length + fkItems.length + checkItems.length + markers.length;
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
          ...base.map((item) => group(item)),
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
          ...markers.map((item) => group(item)),
        ],
      },
    ],
  });
};

// Key participation renders as an INDX pill matching the band below;
// predicate-only participation is marked "WHERE INDX n" because the column
// shapes the index without being indexed by it.
const indexMarkers = (
  column: TableColumn,
  indexes: ReadonlyArray<TableIndex>,
): ReadonlyArray<ElementContent> =>
  indexParticipation({ column, indexes }).map(({ position, kind }) =>
    kind === "key"
      ? badge({ kind: "idx", label: indxLabel(position) })
      : muted(`WHERE ${indxLabel(position)}`),
  );

// One row per column, always: comments live in their own grid column so a
// commented column never grows taller than its neighbors.
const columnRow = (
  column: TableColumn,
  indexes: ReadonlyArray<TableIndex>,
): Element => ({
  type: "element",
  tagName: "tr",
  properties: {
    className: ["table-schema-column-row"],
    "data-schema-column": column.name,
  },
  children: [
    cell({
      tagName: "th",
      // Semibold matches the index names in the band: both are the
      // identifier the reader scans for.
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
    constraintsCell(column, indexMarkers(column, indexes)),
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
          children: schema.columns.map((column) =>
            columnRow(column, schema.indexes),
          ),
        },
      ],
    },
  ],
});

// One band entry per index: the INDX pill leads a content column holding the
// strong name and its demoted definition and note, so everything under a name
// left-aligns with the name itself whatever width the pill takes.
const indexEntry = (index: TableIndex, offset: number): Element => ({
  type: "element",
  tagName: "li",
  properties: {
    className: [
      "m-0",
      "flex",
      "items-baseline",
      "gap-[0.45rem]",
      "px-[0.75rem]",
      "py-[0.5rem]",
      ...(offset === 0 ? [] : ["border-t", "border-edge"]),
    ],
    "data-schema-index": "",
  },
  children: [
    badge({ kind: "idx", label: indxLabel(offset + 1) }),
    {
      type: "element",
      tagName: "span",
      properties: { className: ["min-w-0", "flex-1"] },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: ["flex", "flex-wrap", "items-center", "gap-[0.45rem]"],
          },
          children: [
            {
              type: "element",
              tagName: "span",
              properties: {
                className: [
                  "table-schema-index-name",
                  "font-mono",
                  "text-[0.8125rem]",
                  "font-semibold",
                  "text-ink",
                ],
              },
              children: [text(index.name ?? "(unnamed)")],
            },
            ...(index.unique
              ? [badge({ kind: "unique", label: "Unique" })]
              : []),
          ],
        },
        {
          type: "element",
          tagName: "span",
          properties: {
            // The band sits outside the grid's scroll container, so each
            // definition line owns its overflow instead of widening the page.
            className: [
              "table-schema-index-definition",
              "block",
              "overflow-x-auto",
              "text-xs",
              "text-muted",
            ],
          },
          children: [
            ...separated([
              code(
                index.columns
                  .map((column) => column.replaceAll("`", ""))
                  .join(", "),
              ),
              ...(index.method === undefined ? [] : [muted(index.method)]),
              ...(index.where === undefined
                ? []
                : [code(`WHERE ${index.where}`)]),
            ]),
          ],
        },
        ...(index.note === undefined
          ? []
          : [
              {
                type: "element" as const,
                tagName: "span",
                properties: {
                  className: ["block", "text-xs", "leading-snug", "text-muted"],
                },
                children: [text(index.note)],
              },
            ]),
      ],
    },
  ],
});

/** Renders the numbered Indexes band below the grid; absent without indexes. */
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
            className: [
              ...SECTION_LABEL_CLASSES.split(" "),
              "px-[0.75rem]",
              "mb-[0.1rem]",
            ],
          },
          children: [text("Indexes")],
        },
        {
          type: "element",
          tagName: "ul",
          properties: {
            className: [
              "table-schema-index-list",
              "m-0",
              "flex",
              "flex-col",
              "p-0",
              "pb-[0.15rem]",
              "list-none",
            ],
          },
          children: schema.indexes.map((index, offset) =>
            indexEntry(index, offset),
          ),
        },
      ],
    },
  ];
};
