// Renders CodeDiff's file caption, line-count summary, view selector, copy
// actions, and full-screen control as one self-contained HAST header.

import type { Element, Text } from "hast";
import { COLUMNS_ICON } from "../../../icons/lucide/columns-2.js";
import { COPY_ICON } from "../../../icons/lucide/copy.js";
import { ELLIPSIS_ICON } from "../../../icons/lucide/ellipsis.js";
import { FILE_ICON } from "../../../icons/lucide/file.js";
import { MAXIMIZE_ICON } from "../../../icons/lucide/maximize-2.js";
import { MINIMIZE_ICON } from "../../../icons/lucide/minimize-2.js";
import { ROWS_ICON } from "../../../icons/lucide/rows-2.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";

const BUTTON_CLASSES =
  "code-diff-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
const HEADER_CLASSES =
  "code-diff-header flex min-w-0 items-center justify-between gap-3 border-b border-edge px-[0.55rem] py-[0.3rem]";
const FILE_CLASSES =
  "code-diff-file flex min-w-0 items-center gap-[0.45rem] [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted";
const STATS_CLASSES =
  "code-diff-stats inline-flex shrink-0 gap-[0.4rem] text-xs font-semibold";
const MENU_LIST_CLASSES =
  "code-diff-menu-list absolute top-[calc(100%+0.25rem)] right-0 z-10 min-w-36 rounded-[0.375rem] border border-edge p-1";
const MENU_ITEM_CLASSES =
  "code-diff-menu-item flex w-full cursor-pointer items-center gap-[0.45rem] whitespace-nowrap rounded-sm border-0 bg-transparent px-2 py-[0.3rem] text-left text-xs text-ink [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted";

const text = (value: string): Text => ({ type: "text", value });

const menuItemButton = ({
  action,
  label,
}: {
  readonly action: "copy-path" | "copy";
  readonly label: string;
}): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: MENU_ITEM_CLASSES.split(" "),
    role: "menuitem",
    tabIndex: -1,
    [`data-diff-${action}`]: "",
  },
  children: [
    renderLucideIcon({ icon: COPY_ICON, name: "copy", hidden: false }),
    text(label),
  ],
});

// Header summary of the parsed diff; authors opt in per block via the
// showLineCounts shorthand attribute.
const diffStats = ({
  addedCount,
  removedCount,
}: {
  readonly addedCount: number;
  readonly removedCount: number;
}): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: STATS_CLASSES.split(" "),
  },
  children: [
    {
      type: "element",
      tagName: "span",
      properties: { className: ["sr-only"] },
      children: [text(`${addedCount} added, ${removedCount} removed`)],
    },
    {
      type: "element",
      tagName: "span",
      properties: {
        className: ["code-diff-stat-add"],
        ariaHidden: "true",
      },
      children: [text(`+${addedCount}`)],
    },
    {
      type: "element",
      tagName: "span",
      properties: {
        className: ["code-diff-stat-remove"],
        ariaHidden: "true",
      },
      children: [text(`-${removedCount}`)],
    },
  ],
});

// Copy actions live behind one overflow menu instead of dedicated buttons,
// keeping the header calm as actions accumulate.
// Feedback appears above the actions button so it never covers the diff or
// shifts the controls, and it inverts the palette for contrast.
const copyFeedbackChip = (): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: [
      "code-copy-message",
      "absolute",
      "bottom-[calc(100%+0.25rem)]",
      "right-0",
      "z-10",
      "rounded-[0.375rem]",
      "bg-ink",
      "px-2",
      "py-1",
      "text-xs",
      "text-paper",
      "whitespace-nowrap",
      "shadow-md",
    ],
    ariaHidden: "true",
    "data-diff-copy-message": "",
    hidden: true,
  },
  children: [text("Copied!")],
});

const actionsMenu = (): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: ["code-diff-menu", "relative", "inline-flex"],
    "data-diff-menu": "",
  },
  children: [
    copyFeedbackChip(),
    {
      type: "element",
      tagName: "button",
      properties: {
        type: "button",
        className: BUTTON_CLASSES.split(" "),
        ariaLabel: "More actions",
        ariaHasPopup: "menu",
        ariaExpanded: "false",
        title: "More actions",
        hidden: true,
        "data-diff-menu-button": "",
        "data-size": "xs",
        "data-slot": "button",
        "data-variant": "ghost",
      },
      children: [
        renderLucideIcon({
          icon: ELLIPSIS_ICON,
          name: "ellipsis",
          hidden: false,
        }),
      ],
    },
    {
      type: "element",
      tagName: "div",
      properties: {
        className: MENU_LIST_CLASSES.split(" "),
        role: "menu",
        ariaLabel: "Diff actions",
        hidden: true,
        "data-diff-menu-list": "",
      },
      children: [
        menuItemButton({ action: "copy-path", label: "Copy path" }),
        menuItemButton({ action: "copy", label: "Copy diff" }),
      ],
    },
  ],
});

