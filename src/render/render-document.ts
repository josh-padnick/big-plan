// The renderer's public entry point: composes the MDX pipeline, the review
// shell, and the page envelope into one MDX-in, complete-HTML-out
// function.

import type { Section } from "./markdown/convert.js";
import { compileMarkdown, serializeMarkdown } from "./markdown/convert.js";
export { MarkdownDiagnosticsError } from "./markdown/convert.js";
import type { ForcedTheme } from "./page.js";
import { renderPage } from "./page.js";
import { renderEmbedShell } from "./shell/embed-shell.js";
import { renderShell } from "./shell/shell.js";

export type RenderedDocument = {
  readonly html: string;
  readonly title: string;
  readonly sections: ReadonlyArray<Section>;
};

// The envelope selects how the rendered document is delivered: the full
// review shell (branding bar, navigation, theme control), or the chromeless
// embed surface for hosting inside another page, optionally pinned to one
// color scheme so the embed matches its host.
export type DocumentEnvelope =
  | { readonly mode: "viewer" }
  | { readonly mode: "embed"; readonly theme?: ForcedTheme };

/**
 * Renders static-subset MDX into a complete, self-contained HTML review document.
 * The title is the document's first h1 when present, otherwise the caller's
 * fallback. Pure: no I/O, so callers own where the MDX comes from and where
 * the HTML goes.
 */
export const renderDocument = ({
  markdown,
  fallbackTitle,
  envelope = { mode: "viewer" },
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
  readonly envelope?: DocumentEnvelope;
}): RenderedDocument => {
  const { root, sections, elementIds, title } = compileMarkdown({ markdown });
  const resolvedTitle = title ?? fallbackTitle;
  const contentHtml = serializeMarkdown({ root });
  const shell =
    envelope.mode === "embed"
      ? renderEmbedShell({ contentHtml })
      : renderShell({
          nav: sections.map((section) => ({
            id: section.id,
            label: section.text,
          })),
          contentIds: elementIds,
          contentHtml,
        });
  const html = renderPage({
    title: resolvedTitle,
    styles: shell.styles,
    scripts: shell.scripts,
    bodyClassName: shell.bodyClassName,
    bodyHtml: shell.html,
    ...(envelope.mode === "embed" && envelope.theme !== undefined
      ? { forcedTheme: envelope.theme }
      : {}),
  });
  return { html, title: resolvedTitle, sections };
};
