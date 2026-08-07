// Owns the semantic nested-list hierarchy shared by FileTree and every
// FileTreeDiff view, parameterized by displayed names and change markers.

import type { ReactNode } from "react";
import { countTreeChanges } from "../../_model/tree-text/derive-tree-view.js";
import type { TreeChangeCounts } from "../../_model/tree-text/derive-tree-view.js";
import type {
  TreeBadge,
  TreeEntry,
} from "../../_model/tree-text/parse-tree-text.js";
import { CHEVRON_RIGHT_ICON } from "../../../icons/lucide/chevron-right.js";
import { COPY_MINUS_ICON } from "../../../icons/lucide/copy-minus.js";
import { COPY_PLUS_ICON } from "../../../icons/lucide/copy-plus.js";
import { FILE_DIFF_ICON } from "../../../icons/lucide/file-diff.js";
import { FILE_MINUS_2_ICON } from "../../../icons/lucide/file-minus-2.js";
import { FILE_PLUS_2_ICON } from "../../../icons/lucide/file-plus-2.js";
import { FILE_SYMLINK_ICON } from "../../../icons/lucide/file-symlink.js";
import { FILE_ICON } from "../../../icons/lucide/file.js";
import { FOLDER_ICON } from "../../../icons/lucide/folder.js";
import { MESSAGE_SQUARE_ICON } from "../../../icons/lucide/message-square.js";
import type { LucideIcon } from "../../../icons/lucide-icon.js";
import { lucideIconToReact } from "../lucide-icon/lucide-icon.js";

// How an entry's authored note reaches the reader: FileTree keeps notes in
// the row because they are its content, while FileTreeDiff keeps rows
// status-first and tucks each note behind a hoverable comment hint.
export type TreeNoteDisplay = "inline" | "hint";

export type TreeFoldTone = "standard" | "quiet";

// The quiet tone keeps pane-bar fold-alls discoverable without competing
// with the trees; the header pair keeps standard contrast beside its
// neighboring controls. Hover restores full contrast either way.
const FOLD_TONE_CLASSES: Readonly<Record<TreeFoldTone, string>> = {
  standard: "text-muted",
  quiet: "text-subtle",
};

// Statuses read the way git tooling presents them: a changed file's leading
// glyph becomes its status icon (the Lucide file-plus-2 family standing in
// for GitHub's per-change file icons), the name carries the change tint with
// deletions struck through, and the spelled-out status follows the name,
// ahead of any comment hint.
const STATUS_ICONS: Readonly<Record<TreeBadge, LucideIcon>> = {
  added: FILE_PLUS_2_ICON,
  removed: FILE_MINUS_2_ICON,
  modified: FILE_DIFF_ICON,
  renamed: FILE_SYMLINK_ICON,
};

const BADGE_LABELS: Readonly<Record<TreeBadge, string>> = {
  added: "Added",
  modified: "Modified",
  removed: "Deleted",
  renamed: "Renamed",
};

const COUNT_SIGILS: ReadonlyArray<
  readonly [keyof TreeChangeCounts, string, string]
> = [
  ["added", "+", "text-[var(--diff-add-c)]"],
  ["modified", "~", "text-[var(--callout-warning-c)]"],
  ["removed", "-", "text-[var(--diff-remove-c)]"],
  ["renamed", "->", "text-[var(--callout-note-c)]"],
];

/** Renders one compact colored count per non-zero change kind. */
export const treeChangeCountsToReact = (
  counts: TreeChangeCounts,
): ReadonlyArray<ReactNode> =>
  COUNT_SIGILS.flatMap(([kind, sigil, className]) =>
    counts[kind] === 0
      ? []
      : [
          <span key={className} className={className}>
            {`${sigil}${counts[kind]}`}
          </span>,
        ],
  );

// Only visible while its directory is collapsed, telling the reader whether
// the folded subtree is worth expanding.
const DirectorySummary = ({
  entry,
  badgeForEntry,
}: {
  readonly entry: TreeEntry;
  readonly badgeForEntry: (entry: TreeEntry) => TreeBadge | undefined;
}) => {
  if (entry.kind !== "directory" || entry.children.length === 0) {
    return null;
  }
  const counts = countTreeChanges({ entries: entry.children, badgeForEntry });
  const parts = treeChangeCountsToReact(counts);
  if (parts.length === 0) {
    return null;
  }
  return (
    <span className="file-tree-dir-summary items-center gap-1 font-sans text-2xs font-semibold">
      {parts}
    </span>
  );
};

// A server-rendered but hidden control; the live review application reveals
// it, so inert documents stay fully expanded with no dead affordance.
// Rows without a toggle (files and childless directories) carry an equally
// hidden spacer revealed at the same time, so revealing the chevrons never
// pushes foldable rows a full chevron out of column with their siblings. The
// spacer is deliberately 6px narrower than the chevron: a slight outdent
// keeps files from reading as over-indented under their folder rows.
const DirectoryToggle = ({
  entry,
  name,
}: {
  readonly entry: TreeEntry;
  readonly name: string;
}) =>
  entry.kind !== "directory" || entry.children.length === 0 ? (
    <span
      className="file-tree-toggle-spacer inline-flex w-2 shrink-0"
      hidden
      data-tree-toggle-spacer=""
    />
  ) : (
    <button
      type="button"
      className="file-tree-toggle inline-flex cursor-pointer border-0 bg-transparent p-0 text-muted hover:text-ink [&>svg]:size-3.5 [&>svg]:shrink-0"
      aria-label={`Collapse ${name}`}
      aria-expanded="true"
      hidden
      data-tree-toggle=""
    >
      {lucideIconToReact({ icon: CHEVRON_RIGHT_ICON, hidden: false })}
    </button>
  );

