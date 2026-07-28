// Renders CodeDiff's unified and split views with line semantics, gutters,
// annotation cards, side-localized spacers, and hunk presentation.

import type { ReactNode } from "react";
import type {
  CodeDiffSide,
  ResolvedCodeDiffAnnotation,
} from "../../model/compile-code-diff.js";
import { pairDiffLines } from "../../model/unified-diff.js";
import type {
  DiffHunk,
  DiffLine,
  SplitDiffRow,
  UnifiedDiff,
} from "../../model/unified-diff.js";
import { AnnotationCard } from "../shared/annotation-card/annotation-card.js";

type AnchoredAnnotation = ResolvedCodeDiffAnnotation;

// Shared by the unified and split hunk headers.
const HUNK_HEADER_CLASSES =
  "code-diff-hunk-header min-w-max whitespace-pre px-[0.65rem] py-[0.4rem] text-xs";
// Shared by unified and split line rows.
const LINE_CLASSES = "code-diff-line grid min-w-max whitespace-pre";
// Shared by unified and split annotation surrounds.
const ANNOTATION_SURROUND_CLASSES =
  "code-diff-annotation-surround min-w-0 border-l-4 p-[0.35rem]";

const annotationLineLabel = (annotation: AnchoredAnnotation): string =>
  annotation.startLine === annotation.endLine
    ? `Line ${annotation.lines}`
    : `Lines ${annotation.lines}`;

// No clone is needed: downstream Markdown transforms decorate the reparsed
// HAST, never the model's subtrees.
const annotationCard = (annotation: AnchoredAnnotation): ReactNode => (
  <AnnotationCard
    label={annotationLineLabel(annotation)}
    children={annotation.children}
    className={["code-diff-annotation"]}
    dataProperties={{
      "data-annotation": "",
      "data-annotation-id": annotation.id,
      "data-annotation-lines": annotation.lines,
      "data-annotation-side": annotation.side,
    }}
  />
);

const RenderedAnnotation = ({
  annotation,
}: {
  readonly annotation: AnchoredAnnotation;
}) => (
  <div className={ANNOTATION_SURROUND_CLASSES} data-annotation-surround="">
    {annotationCard(annotation)}
  </div>
);

const RenderedSplitAnnotation = ({
  annotation,
}: {
  readonly annotation: AnchoredAnnotation;
}) => (
  <div
    className={`${ANNOTATION_SURROUND_CLASSES} code-diff-split-annotation-surround`}
    data-annotation-surround=""
    data-annotation-card={annotation.id}
  >
    {annotationCard(annotation)}
  </div>
);

const AnnotationSpacer = ({
  annotation,
}: {
  readonly annotation: AnchoredAnnotation;
}) => <div aria-hidden="true" data-annotation-spacer={annotation.id} />;

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
  return lineNumber >= annotation.startLine && lineNumber <= annotation.endLine;
};

const LineNumberCell = ({
  value,
  side,
}: {
  readonly value: number | undefined;
  readonly side: CodeDiffSide;
}) => (
  <span
    className="code-diff-line-number select-none px-[0.55rem] text-right"
    aria-hidden="true"
    data-diff-number={side}
  >
    {value === undefined ? "" : String(value)}
  </span>
);

const LineContent = ({ line }: { readonly line: DiffLine }) => (
  <span className="code-diff-line-content inline-block min-w-full pr-3 pl-[0.45rem]">
    {line.kind === "context" ? null : (
      <span className="sr-only">
        {line.kind === "add" ? "Added line: " : "Removed line: "}
      </span>
    )}
    {line.text}
  </span>
);

const anchorIds = (
  ids: ReadonlyArray<string>,
): Readonly<Record<string, string>> =>
  ids.length === 0 ? {} : { "data-annotation-anchor": ids.join(" ") };

const UnifiedLine = ({
  line,
  showLineNumbers,
  annotations,
}: {
  readonly line: DiffLine;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}) => (
  <div
    className={`${LINE_CLASSES} code-diff-unified-line`}
    data-diff-line={line.kind}
    {...anchorIds(
      annotations
        .filter((annotation) => annotationCoversLine({ annotation, line }))
        .map((annotation) => annotation.id),
    )}
    {...(showLineNumbers ? { "data-line-numbers": "" } : {})}
  >
    {showLineNumbers ? (
      <>
        <LineNumberCell value={line.oldLineNumber} side="old" />
        <LineNumberCell value={line.newLineNumber} side="new" />
      </>
    ) : null}
    <LineContent line={line} />
  </div>
);

const HunkHeader = ({
  value,
  view,
}: {
  readonly value: string;
  readonly view: "unified" | "split";
}) => (
  <div className={HUNK_HEADER_CLASSES} data-diff-hunk-header={view}>
    {value}
  </div>
);

