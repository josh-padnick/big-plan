// Renders CodeDiff's caption: file identity, line-count summary, the shared
// maximize control, and view and action controls reserved for the live review
// application.

import { COLUMNS_2_ICON } from "../../icons/lucide/columns-2.js";
import { ROWS_2_ICON } from "../../icons/lucide/rows-2.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import { FileIdentity } from "../_shared/file-identity/file-identity.js";
import { CopyButton } from "../_shared/figure-controls/copy-button.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";

// /* off-scale */ Phase A preserves the legacy inset header radius, 0.55rem
// caption padding, segmented-control radius, menu offset, and menu shadow
// exactly. Phase B may regularize them against the product scale.

// Shared by the view toggles and actions button. Hover and pressed colors are
// utilities rather than stylesheet rules because a components-layer rule
// loses to the resting bg-surface utility, which left these controls with no
// background feedback at all.
const BUTTON_BASE_CLASSES =
  "code-diff-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted transition-colors hover:bg-transparent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
// Segmented buttons sit flush and round only where they meet the group's
// outer corners, so the group needs no overflow clipping and the buttons'
// hover hints stay visible. The end radius is the group's less its border.
const TOGGLE_BUTTON_CLASSES = `${BUTTON_BASE_CLASSES} bg-surface hover:bg-edge first:rounded-l-[0.3125rem] last:rounded-r-[0.3125rem] aria-pressed:bg-edge aria-pressed:text-ink`;
// Header summary of the parsed diff; authors opt in per component via the
// showLineCounts shorthand attribute.
const DiffStats = ({
  addedCount,
  removedCount,
}: {
  readonly addedCount: number;
  readonly removedCount: number;
}) => (
  <span className="code-diff-stats inline-flex shrink-0 gap-1.5 text-xs font-semibold">
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
  <figcaption className="code-diff-header flex min-w-0 items-center justify-between gap-3 rounded-t-[calc(var(--radius-md)-1px)] border-b border-edge bg-[var(--diff-header-bg)] px-2 py-1">
    <FileIdentity filePath={filePath} />
    <span className="code-diff-controls flex shrink-0 items-center gap-3">
      <span className="code-diff-view-group inline-flex items-center gap-2">
        {showLineCounts ? (
          <DiffStats addedCount={addedCount} removedCount={removedCount} />
        ) : null}
        <ViewToggleGroup />
      </span>
      <span className="figure-action-group inline-flex items-center gap-0.5">
        <CopyButton subject="diff" />
        {/* Far right so maximizing and restoring live in the same corner. */}
        <MaximizeButton subject="diff" />
      </span>
    </span>
  </figcaption>
);
