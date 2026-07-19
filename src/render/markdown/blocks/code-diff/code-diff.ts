// Validates CodeDiff's fence and scoped Annotation contract, then renders
// complete unified and split HAST views while consuming the source diff before
// decoration.

import type { Element, ElementContent, Root, Text } from "hast";
import type { Nodes as MarkdownNode, Root as MarkdownRoot } from "mdast";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import {
  validateBlockAttributes,
  type BlockAttributeSchema,
  type BlockRenderer,
  type ScopedChild,
} from "../registry.js";
import type { DiagnosticCollector } from "../diagnostics.js";
import { COLUMNS_ICON } from "../../../icons/lucide/columns-2.js";
import { COPY_ICON } from "../../../icons/lucide/copy.js";
import { ELLIPSIS_ICON } from "../../../icons/lucide/ellipsis.js";
import { FILE_ICON } from "../../../icons/lucide/file.js";
import { MAXIMIZE_ICON } from "../../../icons/lucide/maximize-2.js";
import { MESSAGE_SQUARE_ICON } from "../../../icons/lucide/message-square.js";
import { MINIMIZE_ICON } from "../../../icons/lucide/minimize-2.js";
import { ROWS_ICON } from "../../../icons/lucide/rows-2.js";
import { pairDiffLines, parseUnifiedDiff } from "./parse-unified-diff.js";
import type {
  DiffHunk,
  DiffLine,
  SplitDiffRow,
  UnifiedDiff,
} from "./parse-unified-diff.js";

type NodePosition = Root["position"];
type DiffSide = "old" | "new";

const CODE_DIFF_SCHEMA = {
  file: { kind: "string", required: true, nonEmpty: true },
  showLineNumbers: { kind: "booleanShorthand" },
  showLineCounts: { kind: "booleanShorthand" },
} satisfies BlockAttributeSchema;

const ANNOTATION_SCHEMA = {
  side: {
    kind: "enum",
    values: ["old", "new"] satisfies ReadonlyArray<DiffSide>,
  },
} satisfies BlockAttributeSchema;

type Annotation = {
  readonly lines: string;
  readonly startLine: bigint;
  readonly endLine: bigint;
  readonly side: DiffSide;
  readonly children: ReadonlyArray<ElementContent>;
  readonly position: NodePosition;
};

type AnchoredAnnotation = Annotation & {
  readonly id: string;
  readonly target: DiffLine;
};

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
const ANNOTATION_SURROUND_CLASSES =
  "code-diff-annotation-surround min-w-0 border-l-4 p-[0.35rem]";
const ANNOTATION_CLASSES =
  "code-diff-annotation flex min-w-0 gap-2 px-3 py-2 font-sans text-sm leading-normal whitespace-normal [&>svg]:size-4 [&>svg]:shrink-0";

const markdownChildren = (
  node: MarkdownRoot | MarkdownNode,
): ReadonlyArray<MarkdownNode> => ("children" in node ? node.children : []);

// Reports content that cannot be cloned safely into both diff views.
const validateAnnotationBody = ({
  node,
  diagnostics,
  registeredBlockNames,
}: {
  readonly node: MarkdownNode;
  readonly diagnostics: DiagnosticCollector;
  readonly registeredBlockNames: ReadonlySet<string>;
}): void => {
  const isTypedBlock =
    node.type === "mdxJsxFlowElement" &&
    node.name !== null &&
    registeredBlockNames.has(node.name);
  const message =
    node.type === "heading"
      ? "Annotation bodies cannot contain headings"
      : node.type === "footnoteReference"
        ? "Annotation bodies cannot contain footnote references"
        : node.type === "footnoteDefinition"
          ? "Annotation bodies cannot contain footnote definitions"
          : isTypedBlock
            ? "Annotation bodies cannot contain typed blocks"
            : undefined;
  if (message !== undefined) {
    diagnostics.add({ message, position: node.position });
  }
  if (isTypedBlock) {
    return;
  }
  for (const child of markdownChildren(node)) {
    validateAnnotationBody({ node: child, diagnostics, registeredBlockNames });
  }
};

