// Renders DatabaseTableSchema's equal-height columns grid, constraints,
// numbered index references, indexes, and titled verbatim-DDL bands.

import type { ReactNode } from "react";
import type { CompiledDdlSection } from "./compile.js";
import { indexParticipation } from "./derive-index-participation.js";
import type {
  TableColumn,
  TableIndex,
  TableSchema,
} from "./parse-table-schema.js";
import { GRIP_VERTICAL_ICON } from "../../icons/lucide/grip-vertical.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import { MutedText, SchemaCell, SchemaCode } from "./view-elements.js";

// Shared by every pill in the grid and the bands below it.
const BADGE_CLASSES =
  "table-schema-badge inline-flex shrink-0 items-center rounded-full border border-edge px-[0.4rem] py-px align-middle font-sans text-[0.625rem] font-semibold tracking-wide text-muted uppercase data-[schema-badge=pk]:border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] data-[schema-badge=pk]:text-accent";
const SECTION_LABEL_CLASSES = {
  ddl: "table-schema-section-label m-0 text-[0.6875rem] font-medium uppercase tracking-wider text-muted px-[0.75rem] mb-[0.1rem] flex items-center gap-1.5",
  indexes:
    "table-schema-section-label m-0 text-[0.6875rem] font-medium uppercase tracking-wider text-muted px-[0.75rem] mb-[0.1rem]",
} as const;

const SectionLabel = ({
  variant,
  children,
}: {
  readonly variant: keyof typeof SECTION_LABEL_CLASSES;
  readonly children: ReactNode;
}) => <p className={SECTION_LABEL_CLASSES[variant]}>{children}</p>;

const GRID_HEADS: ReadonlyArray<{
  readonly label: string;
  readonly key: string;
  readonly className: string;
}> = [
  {
    label: "Column",
    key: "column",
    className:
      "table-schema-head table-schema-head-column text-[0.625rem] uppercase tracking-wider",
  },
  {
    label: "Type",
    key: "type",
    className:
      "table-schema-head table-schema-head-type text-[0.625rem] uppercase tracking-wider",
  },
  {
    label: "Constraints",
    key: "constraints",
    className:
      "table-schema-head table-schema-head-constraints text-[0.625rem] uppercase tracking-wider",
  },
  {
    label: "Default",
    key: "default",
    className:
      "table-schema-head table-schema-head-default text-[0.625rem] uppercase tracking-wider",
  },
  {
    label: "Comment",
    key: "comment",
    className:
      "table-schema-head table-schema-head-comment text-[0.625rem] uppercase tracking-wider",
  },
];

const indxLabel = (position: number): string => `INDX ${position}`;

const Badge = ({
  kind,
  label,
  indxPosition,
}: {
  readonly kind: string;
  readonly label: string;
  readonly indxPosition?: number;
}) => (
  <span
    className={BADGE_CLASSES}
    data-schema-badge={kind}
    {...(indxPosition === undefined
      ? {}
      : { "data-schema-indx": String(indxPosition) })}
  >
    {label}
  </span>
);

// Interpunct separators give each constraint a visible boundary; the run is
// ordinary inline flow so a wrapped line never starts with a separator.
const separated = (items: ReadonlyArray<ReactNode>): ReadonlyArray<ReactNode> =>
  items.flatMap((item, index) =>
    index === 0
      ? [item]
      : [<MutedText key={`sep-${index}`}>{" · "}</MutedText>, item],
  );

// The badge, arrow, and target wrap as one unit so a narrow cell never
// strands the arrow or the badge on its own line.
const ForeignKeyTarget = ({ target }: { readonly target: string }) => (
  <span className="table-schema-ref-target inline-flex items-center gap-[0.35rem] whitespace-nowrap">
    <Badge kind="fk" label="FK" />
    <MutedText variant="refArrow" aria-hidden="true">
      {"→"}
    </MutedText>
    <SchemaCode>{target}</SchemaCode>
  </span>
);

// Each constraint becomes one atomic flex item carrying its own trailing
// separator, so wrapping a narrow cell can never strand an interpunct at the
// start of a line; at full width the run reads as a single separated line.
const ConstraintGroup = ({
  item,
  trailingSeparator,
}: {
  readonly item: ReactNode;
  readonly trailingSeparator: boolean;
}) => (
  <span className="table-schema-constraint inline-flex items-center gap-x-[0.45rem] whitespace-nowrap">
    {item}
    {trailingSeparator ? <MutedText>{"·"}</MutedText> : null}
  </span>
);

