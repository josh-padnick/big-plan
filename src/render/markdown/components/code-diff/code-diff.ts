// Exposes CodeDiff's component definition: its scoped Annotation policy,
// authored-input compiler, and outer figure around focused render modules.

import type { Element } from "hast";
import {
  type ComponentDefinition,
  type ComponentRenderer,
} from "../../../../model/component-contract.js";
import {
  compileCodeDiffComponent,
  type CompiledCodeDiff,
} from "../../../../model/compile-code-diff.js";
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

/** Compiles and renders one CodeDiff component. */
export const renderCodeDiff: ComponentRenderer = (input) =>
  renderCodeDiffFigure({ model: compileCodeDiffComponent(input) });

/** Declares CodeDiff's renderer and direct-child Annotation contract. */
export const CODE_DIFF_COMPONENT_DEFINITION = {
  render: renderCodeDiff,
  compile: compileCodeDiffComponent,
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
          registeredComponent:
            "Annotation bodies cannot contain typed components",
        },
      },
    },
  },
} satisfies ComponentDefinition;
