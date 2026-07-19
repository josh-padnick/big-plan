// Exposes CodeDiff's typed-block integration: validates pre-HAST Annotation
// bodies, compiles authored input, and renders the outer figure around the
// focused header and diff-view modules.

import type { Element } from "hast";
import type { Nodes as MarkdownNode, Root as MarkdownRoot } from "mdast";
import {
  type BlockMarkdownValidator,
  type BlockRenderer,
} from "../registry.js";
import type { DiagnosticCollector } from "../diagnostics.js";
import {
  compileCodeDiffBlock,
  type CompiledCodeDiff,
} from "./compile-code-diff.js";
import { renderCodeDiffHeader } from "./code-diff-header.js";
import { renderCodeDiffViews } from "./code-diff-views.js";

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

const renderCodeDiffFigure = ({
  model,
}: {
  readonly model: CompiledCodeDiff;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    className: FIGURE_CLASSES.split(" "),
    "data-code-diff": "",
    "data-diff-view": "unified",
    "data-diff-path": model.filePath,
    ...(model.showLineNumbers ? { "data-line-numbers": "" } : {}),
  },
  children: [
    renderCodeDiffHeader({
      filePath: model.filePath,
      addedCount: model.addedCount,
      removedCount: model.removedCount,
      showLineCounts: model.showLineCounts,
    }),
    ...renderCodeDiffViews({
      diff: model.diff,
      showLineNumbers: model.showLineNumbers,
      annotations: model.annotations,
    }),
    {
      type: "element",
      tagName: "textarea",
      properties: {
        hidden: true,
        readOnly: true,
        "data-diff-source": "",
      },
      children: [{ type: "text", value: model.source }],
    },
  ],
});

/** Compiles and renders one CodeDiff typed block. */
export const renderCodeDiff: BlockRenderer = (input) =>
  renderCodeDiffFigure({ model: compileCodeDiffBlock(input) });
