// Validates CodeDiff's attributes and structural fence contract, then renders
// complete unified and split HAST views without exposing a code decorator target.

import type { Element, ElementContent, Root, Text } from "hast";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import { COPY_ICON } from "../../code-block/code-block-icons.js";
import type { BlockRenderer } from "../registry.js";
import {
  COLUMNS_ICON,
  ELLIPSIS_ICON,
  FILE_ICON,
  MAXIMIZE_ICON,
  MINIMIZE_ICON,
  ROWS_ICON,
} from "./code-diff-icons.js";
import {
  pairDiffLines,
  parseUnifiedDiff,
} from "./parse-unified-diff.js";
import type {
  DiffHunk,
  DiffLine,
  SplitDiffRow,
  UnifiedDiff,
} from "./parse-unified-diff.js";

type NodePosition = Root["position"];

const BUTTON_CLASSES =
  "code-diff-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
const FIGURE_CLASSES =
  "code-diff mb-5 min-w-0 rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]";
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
const HUNK_HEADER_CLASSES =
  "code-diff-hunk-header min-w-max whitespace-pre px-[0.65rem] py-[0.4rem] text-xs";
const LINE_CLASSES = "code-diff-line grid min-w-max whitespace-pre";

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

const isWhitespace = (node: ElementContent): boolean =>
  node.type === "text" && /^\s*$/u.test(node.value);

const languageClasses = (element: Element): ReadonlyArray<string> => {
  const className = element.properties.className;
  if (!Array.isArray(className)) {
    return [];
  }
  return className.filter((value): value is string => typeof value === "string");
};

// Enforces the fence shape before syntax highlighting can split its raw text.
const diffSource = ({
  children,
}: {
  readonly children: ReadonlyArray<ElementContent>;
}): { readonly source?: string; readonly codePosition?: NodePosition } => {
  const meaningful = children.filter((child) => !isWhitespace(child));
  if (meaningful.length !== 1) {
    return {};
  }
  const pre = meaningful[0];
  if (pre === undefined || !isElement(pre) || pre.tagName !== "pre") {
    return {};
  }
  if (pre.children.length !== 1) {
    return {};
  }
  const code = pre.children[0];
  if (
    code === undefined ||
    !isElement(code) ||
    code.tagName !== "code" ||
    !languageClasses(code).includes("language-diff") ||
    code.children.length !== 1
  ) {
    return {};
  }
  const text = code.children[0];
  if (text === undefined || text.type !== "text") {
    return {};
  }
  return { source: text.value, codePosition: code.position };
};

const text = (value: string): Text => ({ type: "text", value });

const lineNumberCell = (value: number | undefined, side: "old" | "new"): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: [
      "code-diff-line-number",
      "select-none",
      "px-[0.55rem]",
      "text-right",
    ],
    ariaHidden: "true",
    "data-diff-number": side,
  },
  children: [text(value === undefined ? "" : String(value))],
});

const accessibleLinePrefix = (line: DiffLine): ReadonlyArray<Element> =>
  line.kind === "context"
    ? []
    : [{
        type: "element",
        tagName: "span",
        properties: { className: ["sr-only"] },
        children: [text(line.kind === "add" ? "Added line: " : "Removed line: ")],
      }];

const lineContent = (line: DiffLine): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: [
      "code-diff-line-content",
      "inline-block",
      "min-w-full",
      "pr-3",
      "pl-[0.45rem]",
    ],
  },
  children: [
    ...accessibleLinePrefix(line),
    text(line.text),
  ],
});

const unifiedLine = ({
  line,
  lineNumbers,
}: {
  readonly line: DiffLine;
  readonly lineNumbers: boolean;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: [...LINE_CLASSES.split(" "), "code-diff-unified-line"],
    "data-diff-line": line.kind,
  },
  children: [
    ...(lineNumbers
      ? [
          lineNumberCell(line.oldLineNumber, "old"),
          lineNumberCell(line.newLineNumber, "new"),
        ]
      : []),
    lineContent(line),
  ],
});

