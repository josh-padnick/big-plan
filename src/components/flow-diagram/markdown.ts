// Renders FlowDiagram's ordered stages, nodes, explicit edges, and footer.

import {
  markdownBullet,
  markdownFromHast,
  markdownInlineCode,
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledFlowDiagram } from "./compile.js";

export const flowDiagramMarkdown: ComponentMarkdownRenderer<
  CompiledFlowDiagram
> = (model) => {
  const stages = model.stages.map((stage, index) =>
    [
      `#### Stage ${index + 1}: ${markdownInlineText(stage.title)}`,
      ...stage.nodes.map((node) => {
        const properties = [
          `id ${markdownInlineCode(node.id)}`,
          `tone ${node.tone}`,
          ...(node.code === undefined
            ? []
            : [`code ${markdownInlineCode(node.code)}`]),
          ...(node.badge === undefined
            ? []
            : [`status ${markdownInlineText(node.badge)} (${node.badgeTone})`]),
        ];
        const body = markdownFromHast(node.body);
        return markdownBullet(
          `**${markdownInlineText(node.label)}** (${properties.join("; ")})${body === "" ? "" : ` — ${body}`}`,
        );
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
              markdownInlineText(edge.from),
              markdownInlineText(edge.label ?? "connects to"),
              markdownInlineText(edge.to),
            ]),
          }),
        ]),
    ...(model.footer === undefined ? [] : [markdownFromHast(model.footer)]),
  ].join("\n\n");
};
