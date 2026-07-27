// Exposes FileTree's component definition: it validates the shared title and
// tree-fence contract, rejects change syntax, and renders a plain semantic
// hierarchy through the shared tree renderer.

import type { Element, Text } from "hast";
import {
  type ComponentDefinition,
  type ComponentRenderer,
} from "../../../../model/component-contract.js";
import {
  compileFileTree,
  type CompiledFileTree,
} from "../../../../model/compile-file-tree.js";
import {
  renderTreeFoldControls,
  renderTreeHierarchy,
} from "./tree-hierarchy.js";

const FIGURE_CLASSES =
  "file-tree mb-5 min-w-0 overflow-hidden rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]";
const HEADER_CLASSES =
  "file-tree-header flex min-w-0 items-center justify-between gap-3 border-b border-edge px-[0.65rem] py-[0.4rem] font-sans text-sm font-semibold text-ink";
const BODY_CLASSES = "file-tree-body overflow-x-auto px-3 py-2.5";

const text = (value: string): Text => ({ type: "text", value });

const titleElement = (title: string | undefined): ReadonlyArray<Element> =>
  title === undefined
    ? []
    : [
        {
          type: "element",
          tagName: "figcaption",
          properties: { className: HEADER_CLASSES.split(" ") },
          children: [
            {
              type: "element",
              tagName: "span",
              properties: { className: ["file-tree-title", "truncate"] },
              children: [text(title)],
            },
            {
              type: "element",
              tagName: "span",
              properties: {
                className: [
                  "file-tree-controls",
                  "flex",
                  "shrink-0",
                  "items-center",
                  "gap-1",
                ],
              },
              children: [...renderTreeFoldControls({ tone: "standard" })],
            },
          ],
        },
      ];

const renderFileTreeFigure = ({
  model,
}: {
  readonly model: CompiledFileTree;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    className: FIGURE_CLASSES.split(" "),
    "data-file-tree": "",
  },
  children: [
    ...titleElement(model.title),
    {
      type: "element",
      tagName: "div",
      properties: { className: BODY_CLASSES.split(" ") },
      children: [
        renderTreeHierarchy({
          noteDisplay: "inline",
          entries: model.entries,
          nameForEntry: (entry) => entry.name,
          badgeForEntry: () => undefined,
        }),
      ],
    },
  ],
});

/** Compiles and renders one FileTree component. */
export const renderFileTree: ComponentRenderer = (input) =>
  renderFileTreeFigure({ model: compileFileTree(input) });

/** Declares FileTree's complete component integration contract. */
export const FILE_TREE_COMPONENT_DEFINITION = {
  render: renderFileTree,
  compile: compileFileTree,
} satisfies ComponentDefinition;