// Key participation renders as an INDX pill matching the band below;
// predicate-only participation is marked "WHERE INDX n" because the column
// shapes the index without being indexed by it.
const indexMarkers = (
  column: TableColumn,
  indexes: ReadonlyArray<TableIndex>,
): ReadonlyArray<ReactNode> =>
  indexParticipation({ column, indexes }).map(({ position, kind }) =>
    kind === "key" ? (
      <Badge
        key={`indx-${position}`}
        kind="idx"
        label={indxLabel(position)}
        indxPosition={position}
      />
    ) : (
      <MutedText key={`indx-${position}`} data-schema-indx={String(position)}>
        {`WHERE ${indxLabel(position)}`}
      </MutedText>
    ),
  );

// The one Constraints cell answers "what rules apply to this column"; every
// column states its nullability explicitly so a reader never infers it.
const ConstraintsCell = ({
  column,
  markers,
}: {
  readonly column: TableColumn;
  readonly markers: ReadonlyArray<ReactNode>;
}) => {
  const base: ReadonlyArray<ReactNode> = [
    ...(column.primaryKey ? [<Badge key="pk" kind="pk" label="PK" />] : []),
    ...(column.identity
      ? [<Badge key="identity" kind="identity" label="Identity" />]
      : []),
    ...(column.unique
      ? [<Badge key="unique" kind="unique" label="Unique" />]
      : []),
    <MutedText key="nullability">
      {column.notNull ? "not null" : "nullable"}
    </MutedText>,
  ];
  const fkItems: ReadonlyArray<ReactNode> =
    column.ref === undefined
      ? []
      : [
          <ForeignKeyTarget key="fk" target={column.ref.target} />,
          // Actions read in SQL voice but stay muted: they qualify the
          // relationship rather than define it.
          ...(column.ref.onDelete === undefined
            ? []
            : [
                <SchemaCode key="on-delete" tone="muted">
                  {`ON DELETE ${column.ref.onDelete.toUpperCase()}`}
                </SchemaCode>,
              ]),
          ...(column.ref.onUpdate === undefined
            ? []
            : [
                <SchemaCode key="on-update" tone="muted">
                  {`ON UPDATE ${column.ref.onUpdate.toUpperCase()}`}
                </SchemaCode>,
              ]),
        ];
  const checkItems: ReadonlyArray<ReactNode> =
    column.check === undefined
      ? []
      : [
          <SchemaCode key="check" data-schema-check="">
            {`CHECK (${column.check})`}
          </SchemaCode>,
        ];
  const itemCount =
    base.length + fkItems.length + checkItems.length + markers.length;
  let position = 0;
  const group = (item: ReactNode, key: number): ReactNode => {
    position += 1;
    return (
      <ConstraintGroup
        key={`group-${key}`}
        item={item}
        trailingSeparator={position < itemCount}
      />
    );
  };
  return (
    <SchemaCell variant="constraints">
      <span className="table-schema-constraints flex flex-wrap items-center gap-x-[0.45rem] gap-y-[0.2rem]">
        {base.map((item, index) => group(item, index))}
        {/* display: contents keeps the ref wrapper addressable while its
            groups participate in the cell's flex run. */}
        {fkItems.length === 0 ? null : (
          <span className="contents" data-schema-ref="">
            {fkItems.map((item, index) => group(item, 100 + index))}
          </span>
        )}
        {checkItems.map((item, index) => group(item, 200 + index))}
        {markers.map((item, index) => group(item, 300 + index))}
      </span>
    </SchemaCell>
  );
};

// One row per column, always: comments live in their own grid column so a
// commented column never grows taller than its neighbors.
const ColumnRow = ({
  column,
  indexes,
}: {
  readonly column: TableColumn;
  readonly indexes: ReadonlyArray<TableIndex>;
}) => (
  <tr className="table-schema-column-row" data-schema-column={column.name}>
    {/* Semibold matches the index names in the band: both are the
        identifier the reader scans for. */}
    <SchemaCell variant="name">{column.name}</SchemaCell>
    <SchemaCell variant="type">{column.type}</SchemaCell>
    <ConstraintsCell column={column} markers={indexMarkers(column, indexes)} />
    <SchemaCell variant="default">
      {column.defaultValue === undefined ? null : (
        <SchemaCode>{column.defaultValue}</SchemaCode>
      )}
    </SchemaCell>
    <SchemaCell variant="comment">
      {column.note === undefined ? null : (
        <span data-schema-note="">{column.note}</span>
      )}
    </SchemaCell>
  </tr>
);

