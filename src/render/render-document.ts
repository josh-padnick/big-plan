// The renderer's document entry points: render a plan as HTML, or exercise
// that same rendering while publishing the machine-readable model it collected.

import { planComponents, type PlanModel } from "./compile-plan-model.js";
import type {
  BlockDescriptor,
  CompiledMarkdown,
  Section,
} from "./markdown/compile-markdown.js";
import {
  compileMarkdown,
  compileMarkdownModel,
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
  identity,
}: {
  readonly compiled: CompiledMarkdown;
  readonly fallbackTitle: string;
  readonly identity: DocumentIdentity;
}): RenderedDocument => {
  const { root, sections, elementIds, title, partIds, blocks } = compiled;
  const resolvedTitle = title ?? fallbackTitle;
  // A section's part gains the rendered divider's anchor so the TOC's act
  // headers link to the divider band itself.
  const nav = sections.map((section) => {
    if (section.part === undefined) {
      return { id: section.id, label: section.name };
    }
    const partId = partIds[section.part.number - 1];
    return {
      id: section.id,
      label: section.name,
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
    styles: [shell.styles, ...compiled.embeddedStyles].join("\n"),
    bodyClassName: shell.bodyClassName,
    bodyHtml: shell.html,
    rootAttributes: rootAttributesFor(identity),
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
  identity,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
  // Only filesystem-backed render delivery supplies a path. Omitting it keeps
  // the pure renderer useful while deliberately disabling viewer persistence.
  readonly planPath?: string;
  // A served review supplies runtime identity explicitly. Static rendering
  // derives only the ordinary content-sensitive viewer namespace above.
  readonly identity?: DocumentIdentity;
}): RenderedDocument => {
  const compiled = compileMarkdown({ markdown });
  const resolvedIdentity =
    identity ??
    (planPath === undefined
      ? {}
      : {
          planId: derivePlanId({ planPath, planContent: markdown }),
        });
  return renderCompiledDocument({
    compiled,
    fallbackTitle,
    identity: resolvedIdentity,
  });
};

/**
 * Exercises complete rendering while returning the collected plan-model
 * summary and discarding the generated document.
 *
 * It compiles through machine delivery, because the summary it returns is the
 * one the compile command publishes and the two are asserted to agree. Human
 * delivery would hand back a model still holding a nested component's deferred
 * outline placeholder, so validation would pass a plan whose published model
 * the compile command would never produce.
 *
 * That choice narrows what validation covers, and the cost is worth naming.
 * Under machine delivery a nested outline-aware component presents eagerly
 * against the empty outline instead of deferring, so validation no longer
 * exercises the placeholder-completion path human delivery takes, and a defect
 * confined to the whole-tree walk in completeOutlinePlaceholders would pass
 * validation and surface only at render. The cost is accepted because the
 * returned model is an asserted contract while the generated document is
 * discarded, which makes publishing a model the compile command would never
 * produce the worse of the two failures.
 *
 * The tradeoff disappears entirely once completeOutlinePlaceholders also
 * completes the placeholders held by collected models: the two deliveries
 * would then be identical, the materializeNestedModels flag would go, and
 * validation would render exactly what render renders.
 */
export const validateDocument = ({
  markdown,
  fallbackTitle,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
}): PlanModel => {
  const compiled = compileMarkdownModel({ markdown });
  const rendered = renderCompiledDocument({
    compiled,
    fallbackTitle,
    identity: {},
  });
  return {
    title: rendered.title,
    sections: compiled.sections,
    components: planComponents({
      components: compiled.components,
      blocks: compiled.blocks,
    }),
  };
};
