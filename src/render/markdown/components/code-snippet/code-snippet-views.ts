// Renders CodeSnippet's numbered code rows and line-anchored annotation cards,
// tagging every covered row with range-boundary tokens the stylesheet caps.

import type { Element, Text } from "hast";
import type {
  CompiledCodeSnippet,
  CompiledCodeSnippetAnnotation,
} from "./compile-code-snippet.js";
import type { HighlightedLine } from "./split-highlighted-lines.js";

const LINE_CLASSES = "code-snippet-line grid min-w-max whitespace-pre";

const text = (value: string): Text => ({ type: "text", value });

const lineNumberCell = (lineNumber: number): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: [
      "code-snippet-line-number",
      "select-none",
      "px-[0.65rem]",
      "text-right",
    ],
    ariaHidden: "true",
    "data-snippet-line-number": lineNumber,
  },
  children: [text(String(lineNumber))],
});

const codeLine = ({
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
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: LINE_CLASSES.split(" "),
    "data-snippet-line": lineNumber,
    ...(annotated === undefined ? {} : { "data-snippet-annotated": annotated }),
  },
  children: [
    ...(showLineNumbers ? [lineNumberCell(lineNumber)] : []),
    {
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "code-snippet-line-content",
          "inline-block",
          "min-w-full",
          "px-[0.75rem]",
        ],
      },
      children: [...line],
    },
  ],
});

const annotationCard = (
  annotation: CompiledCodeSnippetAnnotation,
): Element => ({
  type: "element",
  tagName: "aside",
  properties: {
    className: [
      "code-snippet-annotation",
      "mx-3",
      "my-2",
      "rounded-md",
      "border",
      "px-3",
      "py-2.5",
      "font-sans",
      "text-sm",
      "whitespace-normal",
    ],
    "data-snippet-annotation": annotation.sourceValue,
    "data-snippet-anchor-end": annotation.end,
  },
  children: [
    {
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "code-snippet-annotation-badge",
          "mb-1.5",
          "inline-flex",
          "rounded-full",
          "px-2",
          "py-0.5",
          "text-xs",
          "font-semibold",
        ],
      },
      children: [
        text(
          annotation.start === annotation.end
            ? `Line ${annotation.start}`
            : `Lines ${annotation.start}-${annotation.end}`,
        ),
      ],
    },
    {
      type: "element",
      tagName: "div",
      properties: { className: ["code-snippet-annotation-body"] },
      children: [...annotation.children],
    },
  ],
});

/** Renders the numbered rows and interleaved annotation cards for one snippet. */
export const renderCodeSnippetRows = ({
  highlightedLines,
  startLine,
  showLineNumbers,
  annotations,
}: Pick<
  CompiledCodeSnippet,
  "highlightedLines" | "startLine" | "showLineNumbers" | "annotations"
>): ReadonlyArray<Element> => {
  const coversLine = (lineNumber: number): boolean =>
    annotations.some(
      (annotation) =>
        annotation.start <= lineNumber && annotation.end >= lineNumber,
    );
  return highlightedLines.flatMap((line, index): ReadonlyArray<Element> => {
    const lineNumber = startLine + index;
    const boundaries = [
      ...(coversLine(lineNumber - 1) ? [] : ["start"]),
      ...(coversLine(lineNumber + 1) ? [] : ["end"]),
    ];
    return [
      codeLine({
        line,
        lineNumber,
        showLineNumbers,
        annotated: coversLine(lineNumber)
          ? boundaries.length === 0
            ? "middle"
            : boundaries.join(" ")
          : undefined,
      }),
      ...annotations
        .filter((annotation) => annotation.end === lineNumber)
        .map(annotationCard),
    ];
  });
};
