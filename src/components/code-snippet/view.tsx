// Renders CodeSnippet's file identity, numbered highlighted rows, anchored
// annotation cards, and hidden live-review source and controls.

import type {
  CompiledCodeSnippet,
  CompiledCodeSnippetAnnotation,
} from "./compile.js";
import type { HighlightedLine } from "./split-highlighted-lines.js";
import { COPY_ICON } from "../../icons/lucide/copy.js";
import { ELLIPSIS_ICON } from "../../icons/lucide/ellipsis.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import { AnnotationCard } from "../_shared/annotation-card/annotation-card.js";
import { CopyFeedback } from "../_shared/copy-feedback/copy-feedback.js";
import { FileIdentity } from "../_shared/file-identity/file-identity.js";
import {
  BODY_ATTRIBUTE,
  MAXIMIZABLE_ATTRIBUTE,
} from "../_model/figure-controls/figure-controls.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";

const MenuItemButton = ({
  action,
  label,
}: {
  readonly action: "copy-path" | "copy-code";
  readonly label: string;
}) => (
  <button
    type="button"
    className="code-snippet-menu-item flex w-full cursor-pointer items-center gap-[0.45rem] whitespace-nowrap rounded-sm border-0 bg-transparent px-2 py-[0.3rem] text-left text-xs text-ink hover:bg-edge [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted"
    role="menuitem"
    tabIndex={-1}
    {...{ [`data-snippet-${action}`]: "" }}
  >
    {lucideIconToReact({ icon: COPY_ICON, hidden: false })}
    {label}
  </button>
);

// Actions remain reserved for the live review application, while the complete
// code and every annotation stay readable in the server-rendered figure.
const ActionsMenu = ({ filePath }: { readonly filePath?: string }) => (
  <span className="code-snippet-menu relative inline-flex" data-snippet-menu="">
    <button
      type="button"
      className="code-snippet-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:bg-edge hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5"
      aria-label="More actions"
      aria-haspopup="menu"
      aria-expanded="false"
      data-tooltip="More actions"
      hidden
      data-snippet-menu-button=""
      data-size="xs"
      data-slot="button"
      data-variant="ghost"
    >
      {lucideIconToReact({ icon: ELLIPSIS_ICON, hidden: false })}
    </button>
    <div
      className="code-snippet-menu-list absolute top-[calc(100%+0.25rem)] right-0 z-10 min-w-36 rounded-[0.375rem] border border-edge p-1"
      role="menu"
      aria-label="Code snippet actions"
      hidden
      data-snippet-menu-list=""
    >
      {filePath === undefined ? null : (
        <MenuItemButton action="copy-path" label="Copy path" />
      )}
      <MenuItemButton action="copy-code" label="Copy code" />
    </div>
  </span>
);

const SnippetHeader = ({ filePath }: { readonly filePath?: string }) => (
  <figcaption className="code-snippet-header flex min-w-0 items-center justify-between gap-3 border-b border-edge px-[0.55rem] py-[0.3rem]">
    {filePath === undefined ? (
      <span className="code-snippet-label text-xs font-semibold text-muted">
        Code snippet
      </span>
    ) : (
      <FileIdentity filePath={filePath} />
    )}
    <span className="code-snippet-controls flex shrink-0 items-center gap-1">
      <CopyFeedback dataAttribute="data-snippet-copy-message" />
      <ActionsMenu {...(filePath === undefined ? {} : { filePath })} />
      <MaximizeButton subject="code" />
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
  // them) so the stylesheet can cap the vertical range rail; undefined on
  // unannotated rows.
  readonly annotated: string | undefined;
}) => (
  <div
    className="code-snippet-line grid min-w-max whitespace-pre"
    data-snippet-line={lineNumber}
    {...(annotated === undefined
      ? {}
      : { "data-snippet-annotated": annotated })}
  >
    {showLineNumbers ? (
      <span
        className="code-snippet-line-number select-none px-[0.65rem] text-right"
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
    className="code-snippet mb-5 min-w-0 rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]"
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
      className="code-snippet-body min-w-0 overflow-x-auto"
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