const FoldButton = ({
  action,
  label,
  icon,
  tone,
}: {
  readonly action: "collapse" | "expand";
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone: TreeFoldTone;
}) => (
  <button
    type="button"
    className={`file-tree-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 transition-colors hover:bg-transparent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5 ${FOLD_TONE_CLASSES[tone]}`}
    aria-label={label}
    data-tooltip={label}
    hidden
    data-tree-fold={action}
    data-size="xs"
    data-slot="button"
    data-variant="ghost"
  >
    {lucideIconToReact({ icon, hidden: false })}
  </button>
);

/** Renders the collapse-all and expand-all folding controls in one tone. */
export const TreeFoldControls = ({ tone }: { readonly tone: TreeFoldTone }) => (
  <>
    <FoldButton
      action="collapse"
      label="Collapse all folders"
      icon={COPY_MINUS_ICON}
      tone={tone}
    />
    <FoldButton
      action="expand"
      label="Expand all folders"
      icon={COPY_PLUS_ICON}
      tone={tone}
    />
  </>
);

const entryIcon = ({
  entry,
  badge,
}: {
  readonly entry: TreeEntry;
  readonly badge: TreeBadge | undefined;
}): ReactNode => {
  if (entry.kind === "directory") {
    return lucideIconToReact({ icon: FOLDER_ICON, hidden: false });
  }
  const status = badge === undefined ? undefined : STATUS_ICONS[badge];
  return lucideIconToReact({ icon: status ?? FILE_ICON, hidden: false });
};

const NoteElement = ({
  entry,
  noteDisplay,
}: {
  readonly entry: TreeEntry;
  readonly noteDisplay: TreeNoteDisplay;
}) => {
  if (entry.note === undefined) {
    return null;
  }
  if (noteDisplay === "inline") {
    return (
      <span className="file-tree-note font-sans text-xs text-muted">
        {`- ${entry.note}`}
      </span>
    );
  }
  // A note is prose, so it gets the shell's hover popover rather than the
  // header controls' one-line hint: the viewer script floats it beside the
  // glyph and out of this row's horizontal scroll container, and without
  // scripts the same disclosure still opens the note in place.
  return (
    <details className="file-tree-note-hint group" data-info-popover>
      <summary className="inline-flex translate-y-px cursor-help text-muted group-open:text-ink hover:text-ink [&>svg]:size-3 [&>svg]:shrink-0">
        {lucideIconToReact({ icon: MESSAGE_SQUARE_ICON, hidden: false })}
        <span className="sr-only">{"Note"}</span>
      </summary>
      <div
        className="file-tree-note-body font-sans text-xs whitespace-normal text-muted"
        data-info-popover-body
      >
        {entry.note}
      </div>
    </details>
  );
};

const EntryRow = ({
  entry,
  name,
  badge,
  noteDisplay,
  badgeForEntry,
}: {
  readonly entry: TreeEntry;
  readonly name: string;
  readonly badge: TreeBadge | undefined;
  readonly noteDisplay: TreeNoteDisplay;
  readonly badgeForEntry: (entry: TreeEntry) => TreeBadge | undefined;
}) => (
  <div
    className="file-tree-row relative flex min-h-6 items-center gap-1.5 whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0"
    data-tree-entry={entry.kind}
    {...(badge === undefined ? {} : { "data-tree-badge": badge })}
  >
    <DirectoryToggle entry={entry} name={name} />
    {entryIcon({ entry, badge })}
    <span
      className={[
        "file-tree-name",
        // The ink utility would beat the stylesheet's status tint, so
        // badged names leave their color to the badge rules.
        ...(badge === undefined ? ["text-ink"] : []),
        ...(entry.kind === "directory" ? ["font-semibold"] : []),
      ].join(" ")}
    >
      {name}
    </span>
    {badge === undefined ? null : (
      <span className="file-tree-label font-sans text-2xs font-semibold">
        {BADGE_LABELS[badge]}
      </span>
    )}
    <NoteElement entry={entry} noteDisplay={noteDisplay} />
    <DirectorySummary entry={entry} badgeForEntry={badgeForEntry} />
  </div>
);

/** Recursively renders entries with caller-selected display names and badges. */
export const TreeHierarchy = ({
  entries,
  nameForEntry,
  badgeForEntry,
  noteDisplay,
  nested = false,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly nameForEntry: (entry: TreeEntry) => string;
  readonly badgeForEntry: (entry: TreeEntry) => TreeBadge | undefined;
  readonly noteDisplay: TreeNoteDisplay;
  readonly nested?: boolean;
}) => (
  <ul
    className={
      nested
        ? "file-tree-children m-0 ml-2 list-none border-l border-edge pl-4"
        : "file-tree-list m-0 min-w-max list-none p-0"
    }
  >
    {entries.map((entry, index) => (
      <li key={`${index}-${entry.name}`} className="file-tree-item m-0 p-0">
        <EntryRow
          entry={entry}
          name={nameForEntry(entry)}
          badge={badgeForEntry(entry)}
          noteDisplay={noteDisplay}
          badgeForEntry={badgeForEntry}
        />
        {entry.children.length === 0 ? null : (
          <TreeHierarchy
            entries={entry.children}
            nameForEntry={nameForEntry}
            badgeForEntry={badgeForEntry}
            noteDisplay={noteDisplay}
            nested
          />
        )}
      </li>
    ))}
  </ul>
);