// One pressed segment per view keeps the current state and the alternative
// visible at once; a single flipping button hid which mode was active.
const viewToggleButton = ({
  view,
  pressed,
  label,
  icon,
  iconName,
}: {
  readonly view: "unified" | "split";
  readonly pressed: boolean;
  readonly label: string;
  readonly icon: typeof COLUMNS_ICON;
  readonly iconName: string;
}): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: BUTTON_CLASSES.split(" "),
    ariaLabel: label,
    ariaPressed: pressed ? "true" : "false",
    title: label,
    "data-diff-set-view": view,
    "data-size": "xs",
    "data-slot": "button",
    "data-variant": "ghost",
  },
  children: [renderLucideIcon({ icon, name: iconName, hidden: false })],
});

// Opens the block alone in a near-full-screen modal dialog; the browser
// script moves the figure rather than cloning it, so state survives.
const expandControlButton = (): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: BUTTON_CLASSES.split(" "),
    ariaLabel: "View diff full screen",
    title: "View diff full screen",
    hidden: true,
    "data-diff-expand": "",
    "data-size": "xs",
    "data-slot": "button",
    "data-variant": "ghost",
  },
  children: [
    renderLucideIcon({
      icon: MAXIMIZE_ICON,
      name: "maximize-2",
      hidden: false,
    }),
    renderLucideIcon({ icon: MINIMIZE_ICON, name: "minimize-2", hidden: true }),
  ],
});

const viewToggleGroup = (): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: [
      "code-diff-toggle-group",
      "inline-flex",
      "overflow-hidden",
      "rounded-[0.375rem]",
      "border",
      "border-edge",
    ],
    role: "group",
    ariaLabel: "Diff view",
    hidden: true,
    "data-diff-toggle-group": "",
  },
  children: [
    viewToggleButton({
      view: "unified",
      pressed: true,
      label: "Unified view",
      icon: ROWS_ICON,
      iconName: "rows-2",
    }),
    viewToggleButton({
      view: "split",
      pressed: false,
      label: "Side-by-side view",
      icon: COLUMNS_ICON,
      iconName: "columns-2",
    }),
  ],
});

/** Renders the complete CodeDiff caption and progressive controls. */
export const renderCodeDiffHeader = ({
  filePath,
  addedCount,
  removedCount,
  showLineCounts,
}: {
  readonly filePath: string;
  readonly addedCount: number;
  readonly removedCount: number;
  readonly showLineCounts: boolean;
}): Element => {
  const lastSlashIndex = filePath.lastIndexOf("/");
  const fileDir =
    lastSlashIndex === -1 ? "" : filePath.slice(0, lastSlashIndex + 1);
  const fileName =
    lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);

  return {
    type: "element",
    tagName: "figcaption",
    properties: { className: HEADER_CLASSES.split(" ") },
    children: [
      {
        type: "element",
        tagName: "span",
        // The explicit label keeps the block's accessible name (also
        // referenced by the full-screen dialog) the exact file path,
        // independent of the styled dir/name split below.
        properties: {
          className: FILE_CLASSES.split(" "),
          ariaLabel: filePath,
        },
        children: [
          renderLucideIcon({
            icon: FILE_ICON,
            name: "file",
            hidden: false,
          }),
          {
            type: "element",
            tagName: "span",
            properties: {
              className: ["code-diff-file-path", "min-w-0", "truncate"],
            },
            children: [
              ...(fileDir === ""
                ? []
                : [
                    {
                      type: "element" as const,
                      tagName: "span",
                      properties: {
                        className: ["code-diff-file-dir", "text-muted"],
                      },
                      children: [text(fileDir)],
                    },
                  ]),
              {
                type: "element",
                tagName: "span",
                properties: {
                  className: [
                    "code-diff-file-name",
                    "font-semibold",
                    "text-ink",
                  ],
                },
                children: [text(fileName)],
              },
            ],
          },
        ],
      },
      {
        type: "element",
        tagName: "span",
        properties: {
          className: [
            "code-diff-controls",
            "flex",
            "shrink-0",
            "items-center",
            "gap-1",
          ],
        },
        children: [
          ...(showLineCounts ? [diffStats({ addedCount, removedCount })] : []),
          viewToggleGroup(),
          actionsMenu(),
          // Far right so entering and leaving full screen live in the same
          // corner of the block.
          expandControlButton(),
        ],
      },
    ],
  };
};
