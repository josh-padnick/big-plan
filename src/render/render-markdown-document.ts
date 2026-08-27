// Compiles one authoritative plan source through the established component
// delivery walker and serializes its authored prose plus component-owned
// semantic presentations as standalone Markdown.

import type { Element, ElementContent, Root, RootContent } from "hast";
import type { Root as MarkdownRoot } from "mdast";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import {
  createDiagnosticCollector,
  diagnosticFromParseError,
} from "../components/_authoring/diagnostics.js";
import {
  markdownExportPlaceholder,
  markdownFromHast,
} from "../components/_model/markdown-export.js";
import type { DocumentOutline } from "../components/_model/document-outline/document-outline.js";
import {
  OUTLINE_PART_TITLE_ATTRIBUTE,
  OUTLINE_PLACEHOLDER_ATTRIBUTE,
} from "./markdown/component-pipeline/outline-placeholder.js";
import {
  rehypeRenderComponentsAsMarkdown,
  rehypeValidateComponentSemantics,
  type CollectedComponentModel,
  type CollectedComponentModels,
  type DeferredMarkdownPresentations,
} from "./markdown/component-pipeline/deliver.js";
import { remarkValidateComponents } from "./markdown/component-pipeline/validate-authoring.js";
import { rehypeDeckTransform } from "./markdown/deck-transform.js";
import type { MutableDocumentOutline } from "./markdown/deck-transform.js";
import { MarkdownDiagnosticsError } from "./markdown/compile-markdown.js";

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

/** Resolves outline-aware component callbacks on the unwrapped export tree. */
const completeMarkdownPlaceholders = ({
  parent,
  presentations,
  outline,
}: {
  readonly parent: Root | Element;
  readonly presentations: DeferredMarkdownPresentations;
  readonly outline: DocumentOutline;
}): void => {
  let index = 0;
  while (index < parent.children.length) {
    const child = parent.children[index];
    if (!isElement(child)) {
      index += 1;
      continue;
    }
    const placeholderIndex = child.properties[OUTLINE_PLACEHOLDER_ATTRIBUTE];
    if (placeholderIndex === undefined) {
      completeMarkdownPlaceholders({ parent: child, presentations, outline });
      index += 1;
      continue;
    }
    const present = presentations[Number(placeholderIndex)];
    if (present === undefined) {
      throw new Error(
        `Internal error: Markdown outline placeholder ${String(placeholderIndex)} has no presentation`,
      );
    }
    parent.children.splice(
      index,
      1,
      markdownExportPlaceholder({
        markdown: present(outline),
        ...(child.position === undefined ? {} : { position: child.position }),
      }),
    );
    index += 1;
  }
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
  let parsed: MarkdownRoot;
  try {
    parsed = parser.parse(markdown);
  } catch (error: unknown) {
    throw new MarkdownDiagnosticsError([diagnosticFromParseError(error)]);
  }
  remarkValidateComponents({ diagnostics })(parsed);
  if (diagnostics.diagnostics.length > 0) {
    throw new MarkdownDiagnosticsError(diagnostics.diagnostics);
  }
  parser()
    .use(remarkRehype, {
      passThrough: [
        "mdxjsEsm",
        "mdxFlowExpression",
        "mdxTextExpression",
        "mdxJsxFlowElement",
        "mdxJsxTextElement",
      ],
    })
    .use(rehypeValidateComponentSemantics, { diagnostics })
    .runSync(parsed);
  if (diagnostics.diagnostics.length > 0) {
    throw new MarkdownDiagnosticsError(diagnostics.diagnostics);
  }

  const componentModels: CollectedComponentModels = new Map();
  const deferred: DeferredMarkdownPresentations = [];
  const processor = parser()
    .use(remarkRehype, {
      footnoteLabelProperties: { className: ["footnotes-heading"] },
      passThrough: [
        "mdxjsEsm",
        "mdxFlowExpression",
        "mdxTextExpression",
        "mdxJsxFlowElement",
        "mdxJsxTextElement",
      ],
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
  });

  const title = titleOf(tree) ?? fallbackTitle;
  const body = markdownFromHast(tree.children);
  const withTitle =
    titleOf(tree) === undefined ? `# ${title}\n\n${body}` : body;
  const firstBreak = withTitle.indexOf("\n");
  const version = `> Exported plan version: \`${snapshot}\``;
  const withVersion =
    firstBreak === -1
      ? `${withTitle}\n\n${version}`
      : `${withTitle.slice(0, firstBreak)}\n\n${version}${withTitle.slice(firstBreak)}`;
  return {
    title,
    markdown: `${withVersion.trim()}\n`,
    components: [...componentModels.values()],
  };
};
