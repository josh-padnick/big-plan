// Compiles CodeDiff's authored HAST contract into a render-ready model:
// validates attributes and fences, translates parser diagnostics, and resolves
// scoped Annotations against parsed diff lines.

import type { ElementContent, Root } from "hast";
import { singleAuthoredFence } from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";
import { parseUnifiedDiff } from "./unified-diff.js";
import type { DiffLine, UnifiedDiff } from "./unified-diff.js";

type NodePosition = Root["position"];

export type CodeDiffSide = "old" | "new";

type Annotation = {
  readonly lines: string;
  readonly startLine: bigint;
  readonly endLine: bigint;
  readonly side: CodeDiffSide;
  readonly children: ReadonlyArray<ElementContent>;
  readonly position: NodePosition;
};

export type ResolvedCodeDiffAnnotation = Omit<
  Annotation,
  "startLine" | "endLine"
> & {
  readonly startLine: number;
  readonly endLine: number;
  readonly id: string;
  readonly target: DiffLine;
};

export type CompiledCodeDiff = {
  readonly filePath: string;
  readonly source: string;
  readonly diff: UnifiedDiff;
  readonly showLineNumbers: boolean;
  readonly showLineCounts: boolean;
  readonly addedCount: number;
  readonly removedCount: number;
  readonly annotations: ReadonlyArray<ResolvedCodeDiffAnnotation>;
};

type ParsedCodeDiffSource = {
  readonly source: string;
  readonly diff: UnifiedDiff;
  readonly hasSource: boolean;
};

