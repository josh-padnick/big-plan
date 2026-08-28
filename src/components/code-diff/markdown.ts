// Renders CodeDiff's canonical patch and side-specific annotations.

import {
  markdownBullet,
  markdownFence,
  markdownFromHast,
  markdownInlineCode,
  markdownInlineText,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledCodeDiff } from "./compile.js";

export const codeDiffMarkdown: ComponentMarkdownRenderer<CompiledCodeDiff> = (
  model,
) => {
  const annotations = model.annotations.map((annotation) =>
    markdownBullet(
      `**${annotation.side} ${annotation.startLine === annotation.endLine ? "line" : "lines"} ${markdownInlineText(annotation.lines)}:** ${markdownFromHast(annotation.children)}`,
    ),
  );
  return [
    `**File:** ${markdownInlineCode(model.filePath)} · Added ${model.addedCount} · Removed ${model.removedCount}`,
    markdownFence({ source: model.source, language: "diff" }),
    ...(annotations.length === 0
      ? []
      : ["**Annotations**\n" + annotations.join("\n")]),
  ].join("\n\n");
};
