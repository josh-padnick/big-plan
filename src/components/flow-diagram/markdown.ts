// Renders FlowDiagram's ordered stages, nodes, explicit edges, and footer.

import {
  markdownBullet,
  markdownFromHast,
  markdownHeading,
  markdownInlineCode,
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledFlowDiagram } from "./compile.js";

export const flowDiagramMarkdown: ComponentMarkdownRenderer<
  CompiledFlowDiagram
> = (model, { headingOffset }) => {
  const stages = model.stages.map((stage, index) =>
    [
      markdownHeading({
        level: 4,
        offset: headingOffset,
        text: `Stage ${index + 1}: ${markdownInlineText(stage.title)}`,
      }),
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
    markdownHeading({
      level: 3,
      offset: headingOffset,
      text: "Flow diagram",
    }),
    ...stages,
    ...(model.edges.length === 0
      ? []
      : [
          markdownHeading({
            level: 4,
            offset: headingOffset,
            text: "Connections",
          }),
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
