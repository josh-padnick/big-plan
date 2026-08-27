// Renders FileTree's hierarchy as a labelled plain-text fence.

import {
  markdownFence,
  markdownHeading,
  markdownInlineText,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { TreeEntry } from "../_model/tree-text/parse-tree-text.js";
import type { CompiledFileTree } from "./compile.js";

const treeLines = (
  entries: ReadonlyArray<TreeEntry>,
  depth = 0,
): ReadonlyArray<string> =>
  entries.flatMap((entry) => [
    `${"  ".repeat(depth)}${entry.name}${entry.note === undefined ? "" : ` — ${entry.note}`}`,
    ...treeLines(entry.children, depth + 1),
  ]);

export const fileTreeMarkdown: ComponentMarkdownRenderer<CompiledFileTree> = (
  model,
  { headingOffset },
) =>
  [
    ...(model.title === undefined
      ? []
      : [
          markdownHeading({
            level: 3,
            offset: headingOffset,
            text: markdownInlineText(model.title),
          }),
        ]),
    markdownFence({
      source: treeLines(model.entries).join("\n"),
      language: "text",
    }),
  ].join("\n\n");
