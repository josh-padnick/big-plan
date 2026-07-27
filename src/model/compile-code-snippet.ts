// Compiles CodeSnippet's authored HAST contract into a render-ready model:
// validates attributes and the single fence, highlights it into file-absolute
// lines, and resolves scoped Annotations against that line range.

import type { Element, ElementContent } from "hast";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentRenderer,
  type ScopedChild,
} from "./component-contract.js";
import type { DiagnosticCollector } from "./diagnostics.js";
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

type SnippetFence = {
  readonly source: string;
  readonly language?: string;
};

const CODE_SNIPPET_SCHEMA = {
  file: { kind: "string", nonEmpty: true },
  startLine: { kind: "string" },
  showLineNumbers: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

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

// Enforces the same single-fence HAST shape as CodeDiff while accepting any
// declared language, or no language at all.
const snippetFence = ({
  children,
}: {
  readonly children: ReadonlyArray<ElementContent>;
}): SnippetFence | undefined => {
  const meaningful = children.filter((child) => !isWhitespace(child));
  if (meaningful.length !== 1) {
    return undefined;
  }
  const pre = meaningful[0];
  if (pre === undefined || !isElement(pre) || pre.tagName !== "pre") {
    return undefined;
  }
  if (pre.children.length !== 1) {
    return undefined;
  }
  const code = pre.children[0];
  if (
    code === undefined ||
    !isElement(code) ||
    code.tagName !== "code" ||
    code.children.length !== 1
  ) {
    return undefined;
  }
  const source = code.children[0];
  if (source === undefined || source.type !== "text") {
    return undefined;
  }
  const languageClass = languageClasses(code).find((name) =>
    name.startsWith("language-"),
  );
  return {
    source: source.value,
    ...(languageClass === undefined
      ? {}
      : { language: languageClass.slice("language-".length) }),
  };
};

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
  if (annotation.children.every(isWhitespace)) {
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
}: Parameters<ComponentRenderer>[0]): CompiledCodeSnippet => {
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

  const fence = snippetFence({ children });
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
        "A bare CodeSnippet duplicates a plain markdown fence, which already provides highlighting and a copy control",
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