// Finds direct Annotation children under CodeDiff while preserving ordinary
// Markdown nesting elsewhere in the document.
const validateAnnotationBodies = ({
  node,
  diagnostics,
  registeredBlockNames,
}: {
  readonly node: MarkdownRoot | MarkdownNode;
  readonly diagnostics: DiagnosticCollector;
  readonly registeredBlockNames: ReadonlySet<string>;
}): void => {
  if (node.type === "mdxJsxFlowElement" && node.name === "CodeDiff") {
    for (const child of node.children) {
      if (child.type === "mdxJsxFlowElement" && child.name === "Annotation") {
        for (const bodyChild of child.children) {
          validateAnnotationBody({
            node: bodyChild,
            diagnostics,
            registeredBlockNames,
          });
        }
        continue;
      }
      validateAnnotationBodies({
        node: child,
        diagnostics,
        registeredBlockNames,
      });
    }
    return;
  }
  for (const child of markdownChildren(node)) {
    validateAnnotationBodies({
      node: child,
      diagnostics,
      registeredBlockNames,
    });
  }
};

/** Creates the remark transform that validates Annotation body semantics. */
export const remarkValidateCodeDiffAnnotations =
  ({
    diagnostics,
    registeredBlockNames,
  }: {
    readonly diagnostics: DiagnosticCollector;
    readonly registeredBlockNames: ReadonlySet<string>;
  }) =>
  (tree: MarkdownRoot): void => {
    validateAnnotationBodies({
      node: tree,
      diagnostics,
      registeredBlockNames,
    });
  };

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

const isWhitespace = (node: ElementContent): boolean =>
  node.type === "text" && /^\s*$/u.test(node.value);

const languageClasses = (element: Element): ReadonlyArray<string> => {
  const className = element.properties.className;
  if (!Array.isArray(className)) {
    return [];
  }
  return className.filter(
    (value): value is string => typeof value === "string",
  );
};

// Enforces the fence shape before syntax highlighting can split its raw text.
const diffFenceSource = ({
  children,
}: {
  readonly children: ReadonlyArray<ElementContent>;
}): { readonly source?: string; readonly codePosition?: NodePosition } => {
  if (children.length !== 1) {
    return {};
  }
  const pre = children[0];
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

type LineRange = {
  readonly start: bigint;
  readonly end: bigint;
};

// Accepts canonical positive integers and strictly ascending inclusive ranges.
const parseLineRange = (value: string): LineRange | undefined => {
  const match = /^(?<start>[1-9]\d*)(?:-(?<end>[1-9]\d*))?$/u.exec(value);
  const startValue = match?.groups?.["start"];
  const endValue = match?.groups?.["end"];
  if (startValue === undefined) {
    return undefined;
  }
  const start = BigInt(startValue);
  const end = endValue === undefined ? start : BigInt(endValue);
  if (endValue !== undefined && end <= start) {
    return undefined;
  }
  return { start, end };
};

// CodeDiff owns Annotation's attribute vocabulary and values because the
// scoped name has no meaning outside this parent contract.
const annotationFromScopedChild = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: Parameters<BlockRenderer>[0]["diagnostics"];
}): Annotation | undefined => {
  const linesValue = child.attributes["lines"];
  const range =
    typeof linesValue === "string" ? parseLineRange(linesValue) : undefined;
  if (range === undefined) {
    diagnostics.add({
      message:
        linesValue === undefined
          ? 'Missing required attribute "lines"; expected a positive-integer string or ascending range'
          : 'Attribute "lines" must be a positive-integer string or ascending range',
      position: child.position,
    });
  }

  const { lines: _lines, ...attributes } = child.attributes;
  const validated = validateBlockAttributes({
    block: "Annotation",
    attributes,
    position: child.position,
    diagnostics,
    schema: ANNOTATION_SCHEMA,
  });

  if (
    range === undefined ||
    typeof linesValue !== "string" ||
    (child.attributes["side"] !== undefined && validated.side === undefined)
  ) {
    return undefined;
  }
  return {
    lines: linesValue,
    startLine: range.start,
    endLine: range.end,
    side: validated.side ?? "new",
    children: child.children,
    position: child.position,
  };
};

const text = (value: string): Text => ({ type: "text", value });

const annotationLineLabel = (annotation: Annotation): string =>
  annotation.startLine === annotation.endLine
    ? `Line ${annotation.lines}`
    : `Lines ${annotation.lines}`;

