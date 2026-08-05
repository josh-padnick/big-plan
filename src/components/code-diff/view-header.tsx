// Renders CodeDiff's caption: file identity, line-count summary, the shared
// maximize control, and view and action controls reserved for the live review
// application.

import { COLUMNS_2_ICON } from "../../icons/lucide/columns-2.js";
import { COPY_ICON } from "../../icons/lucide/copy.js";
import { ELLIPSIS_ICON } from "../../icons/lucide/ellipsis.js";
import { ROWS_2_ICON } from "../../icons/lucide/rows-2.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import { FileIdentity } from "../_shared/file-identity/file-identity.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";

// /* off-scale */ Phase A preserves the legacy inset header radius, 0.55rem
// caption padding, segmented-control radius, menu offset, and menu shadow
// exactly. Phase B may regularize them against the product scale.

// Shared by the view toggles and actions button. Hover and pressed colors are
// utilities rather than stylesheet rules because a components-layer rule
// loses to the resting bg-surface utility, which left these controls with no
// background feedback at all.
const BUTTON_BASE_CLASSES =
  "code-diff-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center border-0 bg-surface p-0 text-muted transition-colors hover:bg-edge hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
// The actions button stands on its own.
const BUTTON_CLASSES = `${BUTTON_BASE_CLASSES} rounded-md`;
// Segmented buttons sit flush and round only where they meet the group's
// outer corners, so the group needs no overflow clipping and the buttons'
// hover hints stay visible. The end radius is the group's less its border.
const TOGGLE_BUTTON_CLASSES = `${BUTTON_BASE_CLASSES} first:rounded-l-[0.3125rem] last:rounded-r-[0.3125rem] aria-pressed:bg-edge aria-pressed:text-ink`;
const MENU_ITEM_CLASSES =
  "code-diff-menu-item flex w-full cursor-pointer items-center gap-[0.45rem] whitespace-nowrap rounded-sm border-0 bg-transparent px-2 py-[0.3rem] text-left text-xs text-ink hover:bg-edge [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted";

const MenuItemButton = ({
  action,
  label,
}: {
  readonly action: "copy-path" | "copy";
  readonly label: string;
}) => (
  <button
    type="button"
    className={MENU_ITEM_CLASSES}
    role="menuitem"
    tabIndex={-1}
    {...{ [`data-diff-${action}`]: "" }}
  >
    {lucideIconToReact({ icon: COPY_ICON, hidden: false })}
    {label}
  </button>
);

// Header summary of the parsed diff; authors opt in per component via the
// showLineCounts shorthand attribute.
const DiffStats = ({
  addedCount,
  removedCount,
}: {
  readonly addedCount: number;
  readonly removedCount: number;
}) => (
  <span className="code-diff-stats inline-flex shrink-0 gap-[0.4rem] text-xs font-semibold">
    <span className="sr-only">
      {`${addedCount} added, ${removedCount} removed`}
    </span>
    <span
      className="code-diff-stat-add text-[var(--diff-add-c)]"
      aria-hidden="true"
    >
      {`+${addedCount}`}
    </span>
    <span
      className="code-diff-stat-remove text-[var(--diff-remove-c)]"
      aria-hidden="true"
    >
      {`-${removedCount}`}
    </span>
  </span>
);

// Copy actions live behind one overflow menu instead of dedicated buttons,
// keeping the header calm as actions accumulate.
// Feedback appears above the actions button so it never covers the diff or
// shifts the controls, and it inverts the palette for contrast.
const ActionsMenu = () => (
  <span className="code-diff-menu relative inline-flex" data-diff-menu="">
    <span
      className="code-copy-message absolute bottom-[calc(100%+0.25rem)] right-0 z-10 rounded-[0.375rem] bg-ink px-2 py-1 text-xs text-paper whitespace-nowrap shadow-md"
      aria-hidden="true"
      data-diff-copy-message=""
      hidden
    >
      {"Copied!"}
    </span>
    <button
      type="button"
      className={BUTTON_CLASSES}
      aria-label="More actions"
      aria-haspopup="menu"
      aria-expanded="false"
      data-tooltip="More actions"
      hidden
      data-diff-menu-button=""
      data-size="xs"
      data-slot="button"
      data-variant="ghost"
    >
      {lucideIconToReact({ icon: ELLIPSIS_ICON, hidden: false })}
    </button>
    <div
      className="code-diff-menu-list absolute top-[calc(100%+0.25rem)] right-0 z-10 min-w-36 rounded-[0.375rem] border border-edge bg-[var(--diff-header-bg)] p-1 shadow-[0_6px_18px_rgb(12_10_8_/_0.18)]"
      role="menu"
      aria-label="Diff actions"
      hidden
      data-diff-menu-list=""
    >
      <MenuItemButton action="copy-path" label="Copy path" />
      <MenuItemButton action="copy" label="Copy diff" />
    </div>
  </span>
);

// One pressed segment per view keeps the current state and the alternative
// visible at once; a single flipping button hid which mode was active.
const ViewToggleButton = ({
  view,
  pressed,
  label,
  icon,
}: {
  readonly view: "unified" | "split";
  readonly pressed: boolean;
  readonly label: string;
  readonly icon: LucideIcon;
}) => (
  <button
    type="button"
    className={TOGGLE_BUTTON_CLASSES}
    aria-label={label}
    aria-pressed={pressed ? "true" : "false"}
    data-tooltip={label}
    data-diff-set-view={view}
    data-size="xs"
    data-slot="button"
    data-variant="ghost"
  >
    {lucideIconToReact({ icon, hidden: false })}
  </button>
);

// The live review application can reveal this group and switch between the
// server-rendered unified and split views.
const ViewToggleGroup = () => (
  <span
    className="code-diff-toggle-group inline-flex rounded-[0.375rem] border border-edge"
    role="group"
    aria-label="Diff view"
    hidden
    data-diff-toggle-group=""
  >
    <ViewToggleButton
      view="unified"
      pressed
      label="Unified view"
      icon={ROWS_2_ICON}
    />
    <ViewToggleButton
      view="split"
      pressed={false}
      label="Side-by-side view"
      icon={COLUMNS_2_ICON}
    />
  </span>
);

/** Renders the CodeDiff caption and its active and reserved controls. */
export const CodeDiffHeader = ({
  filePath,
  addedCount,
  removedCount,
  showLineCounts,
}: {
  readonly filePath: string;
  readonly addedCount: number;
  readonly removedCount: number;
  readonly showLineCounts: boolean;
}) => (
  <figcaption className="code-diff-header flex min-w-0 items-center justify-between gap-3 rounded-t-[calc(var(--radius-md)-1px)] border-b border-edge bg-[var(--diff-header-bg)] px-[0.55rem] py-[0.3rem]">
    <FileIdentity filePath={filePath} />
    <span className="code-diff-controls flex shrink-0 items-center gap-1">
      {showLineCounts ? (
        <DiffStats addedCount={addedCount} removedCount={removedCount} />
      ) : null}
      <ViewToggleGroup />
      <ActionsMenu />
      {/* Far right so maximizing and restoring live in the same corner. */}
      <MaximizeButton subject="diff" />
    </span>
  </figcaption>
);
