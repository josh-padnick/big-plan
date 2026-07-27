// Renders the semantic nested-list hierarchy shared by FileTree and every
// FileTreeDiff view, parameterized by displayed names and change markers.

import type { Element, Text } from "hast";
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
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import type { LucideIcon } from "../../../icons/lucide-icon.js";
import { countTreeChanges } from "../../../../model/derive-tree-view.js";
import type { TreeChangeCounts } from "../../../../model/derive-tree-view.js";
import type {
  TreeBadge,
  TreeEntry,
} from "../../../../model/parse-tree-text.js";

// How an entry's authored note reaches the reader: FileTree keeps notes in
// the row because they are its content, while FileTreeDiff keeps rows
// status-first and tucks each note behind a hoverable comment hint.
export type TreeNoteDisplay = "inline" | "hint";

const LIST_CLASSES = "file-tree-list m-0 min-w-max list-none p-0";
const CHILD_LIST_CLASSES =
  "file-tree-children m-0 ml-[0.45rem] list-none border-l border-edge pl-[1.05rem]";
const ROW_CLASSES =
  "file-tree-row relative flex min-h-6 items-center gap-[0.35rem] whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0";
const TOGGLE_CLASSES =
  "file-tree-toggle inline-flex cursor-pointer border-0 bg-transparent p-0 text-muted hover:text-ink [&>svg]:size-3.5 [&>svg]:shrink-0";
const FOLD_BUTTON_CLASSES =
  "file-tree-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 p-0 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
// The quiet tone keeps pane-bar fold-alls discoverable without competing
// with the trees; the header pair keeps standard contrast beside its
// neighboring controls. Hover restores full contrast either way.
const FOLD_TONE_CLASSES: Readonly<Record<TreeFoldTone, string>> = {
  standard: "bg-surface text-muted",
  quiet: "bg-transparent text-muted/50",
};

export type TreeFoldTone = "standard" | "quiet";

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

const text = (value: string): Text => ({ type: "text", value });

const COUNT_SIGILS: ReadonlyArray<
  readonly [keyof TreeChangeCounts, string, string]
> = [
  ["added", "+", "file-tree-sum-added"],
  ["modified", "~", "file-tree-sum-modified"],
  ["removed", "-", "file-tree-sum-removed"],
  ["renamed", "->", "file-tree-sum-renamed"],
];

/** Renders one compact colored count per non-zero change kind. */
export const renderTreeChangeCounts = (
  counts: TreeChangeCounts,
): ReadonlyArray<Element> =>
  COUNT_SIGILS.flatMap(([kind, sigil, className]) =>
    counts[kind] === 0
      ? []
      : [
          {
            type: "element" as const,
            tagName: "span",
            properties: { className: [className] },
            children: [text(`${sigil}${counts[kind]}`)],
          },
        ],
  );

// Only visible while its directory is collapsed, telling the reader whether
// the folded subtree is worth expanding.
const directorySummary = ({
  entry,
  badgeForEntry,
}: {
  readonly entry: TreeEntry;
  readonly badgeForEntry: (entry: TreeEntry) => TreeBadge | undefined;
}): ReadonlyArray<Element> => {
  if (entry.kind !== "directory" || entry.children.length === 0) {
    return [];
  }
  const counts = countTreeChanges({ entries: entry.children, badgeForEntry });
  const parts = renderTreeChangeCounts(counts);
  if (parts.length === 0) {
    return [];
  }
  return [
    {
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "file-tree-dir-summary",
          "items-center",
          "gap-1",
          "font-sans",
          "text-[0.6875rem]",
          "font-semibold",
        ],
      },
      children: [...parts],
    },
  ];
};

const badgeLabel = (badge: TreeBadge | undefined): ReadonlyArray<Element> =>
  badge === undefined
    ? []
    : [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: [
              "file-tree-label",
              "font-sans",
              "text-[0.6875rem]",
              "font-semibold",
            ],
          },
          children: [text(BADGE_LABELS[badge])],
        },
      ];

// A server-rendered but hidden control; the browser script reveals it, so
// documents without JavaScript stay fully expanded with no dead affordance.
// Rows without a toggle (files and childless directories) carry an equally
// hidden spacer revealed by the same script, so revealing the chevrons never
// pushes foldable rows a full chevron out of column with their siblings. The
// spacer is deliberately 6px narrower than the chevron: a slight outdent
// keeps files from reading as over-indented under their folder rows.
const directoryToggle = ({
  entry,
  name,
}: {
  readonly entry: TreeEntry;
  readonly name: string;
}): ReadonlyArray<Element> =>
  entry.kind !== "directory" || entry.children.length === 0
    ? [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: [
              "file-tree-toggle-spacer",
              "inline-flex",
              "w-2",
              "shrink-0",
            ],
            hidden: true,
            "data-tree-toggle-spacer": "",
          },
          children: [],
        },
      ]
    : [
        {
          type: "element",
          tagName: "button",
          properties: {
            type: "button",
            className: TOGGLE_CLASSES.split(" "),
            ariaLabel: `Collapse ${name}`,
            ariaExpanded: "true",
            hidden: true,
            "data-tree-toggle": "",
          },
          children: [
            renderLucideIcon({ icon: CHEVRON_RIGHT_ICON, hidden: false }),
          ],
        },
      ];

