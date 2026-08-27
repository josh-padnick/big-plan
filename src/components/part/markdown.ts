// Renders Part's visual act boundary as an explicit numbered Markdown heading.

import {
  markdownInlineText,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledPart } from "./compile.js";

export const partMarkdown: ComponentMarkdownRenderer<CompiledPart> = (
  model,
  { outline },
) => {
  const number = outline.parts.find((part) => part.id === model.id)?.number;
  return `---\n\n## ${number === undefined ? "Part" : `Part ${number}`} — ${markdownInlineText(model.title)}`;
};
