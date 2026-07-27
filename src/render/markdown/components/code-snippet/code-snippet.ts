// Exposes CodeSnippet's component definition: its scoped Annotation policy,
// authored-input compiler, and outer figure around the header, numbered rows,
// and hidden raw-source copy target.

import type { Element, Text } from "hast";
import {
  type ComponentDefinition,
  type ComponentRenderer,
} from "../../../../model/component-contract.js";
import {
  compileCodeSnippetComponent,
  type CompiledCodeSnippet,
} from "../../../../model/compile-code-snippet.js";
import { renderCodeSnippetStatic } from "../../../../react/code-snippet.js";
import { renderCodeSnippetHeader } from "./code-snippet-header.js";
import { renderCodeSnippetRows } from "./code-snippet-views.js";

const FIGURE_CLASSES =
  "code-snippet mb-5 min-w-0 rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]";

const text = (value: string): Text => ({ type: "text", value });

const renderCodeSnippetFigure = ({
  model,
}: {
  readonly model: CompiledCodeSnippet;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    className: FIGURE_CLASSES.split(" "),
    "data-code-snippet": "",
    ...(model.filePath === undefined
      ? {}
      : { "data-snippet-path": model.filePath }),
    ...(model.showLineNumbers ? { "data-line-numbers": "" } : {}),
  },
  children: [
    renderCodeSnippetHeader({
      ...(model.filePath === undefined ? {} : { filePath: model.filePath }),
    }),
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["code-snippet-body", "min-w-0", "overflow-x-auto"],
      },
      children: [
        ...renderCodeSnippetRows({
          highlightedLines: model.highlightedLines,
          startLine: model.startLine,
          showLineNumbers: model.showLineNumbers,
          annotations: model.annotations,
        }),
      ],
    },
    {
      type: "element",
      tagName: "textarea",
      properties: {
        hidden: true,
        readOnly: true,
        "data-snippet-source": "",
      },
      children: [text(model.source)],
    },
  ],
});

/** Compiles and renders one CodeSnippet component. */
export const renderCodeSnippet: ComponentRenderer = (input) =>
  renderCodeSnippetFigure({ model: compileCodeSnippetComponent(input) });

/** Declares CodeSnippet's renderer and direct-child Annotation contract. */
export const CODE_SNIPPET_COMPONENT_DEFINITION = {
  render: renderCodeSnippet,
  compile: compileCodeSnippetComponent,
  renderStatic: (input) =>
    renderCodeSnippetStatic(compileCodeSnippetComponent(input)),
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
