// Renders DatabaseTableSchema's caption: table identity, table note, the
// shared maximize control, and column and action menus reserved for the live
// review application.

import { CHECK_ICON } from "../../icons/lucide/check.js";
import { COLUMNS_3_COG_ICON } from "../../icons/lucide/columns-3-cog.js";
import { DATABASE_ICON } from "../../icons/lucide/database.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import { CopyButton } from "../_shared/figure-controls/copy-button.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";
import { MutedText } from "./view-elements.js";
import { FIELD_KIND } from "./view-layouts.js";
import { qualifiedTableName } from "./qualified-table-name.js";

// /* off-scale */ Phase A preserves the legacy inset header radius, compact
// caption/menu geometry, and menu shadow exactly. Phase B may regularize them
// against the product scale.

// A transparent resting state keeps the overflow control quieter than the
// schema it acts on; hover and focus still reveal the full affordance.
// Shared by the column and action controls. The hover background is a utility
// rather than a stylesheet rule because a components-layer rule loses to the
// resting bg-transparent utility.
const BUTTON_CLASSES =
  "table-schema-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted transition-colors hover:bg-transparent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
// Shared by the actions and columns menus.
const MENU_LIST_CLASSES =
  "table-schema-menu-list absolute top-[calc(100%+0.25rem)] right-0 z-10 min-w-36 rounded-md bg-[var(--diff-header-bg)] p-1 shadow-floating";
const MENU_ITEM_CLASSES =
  "table-schema-menu-item flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-sm border-0 bg-transparent px-2 py-1 text-left text-xs text-ink hover:bg-edge [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted";

// The explicit label keeps the accessible name the full qualified table name,
// independent of the styled schema/table split below.
const TableIdentity = ({
  tableName,
  schemaName,
}: {
  readonly tableName: string;
  readonly schemaName?: string;
}) => (
  <span
    className="table-schema-identity flex min-w-0 items-center gap-2 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted"
    aria-label={qualifiedTableName(schemaName, tableName)}
  >
    {lucideIconToReact({ icon: DATABASE_ICON, hidden: false })}
    <span className="table-schema-name min-w-0 truncate">
      {schemaName === undefined ? null : (
        <MutedText variant="schemaName">{schemaName}</MutedText>
      )}
      <span className="table-schema-name-table font-semibold text-ink">
        {tableName}
      </span>
    </span>
  </span>
);

const MenuItemButton = ({
  action,
  label,
  icon,
}: {
  readonly action: "reset-columns";
  readonly label: string;
  readonly icon: LucideIcon;
}) => (
  <button
    type="button"
    className={MENU_ITEM_CLASSES}
    role="menuitem"
    tabIndex={-1}
    {...{ [`data-schema-${action}`]: "" }}
  >
    {lucideIconToReact({ icon, hidden: false })}
    {label}
  </button>
);

// The toggleable grid columns: the name column stays out because hiding the
// row identity would make every remaining cell unreadable.
const TOGGLEABLE_COLUMNS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
}> = [
  { key: "type", label: "Type" },
  { key: "constraints", label: "Constraints" },
  { key: "default", label: "Default" },
  { key: "comment", label: "Comment" },
];

// Checkbox items ship checked server-side; the live application owns their
// state and keeps the menu open across consecutive toggles.
const ColumnsMenu = () => (
  <span className="table-schema-menu relative inline-flex" data-schema-menu="">
    <button
      type="button"
      className={BUTTON_CLASSES}
      aria-label="Choose columns"
      aria-haspopup="menu"
      aria-expanded="false"
      data-tooltip="Choose columns"
      hidden
      data-schema-columns-button=""
      data-size="xs"
      data-slot="button"
      data-variant="ghost"
    >
      {lucideIconToReact({ icon: COLUMNS_3_COG_ICON, hidden: false })}
    </button>
    <div
      className={MENU_LIST_CLASSES}
      role="menu"
      aria-label="Visible columns"
      hidden
      data-schema-columns-list=""
    >
      {TOGGLEABLE_COLUMNS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={MENU_ITEM_CLASSES}
          role="menuitemcheckbox"
          aria-checked="true"
          tabIndex={-1}
          data-schema-column-toggle={key}
        >
          {lucideIconToReact({ icon: CHECK_ICON, hidden: false })}
          {label}
        </button>
      ))}
      {/* Reset lives beside the toggles it reverts; it also restores the
          authored order, so the layout has one home. The separator keeps
          the reset action visually apart from the checkboxes. */}
      <div
        className="table-schema-menu-separator -mx-1 my-1 h-px bg-edge"
        role="separator"
        aria-orientation="horizontal"
      />
      <MenuItemButton
        action="reset-columns"
        label="Reset column layout"
        icon={ROTATE_CCW_ICON}
      />
    </div>
  </span>
);

/** Renders the caption: identity and controls, plus the table note beneath
 * them in the same band so the header stays one bordered region. */
export const TableSchemaHeader = ({
  tableName,
  schemaName,
  note,
}: {
  readonly tableName: string;
  readonly schemaName?: string;
  readonly note?: string;
}) => (
  <figcaption
    className="table-schema-header min-w-0 rounded-t-md border-b border-edge bg-[var(--diff-header-bg)] px-2 py-1"
    data-commentable-kind={FIELD_KIND}
    data-commentable-label={`Table: ${qualifiedTableName(schemaName, tableName)}`}
  >
    <span className="table-schema-header-row flex min-w-0 items-center justify-between gap-3">
      <TableIdentity
        tableName={tableName}
        {...(schemaName === undefined ? {} : { schemaName })}
      />
      <span className="table-schema-controls flex shrink-0 items-center gap-2">
        <span className="figure-action-group inline-flex items-center gap-0.5">
          <ColumnsMenu />
          <CopyButton subject="schema" />
          <MaximizeButton subject="schema" />
        </span>
      </span>
    </span>
    {note === undefined ? null : (
      <MutedText variant="headerNote" data-schema-table-note="">
        {note}
      </MutedText>
    )}
  </figcaption>
);
