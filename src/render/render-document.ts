// The renderer's document entry points: render HTML or exercise HTML and model
// delivery together for validation.

import {
  componentsInDocumentOrder,
  type PlanModel,
} from "./compile-plan-model.js";
import type {
  BlockDescriptor,
  CompiledMarkdown,
  Section,
} from "./markdown/compile-markdown.js";
import {
  compileMarkdown,
  compileMarkdownWithModels,
} from "./markdown/compile-markdown.js";
export { MarkdownDiagnosticsError } from "./markdown/compile-markdown.js";
export type { BlockDescriptor } from "./markdown/compile-markdown.js";
import { renderPage } from "./page.js";
import { derivePlanId } from "./plan-id.js";
import { serializeHtml } from "./serialize-html.js";
import { renderShell } from "./shell/shell.js";

export type RenderedDocument = {
  readonly html: string;
  readonly title: string;
  readonly sections: ReadonlyArray<Section>;
  // Every commentable unit the document addressed, so a caller holding the
  // rendered page can resolve a comment target without parsing the HTML back.
  readonly blocks: ReadonlyArray<BlockDescriptor>;
};

/** Document-level identity a rendered page carries for the viewer. */
export type DocumentIdentity = {
  // Namespaces persisted viewer state; absent means the viewer persists
  // nothing rather than guessing a namespace from the title.
  readonly planId?: string;
  // Present only when a local review runtime rendered and served this copy.
  readonly reviewSessionId?: string;
  readonly reviewToken?: string;
  // Validated runtime state serialized by the server. The viewer reads this
  // synchronously before constructing its chrome, so reload recovery is part
  // of the first interactive paint rather than an empty-state flash.
  readonly reviewBootstrap?: string;
};

const rootAttributesFor = (
  identity: DocumentIdentity,
): Readonly<Record<string, string>> => ({
  ...(identity.planId === undefined ? {} : { "data-plan-id": identity.planId }),
  ...(identity.reviewSessionId === undefined
    ? {}
    : { "data-review-session": identity.reviewSessionId }),
  ...(identity.reviewToken === undefined
    ? {}
    : { "data-review-token": identity.reviewToken }),
  ...(identity.reviewBootstrap === undefined
    ? {}
    : { "data-review-bootstrap": identity.reviewBootstrap }),
});

const renderCompiledDocument = ({
  compiled,
  fallbackTitle,
  planId,
}: {
  readonly compiled: CompiledMarkdown;
  readonly fallbackTitle: string;
  readonly planId?: string;
}): RenderedDocument => {
  const { root, sections, elementIds, title, partIds, blocks } = compiled;
  const resolvedTitle = title ?? fallbackTitle;
  // A section's part gains the rendered divider's anchor so the TOC's act
  // headers link to the divider band itself.
  const nav = sections.map((section) => {
    if (section.part === undefined) {
      return { id: section.id, label: section.text };
    }
    const partId = partIds[section.part.number - 1];
    return {
      id: section.id,
      label: section.text,
      part: {
        ...section.part,
        ...(partId === undefined || partId === "" ? {} : { id: partId }),
      },
    };
  });
  const shell = renderShell({
    nav,
    title: resolvedTitle,
    contentIds: elementIds,
    contentHtml: serializeHtml({ root }),
  });
  const html = renderPage({
    title: resolvedTitle,
    styles: shell.styles,
    bodyClassName: shell.bodyClassName,
    bodyHtml: shell.html,
    planId,
  });
  return { html, title: resolvedTitle, sections, blocks };
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
  planPath,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
  // Only filesystem-backed render delivery supplies a path. Omitting it keeps
  // the pure renderer useful while deliberately disabling viewer persistence.
  readonly planPath?: string;
}): RenderedDocument => {
  const compiled = compileMarkdown({ markdown });
  return renderCompiledDocument({
    compiled,
    fallbackTitle,
    ...(planPath === undefined
      ? {}
      : { planId: derivePlanId({ planPath, planContent: markdown }) }),
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
  const rendered = renderCompiledDocument({
    compiled,
    fallbackTitle,
    identity: {},
  });
  return {
    title: rendered.title,
    sections: compiled.sections,
    components: componentsInDocumentOrder(compiled.components),
  };
};
