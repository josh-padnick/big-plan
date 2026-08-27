// Renders Callout's validated meaning as a labelled Markdown blockquote.

import { markdownFromHast } from "../_model/markdown-export.js";
import type { ComponentMarkdownRenderer } from "../_model/markdown-export.js";
import type { CompiledCallout } from "./compile.js";

export const calloutMarkdown: ComponentMarkdownRenderer<CompiledCallout> = (
  model,
) => {
  const label = `${model.type[0]?.toUpperCase() ?? ""}${model.type.slice(1)}`;
  const title = model.title === undefined ? label : `${label}: ${model.title}`;
  return [
    `> **${title}**`,
    ...markdownFromHast(model.body)
      .split("\n")
      .map((line) => `> ${line}`),
  ].join("\n");
};