const foldButton = ({
  action,
  label,
  icon,
  tone,
}: {
  readonly action: "collapse" | "expand";
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone: TreeFoldTone;
}): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: [
      ...FOLD_BUTTON_CLASSES.split(" "),
      ...FOLD_TONE_CLASSES[tone].split(" "),
    ],
    ariaLabel: label,
    title: label,
    hidden: true,
    "data-tree-fold": action,
    "data-size": "xs",
    "data-slot": "button",
    "data-variant": "ghost",
  },
  children: [renderLucideIcon({ icon, hidden: false })],
});

/** Renders the collapse-all and expand-all folding controls in one tone. */
export const renderTreeFoldControls = ({
  tone,
}: {
  readonly tone: TreeFoldTone;
}): ReadonlyArray<Element> => [
  foldButton({
    action: "collapse",
    label: "Collapse all folders",
    icon: COPY_MINUS_ICON,
    tone,
  }),
  foldButton({
    action: "expand",
    label: "Expand all folders",
    icon: COPY_PLUS_ICON,
    tone,
  }),
];

const entryIcon = ({
  entry,
  badge,
}: {
  readonly entry: TreeEntry;
  readonly badge: TreeBadge | undefined;
}): Element => {
  if (entry.kind === "directory") {
    return renderLucideIcon({ icon: FOLDER_ICON, hidden: false });
  }
  const status = badge === undefined ? undefined : STATUS_ICONS[badge];
  return renderLucideIcon({ icon: status ?? FILE_ICON, hidden: false });
};

const noteElement = ({
  entry,
  noteDisplay,
}: {
  readonly entry: TreeEntry;
  readonly noteDisplay: TreeNoteDisplay;
}): ReadonlyArray<Element> => {
  if (entry.note === undefined) {
    return [];
  }
  if (noteDisplay === "inline") {
    return [
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["file-tree-note", "font-sans", "text-xs", "text-muted"],
        },
        children: [text(`- ${entry.note}`)],
      },
    ];
  }
  // The title attribute is the no-JavaScript fallback; the browser script
  // upgrades it to an instant tooltip on hover, focus, or tap. The visually
  // hidden text keeps the note in the accessibility tree and in copied
  // selections.
  return [
    {
      type: "element",
      tagName: "button",
      properties: {
        type: "button",
        className: [
          "file-tree-note-hint",
          "inline-flex",
          "cursor-help",
          "border-0",
          "bg-transparent",
          "p-0",
          "text-muted",
          "hover:text-ink",
          "[&>svg]:size-3.5",
          "[&>svg]:shrink-0",
        ],
        title: entry.note,
      },
      children: [
        renderLucideIcon({ icon: MESSAGE_SQUARE_ICON, hidden: false }),
        {
          type: "element",
          tagName: "span",
          properties: { className: ["sr-only"] },
          children: [text(entry.note)],
        },
      ],
    },
  ];
};

const entryRow = ({
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
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ROW_CLASSES.split(" "),
    "data-tree-entry": entry.kind,
    ...(badge === undefined ? {} : { "data-tree-badge": badge }),
  },
  children: [
    ...directoryToggle({ entry, name }),
    entryIcon({ entry, badge }),
    {
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "file-tree-name",
          // The ink utility would beat the stylesheet's status tint, so
          // badged names leave their color to the badge rules.
          ...(badge === undefined ? ["text-ink"] : []),
          ...(entry.kind === "directory" ? ["font-semibold"] : []),
        ],
      },
      children: [text(name)],
    },
    ...badgeLabel(badge),
    ...noteElement({ entry, noteDisplay }),
    ...directorySummary({ entry, badgeForEntry }),
  ],
});

/** Recursively renders entries with caller-selected display names and badges. */
export const renderTreeHierarchy = ({
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
}): Element => ({
  type: "element",
  tagName: "ul",
  properties: {
    className: (nested ? CHILD_LIST_CLASSES : LIST_CLASSES).split(" "),
  },
  children: entries.map((entry) => ({
    type: "element",
    tagName: "li",
    properties: { className: ["file-tree-item", "m-0", "p-0"] },
    children: [
      entryRow({
        entry,
        name: nameForEntry(entry),
        badge: badgeForEntry(entry),
        noteDisplay,
        badgeForEntry,
      }),
      ...(entry.children.length === 0
        ? []
        : [
            renderTreeHierarchy({
              entries: entry.children,
              nameForEntry,
              badgeForEntry,
              noteDisplay,
              nested: true,
            }),
          ]),
    ],
  })),
});
