// Renders CodeDiff's caption: file identity, line-count summary, and hidden
// controls reserved for the live review application.

import { COLUMNS_2_ICON } from "../../render/icons/lucide/columns-2.js";
import { COPY_ICON } from "../../render/icons/lucide/copy.js";
import { ELLIPSIS_ICON } from "../../render/icons/lucide/ellipsis.js";
import { MAXIMIZE_2_ICON } from "../../render/icons/lucide/maximize-2.js";
import { MINIMIZE_2_ICON } from "../../render/icons/lucide/minimize-2.js";
import { ROWS_2_ICON } from "../../render/icons/lucide/rows-2.js";
import type { LucideIcon } from "../../render/icons/lucide-icon.js";
import { lucideIconToReact } from "../lucide-icon.js";
import { FileIdentity } from "../shared/file-identity/file-identity.js";

// Shared by the view toggles, the actions button, and the full-screen
// control.
const BUTTON_CLASSES =
  "code-diff-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
const MENU_ITEM_CLASSES =
  "code-diff-menu-item flex w-full cursor-pointer items-center gap-[0.45rem] whitespace-nowrap rounded-sm border-0 bg-transparent px-2 py-[0.3rem] text-left text-xs text-ink [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted";

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
    <span className="code-diff-stat-add" aria-hidden="true">
      {`+${addedCount}`}
    </span>
    <span className="code-diff-stat-remove" aria-hidden="true">
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
      title="More actions"
      hidden
      data-diff-menu-button=""
      data-size="xs"
      data-slot="button"
      data-variant="ghost"
    >
      {lucideIconToReact({ icon: ELLIPSIS_ICON, hidden: false })}
    </button>
    <div
      className="code-diff-menu-list absolute top-[calc(100%+0.25rem)] right-0 z-10 min-w-36 rounded-[0.375rem] border border-edge p-1"
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
    className={BUTTON_CLASSES}
    aria-label={label}
    aria-pressed={pressed ? "true" : "false"}
    title={label}
    data-diff-set-view={view}
    data-size="xs"
    data-slot="button"
    data-variant="ghost"
  >
    {lucideIconToReact({ icon, hidden: false })}
  </button>
);

// The live review application can reveal this control and move the figure
// into its full-screen dialog without cloning it.
const ExpandControlButton = () => (
  <button
    type="button"
    className={BUTTON_CLASSES}
    aria-label="View diff full screen"
    title="View diff full screen"
    hidden
    data-diff-expand=""
    data-size="xs"
    data-slot="button"
    data-variant="ghost"
  >
    {lucideIconToReact({ icon: MAXIMIZE_2_ICON, hidden: false })}
    {lucideIconToReact({ icon: MINIMIZE_2_ICON, hidden: true })}
  </button>
);

const ViewToggleGroup = () => (
  <span
    className="code-diff-toggle-group inline-flex overflow-hidden rounded-[0.375rem] border border-edge"
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

/** Renders the complete CodeDiff caption and progressive controls. */
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
  <figcaption className="code-diff-header flex min-w-0 items-center justify-between gap-3 border-b border-edge px-[0.55rem] py-[0.3rem]">
    <FileIdentity filePath={filePath} />
    <span className="code-diff-controls flex shrink-0 items-center gap-1">
      {showLineCounts ? (
        <DiffStats addedCount={addedCount} removedCount={removedCount} />
      ) : null}
      <ViewToggleGroup />
      <ActionsMenu />
      {/* Far right so entering and leaving full screen live in the same
          corner of the component. */}
      <ExpandControlButton />
    </span>
  </figcaption>
);
