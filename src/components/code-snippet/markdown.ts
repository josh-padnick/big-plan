// Renders CodeSnippet's exact source and line-addressed annotations.

import {
  markdownBullet,
  markdownFence,
  markdownFromHast,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledCodeSnippet } from "./compile.js";

export const codeSnippetMarkdown: ComponentMarkdownRenderer<
  CompiledCodeSnippet
> = (model) => {
  const metadata = [
    ...(model.filePath === undefined
      ? []
      : [`**File:** \`${model.filePath}\``]),
    ...(model.startLine === 1
      ? []
      : [`**Starts at line:** ${model.startLine}`]),
  ];
  const annotations = model.annotations.map((annotation) =>
    markdownBullet(
      `**${annotation.start === annotation.end ? "Line" : "Lines"} ${annotation.sourceValue}:** ${markdownFromHast(annotation.children)}`,
    ),
  );
  return [
    ...metadata,
    markdownFence({ source: model.source, language: model.language ?? "" }),
    ...(annotations.length === 0
      ? []
      : ["**Annotations**\n" + annotations.join("\n")]),
  ].join("\n\n");
};
