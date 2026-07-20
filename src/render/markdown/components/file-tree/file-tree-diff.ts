// Exposes FileTreeDiff's component definition: it renders the combined change
// tree as the server-rendered no-JavaScript view plus the derived before/after
// hierarchy panes that the browser view control reveals.

import type { Element, Text } from "hast";
import { COLUMNS_2_ICON } from "../../../icons/lucide/columns-2.js";
import { MAXIMIZE_2_ICON } from "../../../icons/lucide/maximize-2.js";
import { MINIMIZE_2_ICON } from "../../../icons/lucide/minimize-2.js";
import { ROWS_2_ICON } from "../../../icons/lucide/rows-2.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import type { LucideIcon } from "../../../icons/lucide-icon.js";
import {
  type ComponentDefinition,
  type ComponentRenderer,
} from "../component-contract.js";
import {
  compileFileTreeDiff,
  type CompiledFileTree,
} from "./compile-file-tree.js";
import { deriveTreeView } from "./derive-tree-view.js";
import type { TreeEntry } from "./parse-tree-text.js";
import {
  renderTreeFoldControls,
  renderTreeHierarchy,
} from "./tree-hierarchy.js";

const FIGURE_CLASSES =
  "file-tree file-tree-diff mb-5 min-w-0 overflow-hidden rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]";
const HEADER_CLASSES =
  "file-tree-header file-tree-diff-header flex min-w-0 items-center justify-between gap-3 border-b border-edge px-[0.65rem] py-[0.4rem] font-sans text-sm font-semibold text-ink";
const BODY_CLASSES = "file-tree-body overflow-x-auto px-3 py-2.5";
const BUTTON_CLASSES =
  "file-tree-diff-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";

const text = (value: string): Text => ({ type: "text", value });

const viewToggleButton = ({
  view,
  pressed,
  label,
  icon,
}: {
  readonly view: "combined" | "before-after";
  readonly pressed: boolean;
  readonly label: string;
  readonly icon: LucideIcon;
}): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: BUTTON_CLASSES.split(" "),
    ariaLabel: label,
    ariaPressed: pressed ? "true" : "false",
    title: label,
    "data-tree-set-view": view,
    "data-size": "xs",
    "data-slot": "button",
    "data-variant": "ghost",
  },
  children: [renderLucideIcon({ icon, hidden: false })],
});

const viewToggleGroup = (): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: [
      "file-tree-diff-toggle-group",
      "inline-flex",
      "shrink-0",
      "overflow-hidden",
      "rounded-[0.375rem]",
      "border",
      "border-edge",
    ],
    role: "group",
    ariaLabel: "File tree diff view",
    hidden: true,
    "data-tree-toggle-group": "",
  },
  children: [
    viewToggleButton({
      view: "combined",
      pressed: true,
      label: "Combined view",
      icon: ROWS_2_ICON,
    }),
    viewToggleButton({
      view: "before-after",
      pressed: false,
      label: "Before/After view",
      icon: COLUMNS_2_ICON,
    }),
  ],
});

const titleContent = (title: string | undefined): ReadonlyArray<Element> =>
  title === undefined
    ? []
    : [
        {
          type: "element",
          tagName: "span",
          properties: { className: ["file-tree-diff-title", "truncate"] },
          children: [text(title)],
        },
      ];

// Full screen stays unavailable without JavaScript, like the view toggle; the
// server-rendered combined tree needs neither.
const expandButton = (): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: BUTTON_CLASSES.split(" "),
    ariaLabel: "View file tree full screen",
    title: "View file tree full screen",
    hidden: true,
    "data-tree-expand": "",
    "data-size": "xs",
    "data-slot": "button",
    "data-variant": "ghost",
  },
  children: [
    renderLucideIcon({ icon: MAXIMIZE_2_ICON, hidden: false }),
    renderLucideIcon({ icon: MINIMIZE_2_ICON, hidden: true }),
  ],
});

const header = (title: string | undefined): Element => ({
  type: "element",
  tagName: "figcaption",
  properties: {
    className: HEADER_CLASSES.split(" "),
    ...(title === undefined ? { "data-tree-header-without-title": "" } : {}),
  },
  children: [
    ...titleContent(title),
    {
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "file-tree-diff-controls",
          "flex",
          "shrink-0",
          "items-center",
          "gap-1",
        ],
      },
      children: [
        ...renderTreeFoldControls(),
        viewToggleGroup(),
        expandButton(),
      ],
    },
  ],
});

