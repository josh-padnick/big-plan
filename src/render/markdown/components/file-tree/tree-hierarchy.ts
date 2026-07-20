// Renders the semantic nested-list hierarchy shared by FileTree and every
// FileTreeDiff view, parameterized by displayed names and change markers.

import type { Element, Text } from "hast";
import { FILE_DIFF_ICON } from "../../../icons/lucide/file-diff.js";
import { FILE_MINUS_2_ICON } from "../../../icons/lucide/file-minus-2.js";
import { FILE_PLUS_2_ICON } from "../../../icons/lucide/file-plus-2.js";
import { FILE_SYMLINK_ICON } from "../../../icons/lucide/file-symlink.js";
import { FILE_ICON } from "../../../icons/lucide/file.js";
import { FOLDER_ICON } from "../../../icons/lucide/folder.js";
import { MESSAGE_SQUARE_ICON } from "../../../icons/lucide/message-square.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import type { LucideIcon } from "../../../icons/lucide-icon.js";
import type { TreeBadge, TreeEntry } from "./parse-tree-text.js";

// How an entry's authored note reaches the reader: FileTree keeps notes in
// the row because they are its content, while FileTreeDiff keeps rows
// status-first and tucks each note behind a hoverable comment hint.
export type TreeNoteDisplay = "inline" | "hint";

const LIST_CLASSES = "file-tree-list m-0 min-w-max list-none p-0";
const CHILD_LIST_CLASSES =
  "file-tree-children m-0 ml-[0.45rem] list-none border-l border-edge pl-[1.05rem]";
const ROW_CLASSES =
  "file-tree-row relative flex min-h-6 items-center gap-[0.45rem] whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0";

// Statuses read the way git tooling presents them: a changed file's leading
// glyph becomes its status icon (the Lucide file-plus-2 family standing in
// for GitHub's per-change file icons), the name carries the change tint with
// deletions struck through, and the spelled-out status sits at the row's far
// edge.
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
              "ml-auto",
              "pl-6",
              "font-sans",
              "text-[0.6875rem]",
              "font-semibold",
            ],
          },
          children: [text(BADGE_LABELS[badge])],
        },
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
}: {
  readonly entry: TreeEntry;
  readonly name: string;
  readonly badge: TreeBadge | undefined;
  readonly noteDisplay: TreeNoteDisplay;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ROW_CLASSES.split(" "),
    "data-tree-entry": entry.kind,
    ...(badge === undefined ? {} : { "data-tree-badge": badge }),
  },
  children: [
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
    ...noteElement({ entry, noteDisplay }),
    ...badgeLabel(badge),
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
