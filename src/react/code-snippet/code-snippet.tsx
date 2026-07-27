// The React port of CodeSnippet: the outer figure, file-identity caption
// with progressive copy controls, numbered highlighted rows with anchored
// annotation cards, and the hidden raw-source copy target. Class constants
// are duplicated from the vanilla renderer on purpose; the parity test holds
// the two byte-identical until the vanilla renderer is deleted.

import { renderToStaticMarkup } from "react-dom/server";
import type {
  CompiledCodeSnippet,
  CompiledCodeSnippetAnnotation,
} from "../../model/compile-code-snippet.js";
import type { HighlightedLine } from "../../model/split-highlighted-lines.js";
import { COPY_ICON } from "../../render/icons/lucide/copy.js";
import { ELLIPSIS_ICON } from "../../render/icons/lucide/ellipsis.js";
import { hastContentToReact } from "../hast-content.js";
import { lucideIconToReact } from "../lucide-icon.js";
import { AnnotationCard } from "../shared/annotation-card/annotation-card.js";
import { CopyFeedback } from "../shared/copy-feedback/copy-feedback.js";
import { FileIdentity } from "../shared/file-identity/file-identity.js";

const FIGURE_CLASSES =
  "code-snippet mb-5 min-w-0 rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]";
const HEADER_CLASSES =
  "code-snippet-header flex min-w-0 items-center justify-between gap-3 border-b border-edge px-[0.55rem] py-[0.3rem]";
const BUTTON_CLASSES =
  "code-snippet-button inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
const MENU_LIST_CLASSES =
  "code-snippet-menu-list absolute top-[calc(100%+0.25rem)] right-0 z-10 min-w-36 rounded-[0.375rem] border border-edge p-1";
const MENU_ITEM_CLASSES =
  "code-snippet-menu-item flex w-full cursor-pointer items-center gap-[0.45rem] whitespace-nowrap rounded-sm border-0 bg-transparent px-2 py-[0.3rem] text-left text-xs text-ink [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-muted";
const LINE_CLASSES = "code-snippet-line grid min-w-max whitespace-pre";

const MenuItemButton = ({
  action,
  label,
}: {
  readonly action: "copy-path" | "copy-code";
  readonly label: string;
}) => (
  <button
    type="button"
    className={MENU_ITEM_CLASSES}
    role="menuitem"
    tabIndex={-1}
    {...{ [`data-snippet-${action}`]: "" }}
  >
    {lucideIconToReact({ icon: COPY_ICON, hidden: false })}
    {label}
  </button>
);

// Actions remain unavailable without JavaScript, while the complete code and
// every annotation stay readable in the server-rendered figure.
const ActionsMenu = ({ filePath }: { readonly filePath?: string }) => (
  <span className="code-snippet-menu relative inline-flex" data-snippet-menu="">
    <button
      type="button"
      className={BUTTON_CLASSES}
      aria-label="More actions"
      aria-haspopup="menu"
      aria-expanded="false"
      title="More actions"
      hidden
      data-snippet-menu-button=""
      data-size="xs"
      data-slot="button"
      data-variant="ghost"
    >
      {lucideIconToReact({ icon: ELLIPSIS_ICON, hidden: false })}
    </button>
    <div
      className={MENU_LIST_CLASSES}
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
  <figcaption className={HEADER_CLASSES}>
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
    className={LINE_CLASSES}
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
    <span className="code-snippet-line-content inline-block min-w-full px-[0.75rem]">
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

const CodeSnippetView = ({
  model,
}: {
  readonly model: CompiledCodeSnippet;
}) => (
  <figure
    className={FIGURE_CLASSES}
    data-code-snippet=""
    {...(model.filePath === undefined
      ? {}
      : { "data-snippet-path": model.filePath })}
    {...(model.showLineNumbers ? { "data-line-numbers": "" } : {})}
  >
    <SnippetHeader
      {...(model.filePath === undefined ? {} : { filePath: model.filePath })}
    />
    <div className="code-snippet-body min-w-0 overflow-x-auto">
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

/** Renders one compiled CodeSnippet to static HTML via the React port. */
export const renderCodeSnippetStatic = (model: CompiledCodeSnippet): string =>
  renderToStaticMarkup(<CodeSnippetView model={model} />);
