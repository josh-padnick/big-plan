// Renders Slide's structural metadata as a portable note before its heading.

import type { ComponentMarkdownRenderer } from "../_model/markdown-export.js";
import type { CompiledSlide } from "./compile.js";

export const slideMarkdown: ComponentMarkdownRenderer<CompiledSlide> = (
  model,
) => {
  if (model.type === undefined) return "";
  const details = [
    `type: ${model.type}`,
    ...(model.name === undefined ? [] : [`name: ${model.name}`]),
    ...(model.toc === undefined ? [] : [`outline label: ${model.toc}`]),
  ];
  const reason =
    model.wireframeReason === undefined
      ? []
      : [`> Wireframe reason: ${model.wireframeReason}`];
  return [`> Slide structure — ${details.join("; ")}`, ...reason].join("\n");
};
