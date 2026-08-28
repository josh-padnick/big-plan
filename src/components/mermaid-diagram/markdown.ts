// Renders MermaidDiagram's exact portable source and authored footer.

import {
  markdownFence,
  markdownFromHast,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledMermaidDiagram } from "./compile.js";

export const mermaidDiagramMarkdown: ComponentMarkdownRenderer<
  CompiledMermaidDiagram
> = (model) =>
  [
    markdownFence({ source: model.source, language: "mermaid" }),
    ...(model.footer === undefined ? [] : [markdownFromHast(model.footer)]),
  ].join("\n\n");