const unifiedHunk = ({
  hunk,
  showLineNumbers,
  annotations,
  hunkKey,
}: {
  readonly hunk: DiffHunk;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
  readonly hunkKey: number;
}): ReadonlyArray<ReactNode> => [
  ...(hunk.header === undefined
    ? []
    : [<HunkHeader key={`h-${hunkKey}`} value={hunk.header} view="unified" />]),
  ...hunk.lines.flatMap((line, index) => [
    <UnifiedLine
      key={`l-${hunkKey}-${index}`}
      line={line}
      showLineNumbers={showLineNumbers}
      annotations={annotations}
    />,
    ...annotationsForLine({ line, annotations }).map((annotation) => (
      <RenderedAnnotation key={`a-${annotation.id}`} annotation={annotation} />
    )),
  ]),
];

const SplitLine = ({
  line,
  side,
  showLineNumbers,
  annotations,
}: {
  readonly line: DiffLine | undefined;
  readonly side: CodeDiffSide;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}) => (
  <div
    className={`${LINE_CLASSES} code-diff-split-line`}
    data-diff-line={line?.kind ?? "empty"}
    {...anchorIds(
      line === undefined
        ? []
        : annotations
            .filter(
              (annotation) =>
                annotation.side === side &&
                annotationCoversLine({ annotation, line }),
            )
            .map((annotation) => annotation.id),
    )}
    {...(showLineNumbers ? { "data-line-numbers": "" } : {})}
  >
    {showLineNumbers ? (
      <LineNumberCell
        value={side === "old" ? line?.oldLineNumber : line?.newLineNumber}
        side={side}
      />
    ) : null}
    <LineContent line={line ?? { kind: "context", text: "" }} />
  </div>
);

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

const SplitPane = ({
  rows,
  side,
  showLineNumbers,
  annotations,
}: {
  readonly rows: ReadonlyArray<SplitDiffRow>;
  readonly side: CodeDiffSide;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}) => (
  <div
    className="code-diff-pane min-w-0 overflow-x-auto [container-type:inline-size]"
    data-diff-pane={side}
  >
    {rows.flatMap((row, index) => [
      <SplitLine
        key={`l-${index}`}
        line={side === "old" ? row.left : row.right}
        side={side}
        showLineNumbers={showLineNumbers}
        annotations={annotations}
      />,
      ...annotationsForSplitRow({ row, annotations }).map((annotation) =>
        annotation.side === side ? (
          <RenderedSplitAnnotation
            key={`a-${annotation.id}`}
            annotation={annotation}
          />
        ) : (
          <AnnotationSpacer
            key={`s-${annotation.id}`}
            annotation={annotation}
          />
        ),
      ),
    ])}
  </div>
);

const SplitHunk = ({
  header,
  rows,
  showLineNumbers,
  annotations,
}: {
  readonly header: string | undefined;
  readonly rows: ReadonlyArray<SplitDiffRow>;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}) => (
  <div className="code-diff-split-hunk min-w-0">
    {header === undefined ? null : (
      <div className="code-diff-split-header-scroll overflow-x-auto">
        <HunkHeader value={header} view="split" />
      </div>
    )}
    <div className="code-diff-split-grid grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <SplitPane
        rows={rows}
        side="old"
        showLineNumbers={showLineNumbers}
        annotations={annotations}
      />
      <SplitPane
        rows={rows}
        side="new"
        showLineNumbers={showLineNumbers}
        annotations={annotations}
      />
    </div>
  </div>
);

const DiffView = ({
  diff,
  view,
  showLineNumbers,
  annotations,
}: {
  readonly diff: UnifiedDiff;
  readonly view: "unified" | "split";
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}) => (
  <div className="code-diff-view min-w-0" data-diff-content={view}>
    {diff.hunks.flatMap((hunk, hunkKey) =>
      view === "unified" ? (
        unifiedHunk({ hunk, showLineNumbers, annotations, hunkKey })
      ) : (
        <SplitHunk
          key={`sh-${hunkKey}`}
          header={hunk.header}
          rows={pairDiffLines({ lines: hunk.lines })}
          showLineNumbers={showLineNumbers}
          annotations={annotations}
        />
      ),
    )}
  </div>
);

/** Renders both static diff views for the live application to select. */
export const CodeDiffViews = ({
  diff,
  showLineNumbers,
  annotations,
}: {
  readonly diff: UnifiedDiff;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<AnchoredAnnotation>;
}) => (
  <>
    <DiffView
      diff={diff}
      view="unified"
      showLineNumbers={showLineNumbers}
      annotations={annotations}
    />
    <DiffView
      diff={diff}
      view="split"
      showLineNumbers={showLineNumbers}
      annotations={annotations}
    />
  </>
);
