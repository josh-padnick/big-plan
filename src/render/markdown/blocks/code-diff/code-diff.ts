// Owns CodeDiff's authored MDX contract and typed-block orchestration:
// validates the fence and scoped Annotations, parses and anchors the diff,
// then delegates header and view HAST construction.

import type { Element, ElementContent, Root, Text } from "hast";
import type { Nodes as MarkdownNode, Root as MarkdownRoot } from "mdast";
import {
  validateBlockAttributes,
  type BlockAttributeSchema,
  type BlockMarkdownValidator,
  type BlockRenderer,
  type ScopedChild,
} from "../registry.js";
import type { DiagnosticCollector } from "../diagnostics.js";
import { renderCodeDiffHeader } from "./code-diff-header.js";
import { renderCodeDiffViews } from "./code-diff-views.js";
import type { CodeDiffSide } from "./code-diff-views.js";
import { parseUnifiedDiff } from "./unified-diff.js";
import type { DiffLine, UnifiedDiff } from "./unified-diff.js";

type NodePosition = Root["position"];

const CODE_DIFF_SCHEMA = {
  file: { kind: "string", required: true, nonEmpty: true },
  showLineNumbers: { kind: "booleanShorthand" },
  showLineCounts: { kind: "booleanShorthand" },
} satisfies BlockAttributeSchema;

const ANNOTATION_SCHEMA = {
  side: {
    kind: "enum",
    values: ["old", "new"] satisfies ReadonlyArray<CodeDiffSide>,
  },
} satisfies BlockAttributeSchema;

type Annotation = {
  readonly lines: string;
  readonly startLine: bigint;
  readonly endLine: bigint;
  readonly side: CodeDiffSide;
  readonly children: ReadonlyArray<ElementContent>;
  readonly position: NodePosition;
};

type ResolvedAnnotation = Annotation & {
  readonly id: string;
  readonly target: DiffLine;
};

const FIGURE_CLASSES =
  "code-diff mb-5 min-w-0 rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]";

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

/** Validates Annotation body semantics before Markdown becomes HAST. */
export const validateCodeDiffMarkdown: BlockMarkdownValidator = ({
  tree,
  diagnostics,
  registeredBlockNames,
}) => {
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

const lineNumberForSide = ({
  line,
  side,
}: {
  readonly line: DiffLine;
  readonly side: CodeDiffSide;
}): number | undefined =>
  side === "old" ? line.oldLineNumber : line.newLineNumber;

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
  const resolvedAnnotations: Array<ResolvedAnnotation> = [];
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
      resolvedAnnotations.push({
        ...annotation,
        id: `annotation-${resolvedAnnotations.length + 1}`,
        target,
      });
    }
  }

  const filePath = validated.file ?? "";
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
      renderCodeDiffHeader({
        filePath,
        addedCount,
        removedCount,
        showLineCounts: validated.showLineCounts === true,
      }),
      ...renderCodeDiffViews({
        diff: parsed.diff,
        showLineNumbers,
        annotations: resolvedAnnotations,
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
