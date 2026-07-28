// Renders FileTreeDiff's combined change tree plus the derived before/after
// hierarchy panes reserved for the live review application.

import type { CompiledFileTreeDiff } from "./compile.js";
import { countTreeChanges, deriveTreeView } from "./derive-tree-view.js";
import type { TreeEntry } from "./parse-tree-text.js";
import { COLUMNS_2_ICON } from "../../icons/lucide/columns-2.js";
import { MAXIMIZE_2_ICON } from "../../icons/lucide/maximize-2.js";
import { MINIMIZE_2_ICON } from "../../icons/lucide/minimize-2.js";
import { ROWS_2_ICON } from "../../icons/lucide/rows-2.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import {
  TreeFoldControls,
  TreeHierarchy,
  treeChangeCountsToReact,
} from "../_shared/tree-hierarchy/tree-hierarchy.js";

// Shared by the view toggles and the full-screen control.
const BUTTON_CLASSES =
  "file-tree-diff-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
// Shared by the combined view and both state-pane bodies.
const BODY_CLASSES = "file-tree-body overflow-x-auto px-3 py-2.5";

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
    className={BUTTON_CLASSES}
    aria-label={label}
    aria-pressed={pressed ? "true" : "false"}
    title={label}
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
    className="file-tree-diff-toggle-group inline-flex shrink-0 overflow-hidden rounded-[0.375rem] border border-edge"
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

// Full screen stays reserved for the live review application, like the view
// toggle; the server-rendered combined tree needs neither.
const ExpandButton = () => (
  <button
    type="button"
    className={BUTTON_CLASSES}
    aria-label="View file tree full screen"
    title="View file tree full screen"
    hidden
    data-tree-expand=""
    data-size="xs"
    data-slot="button"
    data-variant="ghost"
  >
    {lucideIconToReact({ icon: MAXIMIZE_2_ICON, hidden: false })}
    {lucideIconToReact({ icon: MINIMIZE_2_ICON, hidden: true })}
  </button>
);

// A glance-level answer to "how big is this change?" before reading rows.
const ChangeSummary = ({
  entries,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
}) => (
  <span className="file-tree-diff-summary inline-flex min-w-0 shrink-0 items-center gap-1 font-sans text-[0.6875rem] font-semibold">
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
  <figcaption
    className="file-tree-header file-tree-diff-header flex min-w-0 items-center justify-between gap-3 border-b border-edge px-[0.65rem] py-[0.4rem] font-sans text-sm font-semibold text-ink"
    {...(title === undefined ? { "data-tree-header-without-title": "" } : {})}
  >
    {title === undefined ? null : (
      <span className="file-tree-diff-title truncate">{title}</span>
    )}
    <ChangeSummary entries={entries} />
    <span className="file-tree-diff-controls flex shrink-0 items-center gap-1">
      <TreeFoldControls tone="standard" />
      <ViewToggleGroup />
      <ExpandButton />
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

// The switch shape and data-slot/data-state contract come from the shadcn/ui
// registry Switch (sm size), translated to static markup with this palette:
// primary -> accent, input -> edge, background -> paper. State transitions are
// driven by the live review application instead of Radix.
const SWITCH_CLASSES =
  "file-tree-changes-toggle inline-flex h-3.5 w-6 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50 data-[state=checked]:bg-accent data-[state=unchecked]:bg-edge";
const SWITCH_THUMB_CLASSES =
  "pointer-events-none block size-3 rounded-full bg-paper ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0";

// The switch lives in the After caption because only that pane has two
// truths to swap between: the annotated change set and the plain final
// state the plan produces.
const ShowDiffSwitch = ({ checked }: { readonly checked: boolean }) => (
  <span
    className="file-tree-changes flex shrink-0 items-center gap-1.5"
    hidden
    data-tree-changes-control=""
  >
    {"Show diff"}
    <button
      type="button"
      role="switch"
      aria-checked={checked ? "true" : "false"}
      aria-label="Show diff"
      className={SWITCH_CLASSES}
      data-tree-changes-toggle=""
      data-slot="switch"
      data-size="sm"
      data-state={checked ? "checked" : "unchecked"}
    >
      <span
        className={SWITCH_THUMB_CLASSES}
        data-slot="switch-thumb"
        data-state={checked ? "checked" : "unchecked"}
      />
    </button>
  </span>
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
  showDiff = true,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly afterPlainEntries?: ReadonlyArray<TreeEntry>;
  readonly side: "before" | "after";
  readonly showDiff?: boolean;
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
    <div className="file-tree-diff-pane-caption flex min-w-0 items-center justify-between gap-2 border-b border-edge px-3 py-1.5 font-sans text-xs font-semibold text-muted">
      {side === "before" ? "Current" : "Planned"}
      <span className="file-tree-pane-controls flex shrink-0 items-center gap-1.5">
        <TreeFoldControls tone="quiet" />
        {side === "after" ? <ShowDiffSwitch checked={showDiff} /> : null}
      </span>
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
  showDiff,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly showDiff: boolean;
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
      showDiff={showDiff}
    />
  </div>
);

export const FileTreeDiff = ({
  model,
}: {
  readonly model: CompiledFileTreeDiff;
}) => (
  <figure
    className="file-tree file-tree-diff mb-5 min-w-0 overflow-hidden rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]"
    data-file-tree-diff=""
    data-tree-view="combined"
    data-tree-changes={model.hideDiff ? "hidden" : "shown"}
  >
    <DiffHeader title={model.title} entries={model.entries} />
    <CombinedView entries={model.entries} />
    <BeforeAfterView entries={model.entries} showDiff={!model.hideDiff} />
  </figure>
);
