// Renders CodeDiff's unified and split HAST views, including line semantics,
// gutters, annotation cards, side-localized spacers, and hunk presentation.

import type { Element, Text } from "hast";
import { renderAnnotationCard } from "../shared/annotation-card/annotation-card.js";
import type {
  CodeDiffSide,
  ResolvedCodeDiffAnnotation,
} from "./compile-code-diff.js";
import { pairDiffLines } from "./unified-diff.js";
import type {
  DiffHunk,
  DiffLine,
  SplitDiffRow,
  UnifiedDiff,
} from "./unified-diff.js";

type AnchoredAnnotation = ResolvedCodeDiffAnnotation;

const HUNK_HEADER_CLASSES =
  "code-diff-hunk-header min-w-max whitespace-pre px-[0.65rem] py-[0.4rem] text-xs";
const LINE_CLASSES = "code-diff-line grid min-w-max whitespace-pre";
const ANNOTATION_SURROUND_CLASSES =
  "code-diff-annotation-surround min-w-0 border-l-4 p-[0.35rem]";
const text = (value: string): Text => ({ type: "text", value });

const annotationLineLabel = (annotation: AnchoredAnnotation): string =>
  annotation.startLine === annotation.endLine
    ? `Line ${annotation.lines}`
    : `Lines ${annotation.lines}`;

// Each static view gets its own annotation body so downstream Markdown
// transforms can decorate nested content without sharing mutations.
const annotationCard = (annotation: AnchoredAnnotation): Element =>
  renderAnnotationCard({
    label: annotationLineLabel(annotation),
    children: structuredClone(annotation.children),
    className: ["code-diff-annotation"],
    properties: {
      "data-annotation": "",
      "data-annotation-id": annotation.id,
      "data-annotation-lines": annotation.lines,
      "data-annotation-side": annotation.side,
    },
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
  readonly side: CodeDiffSide;
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
  side: CodeDiffSide,
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
    ...(() => {
      const ids = annotations
        .filter((annotation) => annotationCoversLine({ annotation, line }))
        .map((annotation) => annotation.id);
      return ids.length === 0
        ? {}
        : { "data-annotation-anchor": ids.join(" ") };
    })(),
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
  readonly side: CodeDiffSide;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: [...LINE_CLASSES.split(" "), "code-diff-split-line"],
    "data-diff-line": line?.kind ?? "empty",
    ...(() => {
      const ids =
        line === undefined
          ? []
          : annotations
              .filter(
                (annotation) =>
                  annotation.side === side &&
                  annotationCoversLine({ annotation, line }),
              )
              .map((annotation) => annotation.id);
      return ids.length === 0
        ? {}
        : { "data-annotation-anchor": ids.join(" ") };
    })(),
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

const splitPane = ({
  rows,
  side,
  showLineNumbers,
  annotations,
}: {
  readonly rows: ReadonlyArray<SplitDiffRow>;
  readonly side: CodeDiffSide;
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

/** Renders both static diff views so JavaScript only selects between them. */
export const renderCodeDiffViews = ({
  diff,
  showLineNumbers,
  annotations,
}: {
  readonly diff: UnifiedDiff;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}): ReadonlyArray<Element> => [
  renderView({
    diff,
    view: "unified",
    showLineNumbers,
    annotations,
  }),
  renderView({
    diff,
    view: "split",
    showLineNumbers,
    annotations,
  }),
];
