// Renders DataTable's complete authored grid, grouping dimension, and summary.

import {
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledDataTable } from "./compile.js";

export const dataTableMarkdown: ComponentMarkdownRenderer<CompiledDataTable> = (
  model,
) => {
  const rows = model.rows.map((row) =>
    row.cells.map((cell) => markdownInlineText(cell.text)),
  );
  if (model.summaryRow !== undefined) {
    rows.push(
      model.summaryRow.cells.map((cell, index) =>
        markdownInlineText(index === 0 ? `Summary: ${cell.text}` : cell.text),
      ),
    );
  }
  return [
    ...(model.title === undefined ? [] : [`### ${model.title}`]),
    ...(model.groupColumn === -1
      ? []
      : [`**Grouped by:** ${model.columns[model.groupColumn]?.label ?? ""}`]),
    markdownTable({
      headers: model.columns.map((column) => markdownInlineText(column.label)),
      rows,
      alignments: model.columns.map((column) => column.align),
    }),
  ].join("\n\n");
};
