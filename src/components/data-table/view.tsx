// Renders DataTable: the complete grid plus the chrome the viewer script
// activates. Every row and column is server-rendered in authored order, so a
// document with scripts disabled loses no content and shows no dead control.

import { ARROW_DOWN_ICON } from "../../icons/lucide/arrow-down.js";
import { ARROW_UP_ICON } from "../../icons/lucide/arrow-up.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRONS_UP_DOWN_ICON } from "../../icons/lucide/chevrons-up-down.js";
import { COLUMNS_3_COG_ICON } from "../../icons/lucide/columns-3-cog.js";
import { GRIP_VERTICAL_ICON } from "../../icons/lucide/grip-vertical.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { SEARCH_ICON } from "../../icons/lucide/search.js";
import { TABLE_ICON } from "../../icons/lucide/table.js";
import { WRAP_TEXT_ICON } from "../../icons/lucide/wrap-text.js";
import { CopyButton } from "../_shared/figure-controls/copy-button.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";
import {
  BODY_ATTRIBUTE,
  MAXIMIZABLE_ATTRIBUTE,
} from "../_model/figure-controls/figure-controls.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import type {
  CompiledDataTable,
  CompiledDataTableColumn,
  DataTableFit,
} from "./compile.js";
import type { TableCell } from "./parse-table-grid.js";

// /* off-scale */ Phase A preserves the legacy compact grid metrics, inset
// header radius, menu geometry, and 20% focus halo exactly. Phase B may
// regularize them against the product scale.

// The chrome rests quiet and reveals itself on hover and focus, matching the
// figure-header button family the schema and diff captions already use.
const BUTTON_CLASSES =
  "data-table-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted transition-colors hover:bg-transparent hover:text-ink aria-pressed:bg-transparent aria-pressed:text-ink [&_svg]:size-3.5";

const MENU_LIST_CLASSES =
  "data-table-menu-list absolute top-[calc(100%+0.25rem)] right-0 z-10 min-w-40 rounded-md bg-[var(--diff-header-bg)] p-1 shadow-floating";

const MENU_LABEL_CLASSES =
  "data-table-menu-label px-2 pt-1 pb-0.5 text-2xs font-semibold tracking-caps text-subtle uppercase";

const MENU_ITEM_CLASSES =
  "data-table-menu-item flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-sm border-0 bg-transparent px-2 py-1 text-left text-xs text-ink hover:bg-edge [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted";

const FIT_LABELS: Readonly<Record<DataTableFit, string>> = {
  wrap: "Wrap text",
  truncate: "Truncate text",
  scroll: "Scroll sideways",
};

const CellContent = ({ cell }: { readonly cell: TableCell }) => (
  <>
    {cell.segments.map((segment, index) =>
      segment.kind === "code" ? (
        <code
          key={index}
          className="rounded-none border-0 bg-transparent p-0 font-mono text-[0.9em]"
        >
          {segment.value}
        </code>
      ) : (
        <span key={index}>{segment.value}</span>
      ),
    )}
  </>
);

const SortGlyphs = ({ sort }: { readonly sort?: "asc" | "desc" }) => (
  <span className="data-table-sort-glyph inline-flex shrink-0" aria-hidden>
    {lucideIconToReact({
      icon: CHEVRONS_UP_DOWN_ICON,
      hidden: sort !== undefined,
    })}
    {lucideIconToReact({ icon: ARROW_UP_ICON, hidden: sort !== "asc" })}
    {lucideIconToReact({ icon: ARROW_DOWN_ICON, hidden: sort !== "desc" })}
  </span>
);

const HeaderCell = ({
  column,
  index,
}: {
  readonly column: CompiledDataTableColumn;
  readonly index: number;
}) => (
  <th
    scope="col"
    className="data-table-head bg-[var(--table-head-bg)] py-1 text-2xs font-medium tracking-caps whitespace-nowrap text-muted uppercase select-none data-[table-sorted]:text-ink"
    data-table-column={index}
    data-table-type={column.type}
    data-table-align={column.align}
    {...(column.fit === undefined ? {} : { "data-table-cell-fit": column.fit })}
    aria-sort="none"
    {...(column.sort === undefined
      ? {}
      : { "data-table-authored-sort": column.sort })}
  >
    {/* Disabled server-side: without the viewer script the header is a plain
        label, not a button that does nothing when pressed. */}
    <button
      type="button"
      className="data-table-sort inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-[inherit] tracking-[inherit] text-[inherit] uppercase hover:text-ink disabled:cursor-default disabled:text-inherit disabled:hover:text-inherit"
      data-table-sort={index}
      disabled
    >
      <span className="data-table-head-label">{column.label}</span>
      <SortGlyphs />
    </button>
    {lucideIconToReact({ icon: GRIP_VERTICAL_ICON, hidden: false })}
  </th>
);