// Each static view gets its own annotation body so downstream Markdown
// transforms can decorate nested content without sharing mutations.
const annotationCard = (annotation: AnchoredAnnotation): Element => ({
  type: "element",
  tagName: "aside",
  properties: {
    className: ANNOTATION_CLASSES.split(" "),
    role: "note",
    ariaLabel: annotationLineLabel(annotation),
    "data-annotation": "",
    "data-annotation-lines": annotation.lines,
    "data-annotation-side": annotation.side,
  },
  children: [
    renderLucideIcon({
      icon: MESSAGE_SQUARE_ICON,
      name: "message-square",
      hidden: false,
    }),
    {
      type: "element",
      tagName: "div",
      properties: { className: ["code-diff-annotation-content", "min-w-0"] },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: [
              "code-diff-annotation-badge",
              "mb-1",
              "inline-flex",
              "rounded-sm",
              "px-1.5",
              "py-0.5",
              "text-xs",
              "font-semibold",
            ],
          },
          children: [text(annotationLineLabel(annotation))],
        },
        {
          type: "element",
          tagName: "div",
          properties: { className: ["code-diff-annotation-body"] },
          children: [...structuredClone(annotation.children)],
        },
      ],
    },
  ],
});

const renderedAnnotation = (annotation: AnchoredAnnotation): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ANNOTATION_SURROUND_CLASSES.split(" "),
    "data-annotation-surround": "",
  },
  children: [annotationCard(annotation)],
});

const renderedSplitAnnotation = (annotation: AnchoredAnnotation): Element => {
  const surround = renderedAnnotation(annotation);
  surround.properties.className = [
    ...ANNOTATION_SURROUND_CLASSES.split(" "),
    "code-diff-split-annotation-surround",
  ];
  surround.properties["data-annotation-card"] = annotation.id;
  return surround;
};

const annotationSpacer = (annotation: AnchoredAnnotation): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    ariaHidden: "true",
    "data-annotation-spacer": annotation.id,
  },
  children: [],
});

const annotationsForLine = ({
  line,
  annotations,
}: {
  readonly line: DiffLine;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): ReadonlyArray<AnchoredAnnotation> =>
  annotations.filter((annotation) => annotation.target === line);

const lineNumberForSide = ({
  line,
  side,
}: {
  readonly line: DiffLine;
  readonly side: DiffSide;
}): number | undefined =>
  side === "old" ? line.oldLineNumber : line.newLineNumber;

// Range membership, rather than the final card target, drives the visual
// spine and wash through every covered source row.
const annotationCoversLine = ({
  annotation,
  line,
}: {
  readonly annotation: AnchoredAnnotation;
  readonly line: DiffLine;
}): boolean => {
  const lineNumber = lineNumberForSide({ line, side: annotation.side });
  if (lineNumber === undefined) {
    return false;
  }
  const value = BigInt(lineNumber);
  return value >= annotation.startLine && value <= annotation.endLine;
};

const lineNumberCell = (
  value: number | undefined,
  side: "old" | "new",
): Element => ({
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
    : [
        {
          type: "element",
          tagName: "span",
          properties: { className: ["sr-only"] },
          children: [
            text(line.kind === "add" ? "Added line: " : "Removed line: "),
          ],
        },
      ];

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
  children: [...accessibleLinePrefix(line), text(line.text)],
});

const unifiedLine = ({
  line,
  showLineNumbers,
  annotations,
}: {
  readonly line: DiffLine;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: [...LINE_CLASSES.split(" "), "code-diff-unified-line"],
    "data-diff-line": line.kind,
    ...(annotations.some((annotation) =>
      annotationCoversLine({ annotation, line }),
    )
      ? { "data-annotation-anchor": "" }
      : {}),
    ...(showLineNumbers ? { "data-line-numbers": "" } : {}),
  },
  children: [
    ...(showLineNumbers
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
  showLineNumbers,
  annotations,
}: {
  readonly hunk: DiffHunk;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): ReadonlyArray<Element> => [
  ...(hunk.header === undefined ? [] : [hunkHeader(hunk.header, "unified")]),
  ...hunk.lines.flatMap((line) => [
    unifiedLine({ line, showLineNumbers, annotations }),
    ...annotationsForLine({ line, annotations }).map(renderedAnnotation),
  ]),
];

const splitLine = ({
  line,
  side,
  showLineNumbers,
  annotations,
}: {
  readonly line: DiffLine | undefined;
  readonly side: "old" | "new";
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: [...LINE_CLASSES.split(" "), "code-diff-split-line"],
    "data-diff-line": line?.kind ?? "empty",
    ...(line !== undefined &&
    annotations.some(
      (annotation) =>
        annotation.side === side && annotationCoversLine({ annotation, line }),
    )
      ? { "data-annotation-anchor": "" }
      : {}),
    ...(showLineNumbers ? { "data-line-numbers": "" } : {}),
  },
  children: [
    ...(showLineNumbers
      ? [
          lineNumberCell(
            side === "old" ? line?.oldLineNumber : line?.newLineNumber,
            side,
          ),
        ]
      : []),
    ...(line === undefined
      ? [lineContent({ kind: "context", text: "" })]
      : [lineContent(line)]),
  ],
});

const splitPane = ({
  rows,
  side,
  showLineNumbers,
  annotations,
}: {
  readonly rows: ReadonlyArray<SplitDiffRow>;
  readonly side: "old" | "new";
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: [
      "code-diff-pane",
      "min-w-0",
      "overflow-x-auto",
      "[container-type:inline-size]",
    ],
    "data-diff-pane": side,
  },
  children: rows.flatMap((row) => [
    splitLine({
      line: side === "old" ? row.left : row.right,
      side,
      showLineNumbers,
      annotations,
    }),
    ...annotationsForSplitRow({ row, annotations }).map((annotation) =>
      annotation.side === side
        ? renderedSplitAnnotation(annotation)
        : annotationSpacer(annotation),
    ),
  ]),
});

const splitHunkHeader = (header: string): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["code-diff-split-header-scroll", "overflow-x-auto"],
  },
  children: [hunkHeader(header, "split")],
});

