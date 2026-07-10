// The renderer's public entry point: composes the markdown pipeline and the
// document shell into one markdown-in, complete-HTML-out function.

import { convertMarkdown } from "./markdown.js";
import { renderShell } from "./shell.js";

export type RenderedDocument = {
  readonly html: string;
  readonly sectionCount: number;
};

/**
 * Renders GFM markdown into a complete, self-contained HTML review document.
 * Pure: no I/O, so callers own where the markdown comes from and where the
 * HTML goes.
 */
export const renderDocument = ({
  markdown,
  title,
}: {
  readonly markdown: string;
  readonly title: string;
}): RenderedDocument => {
  const { bodyHtml, sections } = convertMarkdown({ markdown });
  const html = renderShell({ title, sections, bodyHtml });
  return { html, sectionCount: sections.length };
};