// The columns menu now owns exactly one question - which columns are shown -
// because text fit and reset each earned their own control in the chrome.
const ColumnsMenu = ({
  columns,
  groupColumn,
}: {
  readonly columns: ReadonlyArray<CompiledDataTableColumn>;
  readonly groupColumn: number;
}) => (
  <span className="data-table-menu relative inline-flex" data-table-menu>
    <button
      type="button"
      className={BUTTON_CLASSES}
      aria-label="Choose columns"
      aria-haspopup="menu"
      aria-expanded="false"
      data-tooltip="Choose columns"
      hidden
      data-table-menu-button
    >
      {lucideIconToReact({ icon: COLUMNS_3_COG_ICON, hidden: false })}
    </button>
    <div
      className={MENU_LIST_CLASSES}
      role="menu"
      aria-label="Visible columns"
      hidden
      data-table-menu-list
    >
      <p className={MENU_LABEL_CLASSES}>Visible columns</p>
      {columns.map((column, index) => (
        <button
          key={column.label}
          type="button"
          className={MENU_ITEM_CLASSES}
          role="menuitemcheckbox"
          tabIndex={-1}
          data-table-column-toggle={index}
          aria-checked="true"
          {...(index === 0 && column.grouping !== true
            ? { disabled: true }
            : {})}
        >
          {lucideIconToReact({ icon: CHECK_ICON, hidden: false })}
          {column.label}
        </button>
      ))}
      <div
        className="data-table-menu-separator -mx-1 my-1 h-px bg-edge"
        role="separator"
        aria-orientation="horizontal"
      />
      {/* Grouping is a setting over the data, so the reader can change which
          column supplies the bands; the author only chooses the default. */}
      <p className={MENU_LABEL_CLASSES}>Group by</p>
      <button
        type="button"
        className={MENU_ITEM_CLASSES}
        role="menuitemradio"
        aria-checked={groupColumn === -1 ? "true" : "false"}
        tabIndex={-1}
        data-table-group-choice="-1"
      >
        {lucideIconToReact({ icon: CHECK_ICON, hidden: false })}
        No grouping
      </button>
      {columns.map((column, index) => (
        <button
          key={`group-${column.label}`}
          type="button"
          className={MENU_ITEM_CLASSES}
          role="menuitemradio"
          aria-checked={groupColumn === index ? "true" : "false"}
          tabIndex={-1}
          data-table-group-choice={index}
        >
          {lucideIconToReact({ icon: CHECK_ICON, hidden: false })}
          {column.label}
        </button>
      ))}
    </div>
  </span>
);

// Three modes are a choice, not a switch, so the control is a menu of radio
// items rather than a button whose meaning changes each press.
const FitMenu = ({ fit }: { readonly fit: DataTableFit }) => (
  <span className="data-table-menu relative inline-flex" data-table-menu>
    <button
      type="button"
      className={BUTTON_CLASSES}
      aria-label="Text fit"
      aria-haspopup="menu"
      aria-expanded="false"
      data-tooltip="Text fit"
      hidden
      data-table-fit-button
    >
      {lucideIconToReact({ icon: WRAP_TEXT_ICON, hidden: false })}
    </button>
    <div
      className={MENU_LIST_CLASSES}
      role="menu"
      aria-label="Text fit"
      hidden
      data-table-fit-list
    >
      {(["wrap", "truncate", "scroll"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={MENU_ITEM_CLASSES}
          role="menuitemradio"
          aria-checked={mode === fit ? "true" : "false"}
          tabIndex={-1}
          data-table-fit-choice={mode}
        >
          {lucideIconToReact({ icon: CHECK_ICON, hidden: false })}
          {FIT_LABELS[mode]}
        </button>
      ))}
    </div>
  </span>
);

// Reset undoes sort, column order, column visibility, fit, and grouping at
// once, so it stands beside the two controls that create that state rather
// than inside one of them.
const ResetButton = () => (
  <button
    type="button"
    className={BUTTON_CLASSES}
    aria-label="Reset table layout"
    data-tooltip="Reset table layout"
    hidden
    data-table-reset
  >
    {lucideIconToReact({ icon: ROTATE_CCW_ICON, hidden: false })}
  </button>
);

