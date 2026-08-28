// Compiles one authoritative plan source through the established component
// delivery walker and serializes its authored prose plus component-owned
// semantic presentations as standalone Markdown.

import type { Element, ElementContent, Root, RootContent } from "hast";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { createDiagnosticCollector } from "../components/_authoring/diagnostics.js";
import {
  markdownExportPlaceholder,
  markdownFromHast,
  MARKDOWN_EXPORT_INDEX_ATTRIBUTE,
} from "../components/_model/markdown-export.js";
import type { DocumentOutline } from "../components/_model/document-outline/document-outline.js";
import {
  OUTLINE_PART_TITLE_ATTRIBUTE,
  OUTLINE_PLACEHOLDER_ATTRIBUTE,
} from "./markdown/component-pipeline/outline-placeholder.js";
import {
  rehypeRenderComponentsAsMarkdown,
  type CollectedComponentModel,
  type CollectedComponentModels,
  type DeferredMarkdownPresentations,
} from "./markdown/component-pipeline/deliver.js";
import { rehypeDeckTransform } from "./markdown/deck-transform.js";
import type { MutableDocumentOutline } from "./markdown/deck-transform.js";
import {
  COMPONENT_PASS_THROUGH,
  MarkdownDiagnosticsError,
  parseValidatedPlan,
} from "./markdown/compile-markdown.js";

export type RenderedMarkdownDocument = {
  readonly markdown: string;
  readonly title: string;
  readonly components: ReadonlyArray<CollectedComponentModel>;
};

const isElement = (node: RootContent | undefined): node is Element =>
  node?.type === "element";

const textOf = (node: Element): string =>
  node.children
    .map((child) =>
      child.type === "text"
        ? child.value
        : isElement(child)
          ? textOf(child)
          : "",
    )
    .join("");

