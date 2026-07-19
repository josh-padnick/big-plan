// Exposes CodeDiff's typed-block definition: its scoped Annotation policy,
// authored-input compiler, and outer figure around focused render modules.

import type { Element } from "hast";
import { type BlockDefinition, type BlockRenderer } from "../block-contract.js";
import {
  compileCodeDiffBlock,
  type CompiledCodeDiff,
} from "./compile-code-diff.js";
import { renderCodeDiffHeader } from "./code-diff-header.js";
import { renderCodeDiffViews } from "./code-diff-views.js";

const FIGURE_CLASSES =
  "code-diff mb-5 min-w-0 rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]";

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

/** Declares CodeDiff's renderer and direct-child Annotation contract. */
export const CODE_DIFF_BLOCK_DEFINITION = {
  render: renderCodeDiff,
  scopedChildren: {
    Annotation: {
      kind: "scoped-child",
      markdownBody: {
        prohibited: {
          heading: "Annotation bodies cannot contain headings",
          footnoteReference:
            "Annotation bodies cannot contain footnote references",
          footnoteDefinition:
            "Annotation bodies cannot contain footnote definitions",
          registeredBlock: "Annotation bodies cannot contain typed blocks",
        },
      },
    },
  },
} satisfies BlockDefinition;