const splitHunk = ({
  header,
  rows,
  showLineNumbers,
  annotations,
}: {
  readonly header: string | undefined;
  readonly rows: ReadonlyArray<SplitDiffRow>;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["code-diff-split-hunk", "min-w-0"],
  },
  children: [
    ...(header === undefined ? [] : [splitHunkHeader(header)]),
    {
      type: "element",
      tagName: "div",
      properties: {
        className: [
          "code-diff-split-grid",
          "grid",
          "min-w-0",
          "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
        ],
      },
      children: [
        splitPane({ rows, side: "old", showLineNumbers, annotations }),
        splitPane({ rows, side: "new", showLineNumbers, annotations }),
      ],
    },
  ],
});

const annotationsForSplitRow = ({
  row,
  annotations,
}: {
  readonly row: SplitDiffRow;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): ReadonlyArray<AnchoredAnnotation> =>
  annotations.filter(
    (annotation) =>
      annotation.target === row.left || annotation.target === row.right,
  );

const renderSplitHunk = ({
  hunk,
  showLineNumbers,
  annotations,
}: {
  readonly hunk: DiffHunk;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): ReadonlyArray<Element> => {
  const rows = pairDiffLines({ lines: hunk.lines });
  return [
    splitHunk({ header: hunk.header, rows, showLineNumbers, annotations }),
  ];
};

const renderView = ({
  diff,
  view,
  showLineNumbers,
  annotations,
}: {
  readonly diff: UnifiedDiff;
  readonly view: "unified" | "split";
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["code-diff-view", "min-w-0"],
    "data-diff-content": view,
  },
  children: diff.hunks.flatMap((hunk) =>
    view === "unified"
      ? renderUnifiedHunk({ hunk, showLineNumbers, annotations })
      : renderSplitHunk({ hunk, showLineNumbers, annotations }),
  ),
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

const emptyDiff: UnifiedDiff = {
  hunks: [{ lines: [] }],
  hasHunkHeaders: false,
};

/** Validates and renders one CodeDiff typed block. */
export const renderCodeDiff: BlockRenderer = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}): Element => {
  const validated = validateBlockAttributes({
    block: "CodeDiff",
    attributes,
    position,
    diagnostics,
    schema: CODE_DIFF_SCHEMA,
  });

  const meaningfulChildren = children.filter((child) => !isWhitespace(child));
  const extracted = diffFenceSource({ children: meaningfulChildren });
  if (extracted.source === undefined) {
    diagnostics.add({
      message:
        "CodeDiff expects exactly one fenced code block with language diff and no other content",
      position,
    });
  }
  const source = extracted.source ?? "";
  const parsed =
    extracted.source === undefined
      ? { diff: emptyDiff, diagnostics: [] }
      : parseUnifiedDiff({ source });
  for (const diagnostic of parsed.diagnostics) {
    const fenceLine = extracted.codePosition?.start.line;
    const fenceColumn = extracted.codePosition?.start.column;
    diagnostics.add({
      message: `Invalid diff line ${diagnostic.line}: ${diagnostic.message}`,
      position:
        fenceLine === undefined || fenceColumn === undefined
          ? position
          : {
              start: { line: fenceLine + diagnostic.line, column: fenceColumn },
              end: { line: fenceLine + diagnostic.line, column: fenceColumn },
            },
    });
  }
  const showLineNumbers = validated.showLineNumbers === true;
  if (showLineNumbers && !parsed.diff.hasHunkHeaders) {
    diagnostics.add({
      message: "CodeDiff cannot show line numbers without an @@ hunk header",
      position,
    });
  }

  const allLines = parsed.diff.hunks.flatMap((hunk) => hunk.lines);
  const annotations = scopedChildren
    .map((child) => annotationFromScopedChild({ child, diagnostics }))
    .filter((annotation): annotation is Annotation => annotation !== undefined);
  const anchoredAnnotations: Array<AnchoredAnnotation> = [];
  if (extracted.source !== undefined) {
    for (const annotation of annotations) {
      if (!parsed.diff.hasHunkHeaders) {
        diagnostics.add({
          message:
            "CodeDiff cannot anchor an Annotation without an @@ hunk header",
          position: annotation.position,
        });
        continue;
      }
      const sideLines = new Map<string, DiffLine>();
      for (const line of allLines) {
        const lineNumber = lineNumberForSide({ line, side: annotation.side });
        if (lineNumber !== undefined) {
          sideLines.set(String(lineNumber), line);
        }
      }
      const existingLines = [...sideLines.keys()].filter((line) => {
        const lineNumber = BigInt(line);
        return (
          lineNumber >= annotation.startLine && lineNumber <= annotation.endLine
        );
      });
      const expectedLineCount = annotation.endLine - annotation.startLine + 1n;
      const target = sideLines.get(String(annotation.endLine));
      if (
        BigInt(existingLines.length) !== expectedLineCount ||
        target === undefined
      ) {
        const lineWord =
          annotation.startLine === annotation.endLine ? "line" : "lines";
        const verb =
          annotation.startLine === annotation.endLine ? "does" : "do";
        diagnostics.add({
          message: `Annotation ${lineWord} ${annotation.lines} ${verb} not exist on the ${annotation.side} side of the diff`,
          position: annotation.position,
        });
        continue;
      }
      anchoredAnnotations.push({
        ...annotation,
        id: `annotation-${anchoredAnnotations.length + 1}`,
        target,
      });
    }
  }

  const filePath = validated.file ?? "";
  const lastSlashIndex = filePath.lastIndexOf("/");
  const fileDir =
    lastSlashIndex === -1 ? "" : filePath.slice(0, lastSlashIndex + 1);
  const fileName =
    lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);
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
      ...(showLineNumbers ? { "data-line-numbers": "" } : {}),
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
              ...(validated.showLineCounts === true
                ? [diffStats({ addedCount, removedCount })]
                : []),
              viewToggleGroup(),
              actionsMenu(),
              // Far right so entering and leaving full screen live in the
              // same corner of the block.
              expandControlButton(),
            ],
          },
        ],
      },
      renderView({
        diff: parsed.diff,
        view: "unified",
        showLineNumbers,
        annotations: anchoredAnnotations,
      }),
      renderView({
        diff: parsed.diff,
        view: "split",
        showLineNumbers,
        annotations: anchoredAnnotations,
      }),
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