const titleOf = (tree: Root): string | undefined => {
  const visit = (
    children: ReadonlyArray<RootContent | ElementContent>,
  ): string | undefined => {
    for (const child of children) {
      if (!isElement(child)) continue;
      if (child.tagName === "h1") return textOf(child);
      const nested = visit(child.children);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return visit(tree.children);
};

/** Demotes authored section headings after a Part so its heading owns the act. */
const demotePartHeadings = (tree: Root): void => {
  let insidePart = false;
  for (const child of tree.children) {
    if (!isElement(child)) continue;
    if (child.properties[OUTLINE_PART_TITLE_ATTRIBUTE] !== undefined) {
      insidePart = true;
      continue;
    }
    if (!insidePart || !/^h[1-5]$/u.test(child.tagName)) continue;
    child.tagName = `h${Number(child.tagName.slice(1)) + 1}`;
  }
};

const deferredIndexOf = (element: Element): string | undefined => {
  const outlineIndex = element.properties[OUTLINE_PLACEHOLDER_ATTRIBUTE];
  if (outlineIndex !== undefined) return String(outlineIndex);
  const markdownIndex = element.properties[MARKDOWN_EXPORT_INDEX_ATTRIBUTE];
  return markdownIndex === undefined ? undefined : String(markdownIndex);
};

const materializeNestedMarkdown = ({
  value,
  presentations,
  outline,
  headingOffset,
}: {
  readonly value: unknown;
  readonly presentations: DeferredMarkdownPresentations;
  readonly outline: DocumentOutline;
  readonly headingOffset: number;
}): void => {
  if (Array.isArray(value)) {
    let offset = headingOffset;
    for (let index = 0; index < value.length; index += 1) {
      const child = value[index];
      if (!isElement(child)) {
        materializeNestedMarkdown({
          value: child,
          presentations,
          outline,
          headingOffset: offset,
        });
        continue;
      }
      const opensPart =
        child.properties[OUTLINE_PART_TITLE_ATTRIBUTE] !== undefined;
      const placeholderIndex = deferredIndexOf(child);
      if (placeholderIndex === undefined) {
        materializeNestedMarkdown({
          value: child,
          presentations,
          outline,
          headingOffset: offset,
        });
        continue;
      }
      const deferred = presentations[Number(placeholderIndex)];
      if (deferred === undefined) {
        throw new Error(
          `Internal error: nested Markdown placeholder ${placeholderIndex} has no presentation`,
        );
      }
      const context = {
        outline,
        headingOffset: opensPart ? headingOffset : offset,
      };
      materializeNestedMarkdown({
        value: deferred.model,
        presentations,
        ...context,
      });
      value[index] = markdownExportPlaceholder({
        markdown: deferred.present(context),
        ...(child.position === undefined ? {} : { position: child.position }),
      });
      if (opensPart) offset = headingOffset + 1;
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    materializeNestedMarkdown({
      value: nested,
      presentations,
      outline,
      headingOffset,
    });
  }
};

/**
 * Resolves every deferred component presentation on the unwrapped export
 * tree, giving each one the heading depth its position earned. The Part
 * divider itself keeps the act's own level and moves everything after it down,
 * which is the same rule `demotePartHeadings` applies to authored headings.
 */
const completeMarkdownPlaceholders = ({
  parent,
  presentations,
  outline,
  headingOffset,
}: {
  readonly parent: Root | Element;
  readonly presentations: DeferredMarkdownPresentations;
  readonly outline: DocumentOutline;
  readonly headingOffset: number;
}): void => {
  let index = 0;
  let offset = headingOffset;
  while (index < parent.children.length) {
    const child = parent.children[index];
    if (!isElement(child)) {
      index += 1;
      continue;
    }
    const opensPart =
      child.properties[OUTLINE_PART_TITLE_ATTRIBUTE] !== undefined;
    const placeholderIndex = deferredIndexOf(child);
    if (placeholderIndex === undefined) {
      completeMarkdownPlaceholders({
        parent: child,
        presentations,
        outline,
        headingOffset: offset,
      });
      index += 1;
      continue;
    }
    const deferred = presentations[Number(placeholderIndex)];
    if (deferred === undefined) {
      throw new Error(
        `Internal error: Markdown outline placeholder ${String(placeholderIndex)} has no presentation`,
      );
    }
    const context = {
      outline,
      headingOffset: opensPart ? headingOffset : offset,
    };
    materializeNestedMarkdown({
      value: deferred.model,
      presentations,
      ...context,
    });
    parent.children.splice(
      index,
      1,
      markdownExportPlaceholder({
        markdown: deferred.present(context),
        ...(child.position === undefined ? {} : { position: child.position }),
      }),
    );
    if (opensPart) offset = headingOffset + 1;
    index += 1;
  }
};

/** Places a Markdown block directly after the document's title element. */
const insertAfterTitle = ({
  tree,
  markdown,
}: {
  readonly tree: Root;
  readonly markdown: string;
}): boolean => {
  const visit = (parent: Root | Element): boolean => {
    for (const [index, child] of parent.children.entries()) {
      if (!isElement(child)) continue;
      if (child.tagName === "h1") {
        parent.children.splice(
          index + 1,
          0,
          markdownExportPlaceholder({ markdown }),
        );
        return true;
      }
      if (visit(child)) return true;
    }
    return false;
  };
  return visit(tree);
};

/**
 * Produces a standalone Markdown plan from one immutable source string. The
 * parsed tree is shared by validation and component delivery; no later step
 * reparses source or infers component meaning from React or HTML.
 */
export const renderMarkdownDocument = ({
  markdown,
  fallbackTitle,
  snapshot,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
  readonly snapshot: string;
}): RenderedMarkdownDocument => {
  const diagnostics = createDiagnosticCollector();
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMdx);
  const parsed = parseValidatedPlan({ markdown, diagnostics });

  const componentModels: CollectedComponentModels = new Map();
  const deferred: DeferredMarkdownPresentations = [];
  const processor = parser()
    .use(remarkRehype, {
      footnoteLabelProperties: { className: ["footnotes-heading"] },
      passThrough: [...COMPONENT_PASS_THROUGH],
    })
    .use(rehypeSlug)
    .use(rehypeRenderComponentsAsMarkdown, {
      diagnostics,
      collectModels: componentModels,
      deferOutline: deferred,
    });
  const tree: Root = processor.runSync(parsed);
  if (diagnostics.diagnostics.length > 0) {
    throw new MarkdownDiagnosticsError(diagnostics.diagnostics);
  }

  // The established deck transform remains the sole outline calculation. It
  // receives a delivery-produced clone so its visual wrappers cannot leak
  // into the portable document that is serialized below.
  const outlineTree = structuredClone(tree);
  const outline: MutableDocumentOutline = { parts: [], sections: [] };
  rehypeDeckTransform({ outline, diagnostics })(outlineTree);
  if (diagnostics.diagnostics.length > 0) {
    throw new MarkdownDiagnosticsError(diagnostics.diagnostics);
  }
  demotePartHeadings(tree);
  completeMarkdownPlaceholders({
    parent: tree,
    presentations: deferred,
    outline,
    headingOffset: 0,
  });

  const title = titleOf(tree) ?? fallbackTitle;
  const version = `> Exported plan version: \`${snapshot}\``;
  // The version is placed as its own block beside the title element rather
  // than spliced into serialized text, so a plan whose first block is not the
  // title never has that block cut in half.
  const titled = insertAfterTitle({ tree, markdown: version });
  const body = markdownFromHast(tree.children);
  const serialized = titled ? body : `# ${title}\n\n${version}\n\n${body}`;
  return {
    title,
    markdown: `${serialized.trim()}\n`,
    components: [...componentModels.values()],
  };
};