const hunkHeader = (value: string, view: "unified" | "split"): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: HUNK_HEADER_CLASSES.split(" "),
    "data-diff-hunk-header": view,
  },
  children: [text(value)],
});

const renderUnifiedHunk = ({
  hunk,
  lineNumbers,
}: {
  readonly hunk: DiffHunk;
  readonly lineNumbers: boolean;
}): ReadonlyArray<Element> => [
  ...(hunk.header === undefined ? [] : [hunkHeader(hunk.header, "unified")]),
  ...hunk.lines.map((line) => unifiedLine({ line, lineNumbers })),
];

const splitLine = ({
  line,
  side,
  lineNumbers,
}: {
  readonly line: DiffLine | undefined;
  readonly side: "old" | "new";
  readonly lineNumbers: boolean;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: [...LINE_CLASSES.split(" "), "code-diff-split-line"],
    "data-diff-line": line?.kind ?? "empty",
  },
  children: [
    ...(lineNumbers
      ? [lineNumberCell(
          side === "old" ? line?.oldLineNumber : line?.newLineNumber,
          side,
        )]
      : []),
    ...(line === undefined ? [lineContent({ kind: "context", text: "" })] : [lineContent(line)]),
  ],
});

const splitPane = ({
  rows,
  side,
  lineNumbers,
}: {
  readonly rows: ReadonlyArray<SplitDiffRow>;
  readonly side: "old" | "new";
  readonly lineNumbers: boolean;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["code-diff-pane", "min-w-0", "overflow-x-auto"],
    "data-diff-pane": side,
  },
  children: rows.map((row) => splitLine({
    line: side === "old" ? row.left : row.right,
    side,
    lineNumbers,
  })),
});

const renderSplitHunk = ({
  hunk,
  lineNumbers,
}: {
  readonly hunk: DiffHunk;
  readonly lineNumbers: boolean;
}): ReadonlyArray<Element> => {
  const rows = pairDiffLines({ lines: hunk.lines });
  return [
    ...(hunk.header === undefined ? [] : [hunkHeader(hunk.header, "split")]),
    {
      type: "element",
      tagName: "div",
      properties: {
        className: [
          "code-diff-split-hunk",
          "grid",
          "min-w-0",
          "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
        ],
      },
      children: [
        splitPane({ rows, side: "old", lineNumbers }),
        splitPane({ rows, side: "new", lineNumbers }),
      ],
    },
  ];
};

const renderView = ({
  diff,
  view,
  lineNumbers,
}: {
  readonly diff: UnifiedDiff;
  readonly view: "unified" | "split";
  readonly lineNumbers: boolean;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["code-diff-view", "min-w-0"],
    "data-diff-content": view,
  },
  children: diff.hunks.flatMap((hunk) => view === "unified"
    ? renderUnifiedHunk({ hunk, lineNumbers })
    : renderSplitHunk({ hunk, lineNumbers })),
});

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

