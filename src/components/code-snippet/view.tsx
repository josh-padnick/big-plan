// Renders CodeSnippet's file identity, numbered highlighted rows, anchored
// annotation cards, and hidden live-review source and controls.

import type {
  CompiledCodeSnippet,
  CompiledCodeSnippetAnnotation,
} from "./compile.js";
import type { HighlightedLine } from "./split-highlighted-lines.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { AnnotationCard } from "../_shared/annotation-card/annotation-card.js";
import { FileIdentity } from "../_shared/file-identity/file-identity.js";
import { CopyButton } from "../_shared/figure-controls/copy-button.js";
import {
  BODY_ATTRIBUTE,
  MAXIMIZABLE_ATTRIBUTE,
} from "../_model/figure-controls/figure-controls.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";

// /* off-scale */ Phase A preserves the legacy header/body radii, 0.6rem
// body padding, and annotation-rail width exactly for the zero-pixel contract.
const SnippetHeader = ({ filePath }: { readonly filePath?: string }) => (
  <figcaption className="code-snippet-header flex min-w-0 items-center justify-between gap-3 rounded-t-[calc(var(--radius-md)-1px)] border-b border-edge bg-[var(--diff-header-bg)] px-[0.55rem] py-[0.3rem]">
    {filePath === undefined ? (
      <span className="code-snippet-label text-xs font-semibold text-muted">
        Code snippet
      </span>
    ) : (
      <FileIdentity filePath={filePath} />
    )}
    <span className="code-snippet-controls flex shrink-0 items-center gap-2">
      <span className="figure-action-group inline-flex items-center gap-0.5">
        <CopyButton subject="code" />
        <MaximizeButton subject="code" />
      </span>
    </span>
  </figcaption>
);

const CodeLine = ({
  line,
  lineNumber,
  showLineNumbers,
  annotated,
}: {
  readonly line: HighlightedLine;
  readonly lineNumber: number;
  readonly showLineNumbers: boolean;
  // Space-separated "start"/"end" range-boundary tokens ("middle" between
  // them) so the static utility variants can cap the vertical range rail;
  // undefined on unannotated rows.
  readonly annotated: string | undefined;
}) => (
  <div
    className={`code-snippet-line grid min-w-max whitespace-pre ${
      showLineNumbers
        ? "grid-cols-[4rem_minmax(max-content,1fr)]"
        : "grid-cols-[minmax(max-content,1fr)]"
    } ${
      annotated === undefined
        ? ""
        : "relative bg-[color-mix(in_srgb,var(--annotation-c)_8%,transparent)] before:absolute before:inset-y-0 before:left-0 before:w-[0.1875rem] before:bg-[var(--annotation-c)] before:content-[''] [&.annotation-hover]:bg-[color-mix(in_srgb,var(--annotation-c)_16%,transparent)]"
    } ${annotated?.includes("start") === true ? "before:rounded-t-full" : ""} ${
      annotated?.includes("end") === true ? "before:rounded-b-full" : ""
    }`}
    data-snippet-line={lineNumber}
    {...(annotated === undefined
      ? {}
      : { "data-snippet-annotated": annotated })}
  >
    {showLineNumbers ? (
      <span
        className="code-snippet-line-number select-none border-r border-edge px-[0.65rem] text-right text-muted"
        aria-hidden="true"
        data-snippet-line-number={lineNumber}
      >
        {String(lineNumber)}
      </span>
    ) : null}
    <span className="code-snippet-line-content inline-block min-w-full px-[1rem]">
      {hastContentToReact(line)}
    </span>
  </div>
);

const annotationCard = (annotation: CompiledCodeSnippetAnnotation) => (
  <AnnotationCard
    key={`${annotation.sourceValue}-${annotation.end}`}
    label={
      annotation.start === annotation.end
        ? `Line ${annotation.start}`
        : `Lines ${annotation.start}-${annotation.end}`
    }
    children={annotation.children}
    className={["code-snippet-annotation", "mx-3", "my-2"]}
    dataProperties={{
      "data-snippet-annotation": annotation.sourceValue,
      "data-snippet-anchor-end": annotation.end,
    }}
  />
);

const SnippetRows = ({
  highlightedLines,
  startLine,
  showLineNumbers,
  annotations,
}: Pick<
  CompiledCodeSnippet,
  "highlightedLines" | "startLine" | "showLineNumbers" | "annotations"
>) => {
  const coversLine = (lineNumber: number): boolean =>
    annotations.some(
      (annotation) =>
        annotation.start <= lineNumber && annotation.end >= lineNumber,
    );
  return (
    <>
      {highlightedLines.flatMap((line, index) => {
        const lineNumber = startLine + index;
        const boundaries = [
          ...(coversLine(lineNumber - 1) ? [] : ["start"]),
          ...(coversLine(lineNumber + 1) ? [] : ["end"]),
        ];
        return [
          <CodeLine
            key={`line-${lineNumber}`}
            line={line}
            lineNumber={lineNumber}
            showLineNumbers={showLineNumbers}
            annotated={
              coversLine(lineNumber)
                ? boundaries.length === 0
                  ? "middle"
                  : boundaries.join(" ")
                : undefined
            }
          />,
          ...annotations
            .filter((annotation) => annotation.end === lineNumber)
            .map(annotationCard),
        ];
      })}
    </>
  );
};

export const CodeSnippet = ({
  model,
}: {
  readonly model: CompiledCodeSnippet;
}) => (
  <figure
    className="code-snippet mb-5 min-w-0 rounded-md border border-edge bg-[var(--diff-content-bg)] font-mono text-[0.8125rem] leading-[1.5]"
    data-code-snippet=""
    {...{ [MAXIMIZABLE_ATTRIBUTE]: "code" }}
    {...(model.filePath === undefined
      ? {}
      : { "data-snippet-path": model.filePath })}
    {...(model.showLineNumbers ? { "data-line-numbers": "" } : {})}
  >
    <SnippetHeader
      {...(model.filePath === undefined ? {} : { filePath: model.filePath })}
    />
    <div
      className="code-snippet-body min-w-0 overflow-x-auto rounded-b-[calc(var(--radius-md)-1px)] py-[0.6rem]"
      {...{ [BODY_ATTRIBUTE]: "" }}
    >
      <SnippetRows
        highlightedLines={model.highlightedLines}
        startLine={model.startLine}
        showLineNumbers={model.showLineNumbers}
        annotations={model.annotations}
      />
    </div>
    <textarea
      hidden
      readOnly
      data-snippet-source=""
      defaultValue={model.source}
    />
  </figure>
);
