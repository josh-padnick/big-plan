// Renders FileTreeDiff's combined change tree plus the derived before/after
// hierarchy panes, plus the shared maximize control.

import type { CompiledFileTreeDiff } from "./compile.js";
import {
  countTreeChanges,
  deriveTreeView,
} from "../_model/tree-text/derive-tree-view.js";
import type { TreeEntry } from "../_model/tree-text/parse-tree-text.js";
import { COLUMNS_2_ICON } from "../../icons/lucide/columns-2.js";
import { ROWS_2_ICON } from "../../icons/lucide/rows-2.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import {
  TreeHierarchy,
  treeChangeCountsToReact,
} from "../_shared/tree-hierarchy/tree-hierarchy.js";
import { MAXIMIZABLE_ATTRIBUTE } from "../_model/figure-controls/figure-controls.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";

// /* off-scale */ Phase A preserves the legacy segmented-control radius,
// compact caption padding, and switch geometry exactly. Phase B may
// regularize them against the product scale.

// Shared by the view toggles. Hover and pressed
// colors are utilities rather than stylesheet rules because a components-layer
// rule loses to the resting bg-surface utility, which left these controls with
// no background feedback at all.
const BUTTON_BASE_CLASSES =
  "file-tree-diff-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted transition-colors hover:bg-transparent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
// Segmented buttons sit flush and round only where they meet the group's
// outer corners, so the group needs no overflow clipping and the buttons'
// hover hints stay visible. The end radius is the group's less its border.
const TOGGLE_BUTTON_CLASSES = `${BUTTON_BASE_CLASSES} bg-surface hover:bg-edge first:rounded-l-md last:rounded-r-md aria-pressed:bg-edge aria-pressed:text-ink`;
// Shared by the combined view and both state-pane bodies.
const BODY_CLASSES = "file-tree-body overflow-x-auto px-3 py-3";

const ViewToggleButton = ({
  view,
  pressed,
  label,
  icon,
}: {
  readonly view: "combined" | "before-after";
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
    data-tree-set-view={view}
    data-size="xs"
    data-slot="button"
    data-variant="ghost"
  >
    {lucideIconToReact({ icon, hidden: false })}
  </button>
);

const ViewToggleGroup = () => (
  <span
    className="file-tree-diff-toggle-group inline-flex shrink-0 rounded-md border border-edge"
    role="group"
    aria-label="File tree diff view"
    hidden
    data-tree-toggle-group=""
  >
    <ViewToggleButton
      view="combined"
      pressed
      label="Combined view"
      icon={ROWS_2_ICON}
    />
    <ViewToggleButton
      view="before-after"
      pressed={false}
      label="Side-by-side view"
      icon={COLUMNS_2_ICON}
    />
  </span>
);

// A glance-level answer to "how big is this change?" before reading rows.
const ChangeSummary = ({
  entries,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
}) => (
  <span className="file-tree-diff-summary inline-flex min-w-0 shrink-0 items-center gap-1 font-sans text-2xs font-semibold">
    {treeChangeCountsToReact(
      countTreeChanges({ entries, badgeForEntry: (entry) => entry.badge }),
    )}
  </span>
);

const DiffHeader = ({
  title,
  entries,
}: {
  readonly title: string | undefined;
  readonly entries: ReadonlyArray<TreeEntry>;
}) => (
  <figcaption className="file-tree-header file-tree-diff-header flex min-w-0 items-center justify-between gap-1 bg-[var(--diff-header-bg)] px-3 py-1.5 font-sans text-sm font-semibold text-ink">
    {title === undefined ? null : (
      <span className="file-tree-diff-title truncate">{title}</span>
    )}
    <ChangeSummary entries={entries} />
    <span className="file-tree-diff-controls flex shrink-0 items-center gap-1">
      <ViewToggleGroup />
      <span className="figure-action-group ml-1 inline-flex items-center gap-1 border-l border-edge pl-1">
        <MaximizeButton subject="tree" />
      </span>
    </span>
  </figcaption>
);

const combinedName = (entry: TreeEntry): string =>
  entry.oldName === undefined
    ? entry.name
    : `${entry.oldName} -> ${entry.name}`;

const CombinedView = ({
  entries,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
}) => (
  <div className={BODY_CLASSES} data-tree-content="combined">
    <TreeHierarchy
      noteDisplay="hint"
      entries={entries}
      nameForEntry={combinedName}
      badgeForEntry={(entry) => entry.badge}
    />
  </div>
);

const PaneBody = ({
  entries,
  variant,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly variant?: "diff" | "plain";
}) => (
  <div
    className={BODY_CLASSES}
    {...(variant === undefined ? {} : { "data-tree-after-variant": variant })}
  >
    <TreeHierarchy
      noteDisplay="hint"
      entries={entries}
      nameForEntry={(entry) => entry.name}
      badgeForEntry={(entry) => entry.badge}
    />
  </div>
);

const StatePane = ({
  entries,
  afterPlainEntries = [],
  side,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly afterPlainEntries?: ReadonlyArray<TreeEntry>;
  readonly side: "before" | "after";
}) => (
  <section
    className={[
      "file-tree-diff-pane",
      "min-w-0",
      ...(side === "after"
        ? ["border-t", "border-edge", "wide:border-t-0", "wide:border-l"]
        : []),
    ].join(" ")}
    aria-label={side === "before" ? "Current" : "Planned"}
    data-tree-pane={side}
  >
    <div className="file-tree-diff-pane-caption flex min-w-0 items-center justify-between gap-2 border-b border-edge bg-[var(--diff-hunk-bg)] px-3 py-1.5 font-sans text-xs font-semibold text-muted">
      {side === "before" ? "Current" : "Planned"}
    </div>
    {side === "before" ? (
      <PaneBody entries={entries} />
    ) : (
      <>
        <PaneBody entries={entries} variant="diff" />
        <PaneBody entries={afterPlainEntries} variant="plain" />
      </>
    )}
  </section>
);

const BeforeAfterView = ({
  entries,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
}) => (
  <div
    className="file-tree-diff-before-after min-w-0 grid-cols-[minmax(0,1fr)] wide:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    data-tree-content="before-after"
  >
    <StatePane
      entries={deriveTreeView({ entries, side: "before" })}
      side="before"
    />
    <StatePane
      entries={deriveTreeView({ entries, side: "after" })}
      afterPlainEntries={deriveTreeView({
        entries,
        side: "after",
        showChanges: false,
      })}
      side="after"
    />
  </div>
);

export const FileTreeDiff = ({
  model,
}: {
  readonly model: CompiledFileTreeDiff;
}) => (
  <figure
    className="file-tree file-tree-diff mb-6 min-w-0 overflow-hidden rounded-md border border-edge bg-[var(--diff-content-bg)] font-mono text-sm"
    data-file-tree-diff=""
    {...{ [MAXIMIZABLE_ATTRIBUTE]: "tree" }}
    data-tree-view="combined"
    data-tree-changes={model.hideDiff ? "hidden" : "shown"}
  >
    <DiffHeader title={model.title} entries={model.entries} />
    <CombinedView entries={model.entries} />
    <BeforeAfterView entries={model.entries} />
  </figure>
);
