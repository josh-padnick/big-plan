// The renderer's document entry points: render HTML or exercise HTML and model
// delivery together for validation.

import {
  componentsInDocumentOrder,
  type PlanModel,
} from "./compile-plan-model.js";
import type { CompiledMarkdown, Section } from "./markdown/compile-markdown.js";
import {
  compileMarkdown,
  compileMarkdownWithModels,
  serializeMarkdown,
} from "./markdown/compile-markdown.js";
export { MarkdownDiagnosticsError } from "./markdown/compile-markdown.js";
import { renderPage } from "./page.js";
import { renderShell } from "./shell/shell.js";

export type RenderedDocument = {
  readonly html: string;
  readonly title: string;
  readonly sections: ReadonlyArray<Section>;
};

const renderCompiledDocument = ({
  compiled,
  fallbackTitle,
}: {
  readonly compiled: CompiledMarkdown;
  readonly fallbackTitle: string;
}): RenderedDocument => {
  const { root, sections, elementIds, title } = compiled;
  const resolvedTitle = title ?? fallbackTitle;
  const shell = renderShell({
    nav: sections.map((section) => ({ id: section.id, label: section.text })),
    contentIds: elementIds,
    contentHtml: serializeMarkdown({ root }),
  });
  const html = renderPage({
    title: resolvedTitle,
    styles: shell.styles,
    bodyClassName: shell.bodyClassName,
    bodyHtml: shell.html,
  });
  return { html, title: resolvedTitle, sections };
};

/**
 * Renders a validated MDX plan into a complete, self-contained HTML review document.
 * The title is the document's first h1 when present, otherwise the caller's
 * fallback. Pure: no I/O, so callers own where the MDX comes from and where
 * the HTML goes.
 */
export const renderDocument = ({
  markdown,
  fallbackTitle,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
}): RenderedDocument => {
  const compiled = compileMarkdown({ markdown });
  return renderCompiledDocument({
    compiled,
    fallbackTitle,
  });
};

/**
 * Exercises complete HTML delivery while returning the collected plan-model
 * summary and discarding the generated document.
 */
export const validateDocument = ({
  markdown,
  fallbackTitle,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
}): PlanModel => {
  const compiled = compileMarkdownWithModels({ markdown });
  const rendered = renderCompiledDocument({ compiled, fallbackTitle });
  return {
    title: rendered.title,
    sections: compiled.sections,
    components: componentsInDocumentOrder(compiled.components),
  };
};
