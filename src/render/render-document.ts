// The renderer's public entry point: composes the markdown pipeline, the
// review shell, and the page envelope into one markdown-in, complete-HTML-out
// function.

import type { Section } from "./markdown/convert.js";
import {
  compileMarkdown,
  serializeMarkdown,
} from "./markdown/convert.js";
import { renderPage } from "./page.js";
import { renderShell } from "./shell/shell.js";

export type RenderedDocument = {
  readonly html: string;
  readonly title: string;
  readonly sections: ReadonlyArray<Section>;
};

/**
 * Renders GFM markdown into a complete, self-contained HTML review document.
 * The title is the document's first h1 when present, otherwise the caller's
 * fallback. Pure: no I/O, so callers own where the markdown comes from and
 * where the HTML goes.
 */
export const renderDocument = ({
  markdown,
  fallbackTitle,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
}): RenderedDocument => {
  const { root, sections, elementIds, title } = compileMarkdown({ markdown });
  const resolvedTitle = title ?? fallbackTitle;
  const shell = renderShell({
    nav: sections.map((section) => ({ id: section.id, label: section.text })),
    contentIds: elementIds,
    contentHtml: serializeMarkdown({ root }),
  });
  const html = renderPage({
    title: resolvedTitle,
    styles: shell.styles,
    scripts: shell.scripts,
    bodyClassName: shell.bodyClassName,
    bodyHtml: shell.html,
  });
  return { html, title: resolvedTitle, sections };
};