const combinedName = (entry: TreeEntry): string =>
  entry.oldName === undefined
    ? entry.name
    : `${entry.oldName} -> ${entry.name}`;

const combinedView = (entries: ReadonlyArray<TreeEntry>): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: BODY_CLASSES.split(" "),
    "data-tree-content": "combined",
  },
  children: [
    renderTreeHierarchy({
      noteDisplay: "hint",
      entries,
      nameForEntry: combinedName,
      badgeForEntry: (entry) => entry.badge,
    }),
  ],
});

const CHANGES_TOGGLE_CLASSES =
  "file-tree-changes-toggle inline-flex h-6 shrink-0 cursor-pointer items-center rounded-[0.375rem] border border-edge bg-surface px-2 font-sans text-[0.6875rem] font-semibold text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

// The toggle lives in the After caption because only that pane has two
// truths to switch between: the annotated change set and the plain final
// state the plan produces.
const showDiffToggle = (): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: CHANGES_TOGGLE_CLASSES.split(" "),
    ariaPressed: "true",
    hidden: true,
    "data-tree-changes-toggle": "",
    "data-size": "xs",
    "data-slot": "button",
    "data-variant": "ghost",
  },
  children: [text("Show diff")],
});

const paneBody = ({
  entries,
  variant,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly variant?: "diff" | "plain";
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: BODY_CLASSES.split(" "),
    ...(variant === undefined ? {} : { "data-tree-after-variant": variant }),
  },
  children: [
    renderTreeHierarchy({
      noteDisplay: "hint",
      entries,
      nameForEntry: (entry) => entry.name,
      badgeForEntry: (entry) => entry.badge,
    }),
  ],
});

const statePane = ({
  entries,
  afterPlainEntries = [],
  side,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly afterPlainEntries?: ReadonlyArray<TreeEntry>;
  readonly side: "before" | "after";
}): Element => ({
  type: "element",
  tagName: "section",
  properties: {
    className: [
      "file-tree-diff-pane",
      "min-w-0",
      ...(side === "after"
        ? ["border-t", "border-edge", "wide:border-t-0", "wide:border-l"]
        : []),
    ],
    ariaLabel: side === "before" ? "Before" : "After",
    "data-tree-pane": side,
  },
  children: [
    {
      type: "element",
      tagName: "div",
      properties: {
        className: [
          "file-tree-diff-pane-caption",
          "flex",
          "min-w-0",
          "items-center",
          "justify-between",
          "gap-2",
          "border-b",
          "border-edge",
          "px-3",
          "py-1.5",
          "font-sans",
          "text-xs",
          "font-semibold",
          "text-muted",
        ],
      },
      children: [
        text(side === "before" ? "Before" : "After"),
        ...(side === "after" ? [showDiffToggle()] : []),
      ],
    },
    ...(side === "before"
      ? [paneBody({ entries })]
      : [
          paneBody({ entries, variant: "diff" }),
          paneBody({ entries: afterPlainEntries, variant: "plain" }),
        ]),
  ],
});

const beforeAfterView = (entries: ReadonlyArray<TreeEntry>): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: [
      "file-tree-diff-before-after",
      "min-w-0",
      "grid-cols-[minmax(0,1fr)]",
      "wide:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
    ],
    "data-tree-content": "before-after",
  },
  children: [
    statePane({
      entries: deriveTreeView({ entries, side: "before" }),
      side: "before",
    }),
    statePane({
      entries: deriveTreeView({ entries, side: "after" }),
      afterPlainEntries: deriveTreeView({
        entries,
        side: "after",
        showChanges: false,
      }),
      side: "after",
    }),
  ],
});

const renderFileTreeDiffFigure = ({
  model,
}: {
  readonly model: CompiledFileTree;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    className: FIGURE_CLASSES.split(" "),
    "data-file-tree-diff": "",
    "data-tree-view": "combined",
    "data-tree-changes": "shown",
  },
  children: [
    header(model.title),
    combinedView(model.entries),
    beforeAfterView(model.entries),
  ],
});

/** Compiles and renders one FileTreeDiff component. */
export const renderFileTreeDiff: ComponentRenderer = (input) =>
  renderFileTreeDiffFigure({ model: compileFileTreeDiff(input) });

/** Declares FileTreeDiff's complete component integration contract. */
export const FILE_TREE_DIFF_COMPONENT_DEFINITION = {
  render: renderFileTreeDiff,
} satisfies ComponentDefinition;
