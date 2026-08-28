// Declares MermaidDiagram's fenced-source contract and pairs its compiler with
// the static SVG viewer.

import { defineComponent } from "../_registration/define-component.js";
import { compileMermaidDiagramComponent } from "./compile.js";
import { MermaidDiagram } from "./view.js";
import { mermaidDiagramMarkdown } from "./markdown.js";

export const MERMAID_DIAGRAM_COMPONENT_DEFINITION = defineComponent({
  compile: compileMermaidDiagramComponent,
  view: MermaidDiagram,
  markdown: mermaidDiagramMarkdown,
});
