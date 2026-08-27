// Renders FileTreeDiff with literal change words, rename paths, and a legend.

import {
  markdownFence,
  markdownInlineText,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { TreeEntry } from "../_model/tree-text/parse-tree-text.js";
import type { CompiledFileTreeDiff } from "./compile.js";

const treeLines = (
  entries: ReadonlyArray<TreeEntry>,
  depth = 0,
): ReadonlyArray<string> =>
  entries.flatMap((entry) => {
    const name =
      entry.oldName === undefined
        ? entry.name
        : `${entry.oldName} -> ${entry.name}`;
    const state =
      entry.badge === undefined
        ? ""
        : ` [${entry.badge[0]?.toUpperCase() ?? ""}${entry.badge.slice(1)}]`;
    return [
      `${"  ".repeat(depth)}${name}${state}${entry.note === undefined ? "" : ` — ${entry.note}`}`,
      ...treeLines(entry.children, depth + 1),
    ];
  });

export const fileTreeDiffMarkdown: ComponentMarkdownRenderer<
  CompiledFileTreeDiff
> = (model) =>
  [
    ...(model.title === undefined
      ? []
      : [`### ${markdownInlineText(model.title)}`]),
    markdownFence({
      source: treeLines(model.entries).join("\n"),
      language: "text",
    }),
    "Legend: Added, Modified, Removed, and Renamed are literal change states.",
  ].join("\n\n");
