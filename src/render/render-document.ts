// The renderer's public entry point: composes the markdown pipeline, the
// review shell, and the page envelope into one markdown-in, complete-HTML-out
// function.

import { convertMarkdown } from "./markdown.js";
import { renderPage } from "./page.js";
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
  const shell = renderShell({ sections, contentHtml: bodyHtml });
  const html = renderPage({
    title,
    styles: shell.styles,
    scripts: shell.scripts,
    bodyClassName: shell.bodyClassName,
    bodyHtml: shell.html,
  });
  return { html, sectionCount: sections.length };
};
