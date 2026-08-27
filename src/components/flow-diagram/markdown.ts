// Renders FlowDiagram's ordered stages, nodes, explicit edges, and footer.

import {
  markdownFromHast,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledFlowDiagram } from "./compile.js";

export const flowDiagramMarkdown: ComponentMarkdownRenderer<
  CompiledFlowDiagram
> = (model) => {
  const stages = model.stages.map((stage, index) =>
    [
      `#### Stage ${index + 1}: ${stage.title}`,
      ...stage.nodes.map((node) => {
        const properties = [
          `id \`${node.id}\``,
          `tone ${node.tone}`,
          ...(node.code === undefined ? [] : [`code \`${node.code}\``]),
          ...(node.badge === undefined
            ? []
            : [`status ${node.badge} (${node.badgeTone})`]),
        ];
        const body = markdownFromHast(node.body);
        return `- **${node.label}** (${properties.join("; ")})${body === "" ? "" : ` — ${body}`}`;
      }),
    ].join("\n"),
  );
  return [
    "### Flow diagram",
    ...stages,
    ...(model.edges.length === 0
      ? []
      : [
          "#### Connections",
          markdownTable({
            headers: ["From", "Relationship", "To"],
            rows: model.edges.map((edge) => [
              edge.from,
              edge.label ?? "connects to",
              edge.to,
            ]),
          }),
        ]),
    ...(model.footer === undefined ? [] : [markdownFromHast(model.footer)]),
  ].join("\n\n");
};
