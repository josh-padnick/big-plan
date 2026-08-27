// Renders Callout's validated meaning as a labelled Markdown blockquote.

import {
  markdownFromHast,
  markdownInlineText,
} from "../_model/markdown-export.js";
import type { ComponentMarkdownRenderer } from "../_model/markdown-export.js";
import type { CompiledCallout } from "./compile.js";

export const calloutMarkdown: ComponentMarkdownRenderer<CompiledCallout> = (
  model,
) => {
  const label = `${model.type[0]?.toUpperCase() ?? ""}${model.type.slice(1)}`;
  const title =
    model.title === undefined
      ? label
      : `${label}: ${markdownInlineText(model.title)}`;
  const body = markdownFromHast(model.body);
  return [
    `> **${title}**`,
    // The blank quote line is what keeps the label its own paragraph instead
    // of letting it run into the first body sentence.
    ...(body === ""
      ? []
      : [
          ">",
          ...body.split("\n").map((line) => (line === "" ? ">" : `> ${line}`)),
        ]),
  ].join("\n");
};