// Header summary of the parsed diff; authors opt out per block via the
// hideStats shorthand attribute.
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
const actionsMenu = (): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: ["code-diff-menu", "relative", "inline-flex"],
    "data-diff-menu": "",
  },
  children: [
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
        renderLucideIcon({ icon: ELLIPSIS_ICON, name: "ellipsis", hidden: false }),
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
    renderLucideIcon({ icon: MAXIMIZE_ICON, name: "maximize-2", hidden: false }),
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

const emptyDiff: UnifiedDiff = {
  hunks: [{ lines: [] }],
  hasHunkHeaders: false,
};

/** Validates and renders one CodeDiff typed block. */
export const renderCodeDiff: BlockRenderer = ({
  attributes,
  children,
  position,
  diagnostics,
}): Element => {
  const fileValue = attributes["file"];
  if (typeof fileValue !== "string" || fileValue.trim() === "") {
    diagnostics.add({
      message: fileValue === undefined
        ? 'Missing required attribute "file"; expected a string'
        : typeof fileValue !== "string"
          ? 'Attribute "file" must be a string'
          : 'Attribute "file" must be a non-empty string',
      position,
    });
  }
  const lineNumbersValue = attributes["lineNumbers"];
  if (lineNumbersValue !== undefined && lineNumbersValue !== true) {
    diagnostics.add({
      message: 'Attribute "lineNumbers" is a shorthand boolean; use the bare form',
      position,
    });
  }
  const hideStatsValue = attributes["hideStats"];
  if (hideStatsValue !== undefined && hideStatsValue !== true) {
    diagnostics.add({
      message: 'Attribute "hideStats" is a shorthand boolean; use the bare form',
      position,
    });
  }
  for (const name of Object.keys(attributes)) {
    if (name !== "file" && name !== "lineNumbers" && name !== "hideStats") {
      diagnostics.add({ message: `Unknown attribute "${name}" on CodeDiff`, position });
    }
  }

  const extracted = diffSource({ children });
  if (extracted.source === undefined) {
    diagnostics.add({
      message: "CodeDiff expects exactly one fenced code block with language diff and no other content",
      position,
    });
  }
  const source = extracted.source ?? "";
  const parsed = extracted.source === undefined
    ? { diff: emptyDiff, diagnostics: [] }
    : parseUnifiedDiff({ source });
  for (const diagnostic of parsed.diagnostics) {
    const fenceLine = extracted.codePosition?.start.line;
    diagnostics.add({
      message: `Invalid diff line ${diagnostic.line}: ${diagnostic.message}`,
      position: fenceLine === undefined
        ? position
        : {
            start: { line: fenceLine + diagnostic.line, column: 1 },
            end: { line: fenceLine + diagnostic.line, column: 1 },
          },
    });
  }
  const lineNumbers = lineNumbersValue === true;
  if (lineNumbers && !parsed.diff.hasHunkHeaders) {
    diagnostics.add({
      message: "CodeDiff cannot show line numbers without an @@ hunk header",
      position,
    });
  }

  const filePath = typeof fileValue === "string" ? fileValue : "";
  const lastSlashIndex = filePath.lastIndexOf("/");
  const fileDir =
    lastSlashIndex === -1 ? "" : filePath.slice(0, lastSlashIndex + 1);
  const fileName =
    lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);
  const allLines = parsed.diff.hunks.flatMap((hunk) => hunk.lines);
  const addedCount = allLines.filter((line) => line.kind === "add").length;
  const removedCount = allLines.filter((line) => line.kind === "remove").length;

  return {
    type: "element",
    tagName: "figure",
    properties: {
      className: FIGURE_CLASSES.split(" "),
      "data-code-diff": "",
      "data-diff-view": "unified",
      "data-diff-path": filePath,
      ...(lineNumbers ? { "data-line-numbers": "" } : {}),
    },
    children: [
      {
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
              renderLucideIcon({ icon: FILE_ICON, name: "file", hidden: false }),
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
                      className: ["code-diff-file-name", "font-semibold", "text-ink"],
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
              ...(hideStatsValue === true
                ? []
                : [diffStats({ addedCount, removedCount })]),
              {
                type: "element",
                tagName: "span",
                properties: {
                  className: ["code-copy-message", "static", "h-6"],
                  ariaHidden: "true",
                  "data-diff-copy-message": "",
                  hidden: true,
                },
                children: [text("Copied!")],
              },
              viewToggleGroup(),
              actionsMenu(),
              // Far right so entering and leaving full screen live in the
              // same corner of the block.
              expandControlButton(),
            ],
          },
        ],
      },
      renderView({ diff: parsed.diff, view: "unified", lineNumbers }),
      renderView({ diff: parsed.diff, view: "split", lineNumbers }),
      {
        type: "element",
        tagName: "textarea",
        properties: {
          hidden: true,
          readOnly: true,
          "data-diff-source": "",
        },
        children: [text(source)],
      },
    ],
  };
};
