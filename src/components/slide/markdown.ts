// Renders Slide's structural metadata as a portable note before its heading.

import {
  markdownInlineText,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledSlide } from "./compile.js";

export const slideMarkdown: ComponentMarkdownRenderer<CompiledSlide> = (
  model,
) => {
  if (model.type === undefined) return "";
  const details = [
    `type: ${model.type}`,
    ...(model.name === undefined
      ? []
      : [`name: ${markdownInlineText(model.name)}`]),
    ...(model.toc === undefined
      ? []
      : [`outline label: ${markdownInlineText(model.toc)}`]),
  ];
  const reason =
    model.wireframeReason === undefined
      ? []
      : [`> Wireframe reason: ${markdownInlineText(model.wireframeReason)}`];
  return [`> Slide structure — ${details.join("; ")}`, ...reason].join("\n");
};