const CODE_DIFF_SCHEMA = {
  file: { kind: "string", required: true, nonEmpty: true },
  showLineNumbers: { kind: "booleanShorthand" },
  showLineCounts: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

const ANNOTATION_SCHEMA = {
  side: {
    kind: "enum",
    values: ["old", "new"] satisfies ReadonlyArray<CodeDiffSide>,
  },
} satisfies ComponentAttributeSchema;

const EMPTY_DIFF: UnifiedDiff = {
  hunks: [{ lines: [] }],
  hasHunkHeaders: false,
};

// Parses the raw diff while translating its local diagnostics back to the
// authored document coordinates owned by the component.
const parseCodeDiffSource = ({
  children,
  position,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ElementContent>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
}): ParsedCodeDiffSource => {
  const extracted = singleAuthoredFence({ children, language: "diff" });
  if (extracted === undefined) {
    diagnostics.add({
      message:
        "CodeDiff expects exactly one fenced code block with language diff and no other content",
      position,
    });
  }

  const source = extracted?.source ?? "";
  const parsed =
    extracted === undefined
      ? { diff: EMPTY_DIFF, diagnostics: [] }
      : parseUnifiedDiff({ source });
  for (const diagnostic of parsed.diagnostics) {
    const fenceLine = extracted?.codePosition?.start.line;
    const fenceColumn = extracted?.codePosition?.start.column;
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

  return {
    source,
    diff: parsed.diff,
    hasSource: extracted !== undefined,
  };
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
  readonly diagnostics: DiagnosticCollector;
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
  const validated = validateComponentAttributes({
    component: "Annotation",
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

const lineNumberForSide = ({
  line,
  side,
}: {
  readonly line: DiffLine;
  readonly side: CodeDiffSide;
}): number | undefined =>
  side === "old" ? line.oldLineNumber : line.newLineNumber;

// Indexes both line-number spaces once so every Annotation resolves through
// the same parsed-diff model rather than rebuilding its own view of the lines.
const indexDiffLines = ({
  lines,
}: {
  readonly lines: ReadonlyArray<DiffLine>;
}) => {
  const indexes = {
    old: new Map<string, DiffLine>(),
    new: new Map<string, DiffLine>(),
  };
  for (const line of lines) {
    for (const side of ["old", "new"] satisfies ReadonlyArray<CodeDiffSide>) {
      const lineNumber = lineNumberForSide({ line, side });
      if (lineNumber !== undefined) {
        indexes[side].set(String(lineNumber), line);
      }
    }
  }
  return indexes;
};

const resolveAnnotation = ({
  annotation,
  id,
  sideLines,
  diagnostics,
}: {
  readonly annotation: Annotation;
  readonly id: string;
  readonly sideLines: ReadonlyMap<string, DiffLine>;
  readonly diagnostics: DiagnosticCollector;
}): ResolvedCodeDiffAnnotation | undefined => {
  const existingLineCount = [...sideLines.keys()].filter((line) => {
    const lineNumber = BigInt(line);
    return (
      lineNumber >= annotation.startLine && lineNumber <= annotation.endLine
    );
  }).length;
  const expectedLineCount = annotation.endLine - annotation.startLine + 1n;
  const target = sideLines.get(String(annotation.endLine));
  if (BigInt(existingLineCount) !== expectedLineCount || target === undefined) {
    const lineWord =
      annotation.startLine === annotation.endLine ? "line" : "lines";
    const verb = annotation.startLine === annotation.endLine ? "does" : "do";
    diagnostics.add({
      message: `Annotation ${lineWord} ${annotation.lines} ${verb} not exist on the ${annotation.side} side of the diff`,
      position: annotation.position,
    });
    return undefined;
  }
  return {
    ...annotation,
    startLine: Number(annotation.startLine),
    endLine: Number(annotation.endLine),
    id,
    target,
  };
};

// Resolves valid scoped children into stable line targets while preserving
// authored order and collecting every recoverable contract diagnostic.
const resolveAnnotations = ({
  scopedChildren,
  diff,
  hasSource,
  diagnostics,
}: {
  readonly scopedChildren: ReadonlyArray<ScopedChild>;
  readonly diff: UnifiedDiff;
  readonly hasSource: boolean;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<ResolvedCodeDiffAnnotation> => {
  const annotations = scopedChildren
    .map((child) => annotationFromScopedChild({ child, diagnostics }))
    .filter((annotation): annotation is Annotation => annotation !== undefined);
  if (!hasSource) {
    return [];
  }
  if (!diff.hasHunkHeaders) {
    for (const annotation of annotations) {
      diagnostics.add({
        message:
          "CodeDiff cannot anchor an Annotation without an @@ hunk header",
        position: annotation.position,
      });
    }
    return [];
  }

  const lines = diff.hunks.flatMap((hunk) => hunk.lines);
  const indexes = indexDiffLines({ lines });
  const resolved: Array<ResolvedCodeDiffAnnotation> = [];
  for (const annotation of annotations) {
    const candidate = resolveAnnotation({
      annotation,
      id: `annotation-${resolved.length + 1}`,
      sideLines: indexes[annotation.side],
      diagnostics,
    });
    if (candidate !== undefined) {
      resolved.push(candidate);
    }
  }
  return resolved;
};

/** Compiles one CodeDiff component into the model consumed by renderers. */
export const compileCodeDiffComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: ComponentCompilerInput): CompiledCodeDiff => {
  const validated = validateComponentAttributes({
    component: "CodeDiff",
    attributes,
    position,
    diagnostics,
    schema: CODE_DIFF_SCHEMA,
  });
  const parsed = parseCodeDiffSource({ children, position, diagnostics });
  const showLineNumbers = validated.showLineNumbers === true;
  if (showLineNumbers && !parsed.diff.hasHunkHeaders) {
    diagnostics.add({
      message: "CodeDiff cannot show line numbers without an @@ hunk header",
      position,
    });
  }

  const lines = parsed.diff.hunks.flatMap((hunk) => hunk.lines);
  return {
    filePath: validated.file ?? "",
    source: parsed.source,
    diff: parsed.diff,
    showLineNumbers,
    showLineCounts: validated.showLineCounts === true,
    addedCount: lines.filter((line) => line.kind === "add").length,
    removedCount: lines.filter((line) => line.kind === "remove").length,
    annotations: resolveAnnotations({
      scopedChildren,
      diff: parsed.diff,
      hasSource: parsed.hasSource,
      diagnostics,
    }),
  };
};
