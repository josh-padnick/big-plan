// The renderer's public entry point: composes the shared MDX pipeline into
// either a validated plan model or a complete HTML review document.

import type { Section } from "./markdown/convert.js";
import { compileMarkdown, serializeMarkdown } from "./markdown/convert.js";
import type { RendererKind } from "./markdown/convert.js";
export type { RendererKind } from "./markdown/convert.js";
export { MarkdownDiagnosticsError } from "./markdown/convert.js";
import type { CollectedComponentModel } from "./markdown/convert.js";
import { renderPage } from "./page.js";
import { renderShell } from "./shell/shell.js";

export type RenderedDocument = {
  readonly html: string;
  readonly title: string;
  readonly sections: ReadonlyArray<Section>;
};

/**
 * Renders static-subset MDX into a complete, self-contained HTML review document.
 * The title is the document's first h1 when present, otherwise the caller's
 * fallback. Pure: no I/O, so callers own where the MDX comes from and where
 * the HTML goes.
 */
export const renderDocument = ({
  markdown,
  fallbackTitle,
  renderer,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
  readonly renderer?: RendererKind;
}): RenderedDocument => {
  const { root, sections, elementIds, title } = compileMarkdown({
    markdown,
    ...(renderer === undefined ? {} : { renderer }),
  });
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

export type PlanModel = {
  readonly title: string;
  readonly sections: ReadonlyArray<Section>;
  readonly components: ReadonlyArray<CollectedComponentModel>;
};

/**
 * Compiles one plan into its validated model without serializing HTML: the
 * document title, the section outline, and every component instance's plan
 * model in document order. Diagnostics hard-fail exactly as rendering does,
 * so a model is only ever produced for a valid plan.
 */
export const compilePlanModel = ({
  markdown,
  fallbackTitle,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
}): PlanModel => {
  const components: Array<CollectedComponentModel> = [];
  const { sections, title } = compileMarkdown({ markdown, models: components });
  return {
    title: title ?? fallbackTitle,
    sections,
    components: sortedBySourcePosition(components),
  };
};

// Collection happens child-first (a component's nested children finish
// rendering before it does), so document order - the contract the compile
// command documents - is restored by source position; the sort is stable, so
// entries without positions keep their collection order at the end.
const sortedBySourcePosition = (
  components: ReadonlyArray<CollectedComponentModel>,
): ReadonlyArray<CollectedComponentModel> =>
  [...components].sort(
    (a, b) =>
      (a.line ?? Number.MAX_SAFE_INTEGER) -
        (b.line ?? Number.MAX_SAFE_INTEGER) ||
      (a.column ?? Number.MAX_SAFE_INTEGER) -
        (b.column ?? Number.MAX_SAFE_INTEGER),
  );
