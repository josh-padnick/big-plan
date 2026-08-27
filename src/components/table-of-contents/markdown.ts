// Renders the overview against the completed document outline.

import type { ComponentMarkdownRenderer } from "../_model/markdown-export.js";
import type { CompiledTableOfContents } from "./compile.js";

const anchorFor = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");

export const tableOfContentsMarkdown: ComponentMarkdownRenderer<
  CompiledTableOfContents
> = (model, { outline }) => {
  let partNumber: number | undefined;
  const rows: Array<string> = ["## Plan outline"];
  model.entries.forEach((entry, index) => {
    const section = outline.sections[index];
    if (section?.part !== undefined && section.part.number !== partNumber) {
      partNumber = section.part.number;
      rows.push(`- **Part ${section.part.number} — ${section.part.title}**`);
    }
    const prefix = section?.part === undefined ? "-" : "  -";
    const title = section?.title ?? entry.section;
    rows.push(
      `${prefix} [${entry.section}](#${section?.id ?? anchorFor(title)}) — ${entry.gist}`,
    );
  });
  return rows.join("\n");
};
