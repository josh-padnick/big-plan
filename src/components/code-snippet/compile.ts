// Compiles CodeSnippet's authored HAST contract into a render-ready model:
// validates attributes and the single fence, highlights it into file-absolute
// lines, and resolves scoped Annotations against that line range.

import type { ElementContent } from "hast";
import {
  isIgnorableWhitespace,
  singleAuthoredFence,
} from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";
import { splitHighlightedLines } from "./split-highlighted-lines.js";
import type { HighlightedLine } from "./split-highlighted-lines.js";

export type CompiledCodeSnippetAnnotation = {
  readonly start: number;
  readonly end: number;
  readonly sourceValue: string;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledCodeSnippet = {
  readonly filePath?: string;
  readonly source: string;
  readonly highlightedLines: ReadonlyArray<HighlightedLine>;
  readonly startLine: number;
  readonly showLineNumbers: boolean;
  readonly annotations: ReadonlyArray<CompiledCodeSnippetAnnotation>;
};

const CODE_SNIPPET_SCHEMA = {
  file: { kind: "string", nonEmpty: true },
  startLine: { kind: "string" },
  showLineNumbers: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

const positiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

// Parses one file-absolute single line or strictly ascending inclusive range
// (canonical positive integers, matching CodeDiff's Annotation grammar) and
// keeps collecting schema/body diagnostics even when its anchor is invalid.
const parseAnnotation = ({
  annotation,
  firstLine,
  lastLine,
  diagnostics,
}: {
  readonly annotation: ScopedChild;
  readonly firstLine: number;
  readonly lastLine: number;
  readonly diagnostics: DiagnosticCollector;
}): CompiledCodeSnippetAnnotation | undefined => {
  const linesValue = annotation.attributes["lines"];
  const validRange = `${firstLine}-${lastLine}`;
  if (linesValue === undefined) {
    diagnostics.add({
      message: `Missing required attribute "lines"; expected a line or strictly ascending inclusive range within ${validRange}`,
      position: annotation.position,
    });
  } else if (typeof linesValue !== "string") {
    diagnostics.add({
      message: `Attribute "lines" on Annotation must be a string within ${validRange}`,
      position: annotation.position,
    });
  }
  for (const name of Object.keys(annotation.attributes)) {
    if (name !== "lines") {
      diagnostics.add({
        message: `Unknown attribute "${name}" on Annotation`,
        position: annotation.position,
      });
    }
  }
  if (annotation.children.every(isIgnorableWhitespace)) {
    diagnostics.add({
      message: "Annotation body must not be empty",
      position: annotation.position,
    });
  }
  if (typeof linesValue !== "string") {
    return undefined;
  }
  const match = /^([1-9]\d*)(?:-([1-9]\d*))?$/u.exec(linesValue);
  const startValue = match?.[1];
  const endValue = match?.[2];
  const start = startValue === undefined ? undefined : Number(startValue);
  const end = endValue === undefined ? start : Number(endValue);
  if (
    start === undefined ||
    end === undefined ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < firstLine ||
    end > lastLine ||
    (endValue !== undefined && end <= start)
  ) {
    diagnostics.add({
      message: `Attribute "lines" on Annotation must be a line or strictly ascending inclusive range within ${validRange}`,
      position: annotation.position,
    });
    return undefined;
  }
  return {
    start,
    end,
    sourceValue: linesValue,
    children: annotation.children,
  };
};

/** Compiles one CodeSnippet component into the model consumed by renderers. */
export const compileCodeSnippetComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: ComponentCompilerInput): CompiledCodeSnippet => {
  const validated = validateComponentAttributes({
    component: "CodeSnippet",
    attributes,
    position,
    diagnostics,
    schema: CODE_SNIPPET_SCHEMA,
  });
  const startLineValue = attributes["startLine"];
  const showLineNumbersValue = attributes["showLineNumbers"];
  const fileValue = attributes["file"];
  if (
    typeof validated.startLine === "string" &&
    positiveInteger(validated.startLine) === undefined
  ) {
    diagnostics.add({
      message: 'Attribute "startLine" must be a positive integer string',
      position,
    });
  }
  if (startLineValue !== undefined && showLineNumbersValue !== true) {
    diagnostics.add({
      message: "CodeSnippet cannot use startLine without showLineNumbers",
      position,
    });
  }

  const fence = singleAuthoredFence({ children });
  if (fence === undefined) {
    diagnostics.add({
      message:
        "CodeSnippet expects exactly one fenced code block and zero or more Annotation blocks with no other content",
      position,
    });
  }
  const source = fence?.source ?? "";
  const highlightedLines = splitHighlightedLines({
    source,
    ...(fence?.language === undefined ? {} : { language: fence.language }),
  });
  const startLine = positiveInteger(validated.startLine) ?? 1;
  const lastLine = startLine + highlightedLines.length - 1;
  const annotations = scopedChildren.flatMap((annotation) => {
    const parsed = parseAnnotation({
      annotation,
      firstLine: startLine,
      lastLine,
      diagnostics,
    });
    return parsed === undefined ? [] : [parsed];
  });
  if (
    fileValue === undefined &&
    startLineValue === undefined &&
    showLineNumbersValue === undefined &&
    scopedChildren.length === 0
  ) {
    diagnostics.add({
      message:
        "A bare CodeSnippet duplicates a plain markdown fence, which already provides syntax highlighting",
      position,
    });
  }

  return {
    ...(validated.file === undefined ? {} : { filePath: validated.file }),
    source,
    highlightedLines,
    startLine,
    showLineNumbers: showLineNumbersValue === true,
    annotations,
  };
};
