// Renders QuickSummary's three ordered facets as ordinary Markdown.

import {
  markdownBullet,
  markdownFromHast,
  markdownHeading,
  markdownInlineText,
} from "../_model/markdown-export.js";
import type { ComponentMarkdownRenderer } from "../_model/markdown-export.js";
import type { CompiledQuickSummary } from "./compile.js";

export const quickSummaryMarkdown: ComponentMarkdownRenderer<
  CompiledQuickSummary
> = (model, { headingOffset }) =>
  [
    markdownHeading({ level: 2, offset: headingOffset, text: "Summary" }),
    ...model.facets.map((facet) =>
      [
        `**${markdownInlineText(facet.name)}**`,
        ...facet.items.map((item) => markdownBullet(markdownFromHast(item))),
      ].join("\n"),
    ),
  ].join("\n\n");
