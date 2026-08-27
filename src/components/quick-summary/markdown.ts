// Renders QuickSummary's three ordered facets as ordinary Markdown.

import {
  markdownBullet,
  markdownFromHast,
  markdownInlineText,
} from "../_model/markdown-export.js";
import type { ComponentMarkdownRenderer } from "../_model/markdown-export.js";
import type { CompiledQuickSummary } from "./compile.js";

export const quickSummaryMarkdown: ComponentMarkdownRenderer<
  CompiledQuickSummary
> = (model) =>
  [
    "## Summary",
    ...model.facets.map((facet) =>
      [
        `**${markdownInlineText(facet.name)}**`,
        ...facet.items.map((item) => markdownBullet(markdownFromHast(item))),
      ].join("\n"),
    ),
  ].join("\n\n");