/** Renders the columns grid inside its own figure-styled scroll container. */
export const TableSchemaGrid = ({
  schema,
}: {
  readonly schema: TableSchema;
}) => (
  <div
    // Emitting the document-wide scroll-container contract here keeps the
    // global table transform from adding a second, chrome-bearing wrapper.
    className="table-schema-scroll min-w-0 overflow-x-auto"
    data-table-scroll-container=""
  >
    <table className="table-schema-grid w-full border-collapse">
      <thead>
        <tr>
          {GRID_HEADS.map(({ label, key, className }) => (
            <th key={key} scope="col" className={className}>
              {/* The gripper ships hidden for the live review application. */}
              {label}
              {lucideIconToReact({ icon: GRIP_VERTICAL_ICON, hidden: true })}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {schema.columns.map((column) => (
          <ColumnRow
            key={column.name}
            column={column}
            indexes={schema.indexes}
          />
        ))}
      </tbody>
    </table>
  </div>
);

// One band entry per index: the INDX pill leads a content column holding the
// strong name and its demoted definition and note, so everything under a name
// left-aligns with the name itself whatever width the pill takes.
const INDEX_ENTRY_CLASSES = {
  first: "m-0 flex items-baseline gap-[0.45rem] px-[0.75rem] py-[0.5rem]",
  divided:
    "m-0 flex items-baseline gap-[0.45rem] px-[0.75rem] py-[0.5rem] border-t border-edge",
} as const;

const IndexEntry = ({
  index,
  offset,
}: {
  readonly index: TableIndex;
  readonly offset: number;
}) => (
  <li
    className={INDEX_ENTRY_CLASSES[offset === 0 ? "first" : "divided"]}
    data-schema-index={String(offset + 1)}
  >
    <Badge kind="idx" label={indxLabel(offset + 1)} />
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-[0.45rem]">
        <span className="table-schema-index-name font-mono text-[0.8125rem] font-semibold text-ink">
          {index.name ?? "(unnamed)"}
        </span>
        {index.unique ? <Badge kind="unique" label="Unique" /> : null}
      </span>
      <MutedText
        variant="indexDefinition"
        // The band sits outside the grid's scroll container, so each
        // definition line owns its overflow instead of widening the page.
      >
        {separated([
          <SchemaCode key="columns">
            {index.columns
              .map((column) => column.replaceAll("`", ""))
              .join(", ")}
          </SchemaCode>,
          ...(index.method === undefined
            ? []
            : [<MutedText key="method">{index.method}</MutedText>]),
          ...(index.where === undefined
            ? []
            : [<SchemaCode key="where">{`WHERE ${index.where}`}</SchemaCode>]),
        ])}
      </MutedText>
      {index.note === undefined ? null : (
        <MutedText variant="note">{index.note}</MutedText>
      )}
    </span>
  </li>
);

// One titled verbatim-DDL band: the label mirrors the Indexes band so the live
// application can treat every section uniformly, and the fence children pass
// through untouched for downstream highlighting.
const DdlSection = ({ section }: { readonly section: CompiledDdlSection }) => (
  <section
    className="table-schema-section border-t border-edge bg-surface pt-[0.55rem]"
    data-schema-section="ddl"
    data-schema-ddl-title={section.title}
  >
    {/* The badge marks the band as verbatim DDL in both the inert stack and
        the live application's tab. */}
    <SectionLabel variant="ddl">
      {section.title}
      <Badge kind="ddl" label="DDL" />
    </SectionLabel>
    <div className="table-schema-ddl-body min-w-0 px-[0.75rem] pb-[0.6rem] [&>:last-child]:mb-0">
      {hastContentToReact(section.children)}
    </div>
  </section>
);

/** Renders the Indexes and DDL bands below the grid; absent without either. */
export const TableSchemaSections = ({
  schema,
  ddlSections = [],
}: {
  readonly schema: TableSchema;
  readonly ddlSections?: ReadonlyArray<CompiledDdlSection>;
}) => (
  <>
    {schema.indexes.length === 0 ? null : (
      <section
        className="table-schema-section border-t border-edge bg-surface pt-[0.55rem]"
        data-schema-section="indexes"
      >
        {/* A styled paragraph rather than a real heading keeps component
            chrome out of the document outline the section navigator uses. */}
        <SectionLabel variant="indexes">{"Indexes"}</SectionLabel>
        <ul className="table-schema-index-list m-0 flex flex-col p-0 pb-[0.15rem] list-none">
          {schema.indexes.map((index, offset) => (
            <IndexEntry key={offset} index={index} offset={offset} />
          ))}
        </ul>
      </section>
    )}
    {ddlSections.map((section) => (
      <DdlSection key={section.title} section={section} />
    ))}
  </>
);
