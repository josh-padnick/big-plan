// Renders QuickSummary's three ordered facets as ordinary Markdown.

import { markdownFromHast } from "../_model/markdown-export.js";
import type { ComponentMarkdownRenderer } from "../_model/markdown-export.js";
import type { CompiledQuickSummary } from "./compile.js";

export const quickSummaryMarkdown: ComponentMarkdownRenderer<
  CompiledQuickSummary
> = (model) =>
  [
    "## Summary",
    ...model.facets.map((facet) =>
      [
        `**${facet.name}**`,
        ...facet.items.map((item) => `- ${markdownFromHast(item)}`),
      ].join("\n"),
    ),
  ].join("\n\n");