// The whole field hides server-side: a search box that cannot search is a
// worse promise than no search box at all.
const FilterField = ({ id }: { readonly id: string }) => (
  <span
    className="data-table-filter relative inline-flex items-center max-[55.999rem]:min-w-0 max-[55.999rem]:flex-1"
    hidden
    data-table-filter
  >
    <span className="data-table-filter-icon pointer-events-none absolute left-[0.4rem] inline-flex text-muted [&_svg]:size-3">
      {lucideIconToReact({ icon: SEARCH_ICON, hidden: false })}
    </span>
    <input
      type="search"
      className="data-table-filter-input h-6 w-32 rounded-md border border-edge-strong bg-transparent py-0 pr-2 pl-6 text-xs text-ink max-[55.999rem]:w-full"
      placeholder="Filter rows"
      aria-label="Filter rows"
      data-table-filter-input={id}
    />
  </span>
);

/** Renders one DataTable as a figure: caption chrome over the complete grid. */
export const DataTable = ({ model }: { readonly model: CompiledDataTable }) => (
  <figure
    className="data-table mb-6 w-fit max-w-full rounded-md border border-edge bg-[var(--diff-content-bg)]"
    data-data-table
    {...{ [MAXIMIZABLE_ATTRIBUTE]: "table" }}
    data-table-id={model.id}
    data-table-fit={model.fit}
    data-table-group-column={model.groupColumn}
  >
    <figcaption className="data-table-header flex min-w-0 items-center justify-between gap-3 rounded-t-md bg-[var(--diff-header-bg)] px-2 py-1 max-[55.999rem]:flex-col max-[55.999rem]:items-stretch max-[55.999rem]:gap-1">
      <span className="data-table-identity flex min-w-0 items-center gap-2 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted">
        {lucideIconToReact({ icon: TABLE_ICON, hidden: false })}
        <span className="data-table-title min-w-0 truncate font-semibold text-ink">
          {model.title ?? "Table"}
        </span>
        <span
          className="data-table-count min-w-0 text-xs text-muted"
          data-table-count
        >
          {`${model.rows.length} rows`}
        </span>
      </span>
      <span className="data-table-controls flex shrink-0 items-center gap-2 max-[55.999rem]:w-full">
        <span className="data-table-settings-group inline-flex items-center gap-1">
          {model.filter ? <FilterField id={model.id} /> : null}
          <ColumnsMenu
            columns={model.columns}
            groupColumn={model.groupColumn}
          />
          <FitMenu fit={model.fit} />
          <ResetButton />
        </span>
        <span className="figure-action-group inline-flex items-center gap-0.5">
          <CopyButton subject="table" />
          <MaximizeButton subject="table" />
        </span>
      </span>
    </figcaption>
    {/* The document-wide table transform leaves a table alone when its parent
        already declares itself a scroll container, so the figure keeps one
        box instead of gaining a second bordered wrapper inside itself. */}
    <div
      className="data-table-scroll"
      data-table-scroll-container=""
      {...{ [BODY_ATTRIBUTE]: "" }}
    >
      <table className="data-table-grid m-0 w-full min-w-0 max-w-full border-collapse text-sm">
        <thead>
          <tr>
            {model.columns.map((column, index) => (
              <HeaderCell key={column.label} column={column} index={index} />
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row, rowIndex) => (
            <tr key={rowIndex} data-table-row={rowIndex}>
              {row.cells.map((cell, cellIndex) => {
                const column = model.columns[cellIndex];
                return (
                  <td
                    key={cellIndex}
                    className="data-table-cell data-[table-align=center]:text-center data-[table-align=right]:text-right"
                    data-table-column={cellIndex}
                    data-table-align={column?.align ?? "left"}
                    {...(column?.fit === undefined
                      ? {}
                      : { "data-table-cell-fit": column.fit })}
                    title={cell.text}
                  >
                    <CellContent cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {/* The first thing a reader sees when a filter finds nothing, so it says
        what happened and what to do rather than reporting a count of zero.
        The viewer script replaces the sentence with one naming the query. */}
    <div
      className="data-table-empty flex flex-col items-center gap-2 px-6 py-12 text-center"
      hidden
      data-table-empty
    >
      <span
        className="inline-flex size-8 items-center justify-center rounded-full bg-surface text-subtle [&_svg]:size-4"
        aria-hidden="true"
      >
        {lucideIconToReact({ icon: SEARCH_ICON, hidden: false })}
      </span>
      <p className="m-0 text-sm font-semibold text-ink" data-table-empty-lead>
        No rows match this filter.
      </p>
      <p className="m-0 text-xs text-subtle">
        Clear the filter to see every row again.
      </p>
    </div>
  </figure>
);
