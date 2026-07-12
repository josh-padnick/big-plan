// Validates CodeDiff's attributes and structural fence contract, then renders
// complete unified and split HAST views without exposing a code decorator target.

import type { Element, ElementContent, Root, Text } from "hast";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import {
  CHECK_ICON,
  COPY_ICON,
} from "../../code-block/code-block-icons.js";
import type { BlockRenderer } from "../registry.js";
import {
  COLUMNS_ICON,
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
  "code-diff-button inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const FIGURE_CLASSES = "code-diff mb-5 min-w-0 overflow-hidden rounded-md border border-edge";

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
    className: ["code-diff-line-number"],
    ariaHidden: "true",
    "data-diff-number": side,
  },
  children: [text(value === undefined ? "" : String(value))],
});

const lineContent = (line: DiffLine): Element => ({
  type: "element",
  tagName: "span",
  properties: { className: ["code-diff-line-content"] },
  children: [text(line.text)],
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
    className: ["code-diff-line", "code-diff-unified-line"],
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
    className: ["code-diff-hunk-header"],
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
    className: ["code-diff-line", "code-diff-split-line"],
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
    className: ["code-diff-pane"],
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
      properties: { className: ["code-diff-split-hunk"] },
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
    className: ["code-diff-view"],
    "data-diff-content": view,
  },
  children: diff.hunks.flatMap((hunk) => view === "unified"
    ? renderUnifiedHunk({ hunk, lineNumbers })
    : renderSplitHunk({ hunk, lineNumbers })),
});

const copyControlButton = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReadonlyArray<Element>;
}): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: BUTTON_CLASSES.split(" "),
    ariaLabel: label,
    ariaLive: "polite",
    title: label,
    hidden: true,
    "data-diff-copy": "",
    "data-size": "xs",
    "data-slot": "button",
    "data-variant": "ghost",
  },
  children: [...children],
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
    className: ["code-diff-toggle-group"],
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
  if (typeof fileValue !== "string") {
    diagnostics.add({
      message: fileValue === undefined
        ? 'Missing required attribute "file"; expected a string'
        : 'Attribute "file" must be a string',
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
  for (const name of Object.keys(attributes)) {
    if (name !== "file" && name !== "lineNumbers") {
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

  const copyButton = copyControlButton({
    label: "Copy diff",
    children: [
      renderLucideIcon({ icon: COPY_ICON, name: "copy", hidden: false }),
      renderLucideIcon({ icon: CHECK_ICON, name: "check", hidden: true }),
    ],
  });
  return {
    type: "element",
    tagName: "figure",
    properties: {
      className: FIGURE_CLASSES.split(" "),
      "data-code-diff": "",
      "data-diff-view": "unified",
      ...(lineNumbers ? { "data-line-numbers": "" } : {}),
    },
    children: [
      {
        type: "element",
        tagName: "figcaption",
        properties: { className: ["code-diff-header"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["code-diff-file"] },
            children: [text(typeof fileValue === "string" ? fileValue : "")],
          },
          {
            type: "element",
            tagName: "span",
            properties: { className: ["code-diff-controls"] },
            children: [
              {
                type: "element",
                tagName: "span",
                properties: {
                  className: ["code-copy-message"],
                  ariaHidden: "true",
                  "data-diff-copy-message": "",
                  hidden: true,
                },
                children: [text("Copied!")],
              },
              viewToggleGroup(),
              copyButton,
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
