// Validates and compiles an MDX plan into a structured HAST review document plus its title,
// h2 outline, and element ids. The tree stays structured: the composer owns
// final HTML serialization, and the page chrome lives in shell.ts.

import type { Element, Root, RootContent } from "hast";
import type { Root as MarkdownRoot } from "mdast";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import {
  createDiagnosticCollector,
  diagnosticFromParseError,
} from "../../components/_authoring/diagnostics.js";
import type { ComponentDiagnostic } from "../../components/_authoring/diagnostics.js";
import { rehypeCodeFigures } from "./code-figure.js";
import {
  rehypeRenderComponents,
  rehypeValidateComponentSemantics,
} from "./component-pipeline/deliver.js";
import type { CollectedComponentModel } from "./component-pipeline/deliver.js";
export type { CollectedComponentModel } from "./component-pipeline/deliver.js";
import { completeOutlinePlaceholders } from "./component-pipeline/outline-placeholder.js";
import type { DeferredOutlinePresentations } from "./component-pipeline/outline-placeholder.js";
import { rehypeBlockIdentity } from "./block-identity.js";
import type { BlockDescriptor } from "./block-identity.js";
export type { BlockDescriptor } from "./block-identity.js";
import { rehypeDeckTransform } from "./deck-transform.js";
import type { MutableDocumentOutline } from "./deck-transform.js";
import { rehypeMarkAuthoredProse } from "./mark-authored-prose.js";
import { remarkValidateComponents } from "./component-pipeline/validate-authoring.js";
import type { SlideTypeId } from "../../plan-vocabulary/slide-types/index.js";
import {
  MERMAID_FONT_CSS,
  prepareMermaidArtifacts,
} from "../../components/mermaid-diagram/renderer.js";

export type SectionPart = {
  readonly number: number;
  readonly title: string;
};

export type Section = {
  readonly id: string;
  readonly name: string;
  readonly toc?: string;
  readonly title: string;
  readonly type?: SlideTypeId;
  readonly part?: SectionPart;
};

export type CompiledMarkdown = {
  readonly root: Root;
  readonly sections: ReadonlyArray<Section>;
  readonly elementIds: ReadonlyArray<string>;
  readonly title: string | undefined;
  readonly embeddedStyles: ReadonlyArray<string>;
  // Rendered Part divider anchors in document order, so navigation can link
  // each act header to its divider; parts carry no anchor in model delivery.
  readonly partIds: ReadonlyArray<string>;
  // Every commentable unit this compile addressed, in document order, so a
  // feedback package can be resolved without re-reading the HTML.
  readonly blocks: ReadonlyArray<BlockDescriptor>;
};

export type CompiledMarkdownModel = {
  readonly sections: ReadonlyArray<Section>;
  readonly title: string | undefined;
  readonly components: ReadonlyArray<CollectedComponentModel>;
};

export type CompiledMarkdownWithModels = CompiledMarkdown & {
  readonly components: ReadonlyArray<CollectedComponentModel>;
};

/** Carries every positional authoring diagnostic across renderer boundaries. */
export class MarkdownDiagnosticsError extends Error {
  readonly diagnostics: ReadonlyArray<ComponentDiagnostic>;

  constructor(diagnostics: ReadonlyArray<ComponentDiagnostic>) {
    super("The document contains invalid MDX");
    this.name = "MarkdownDiagnosticsError";
    this.diagnostics = diagnostics;
  }
}

// Flattens a heading to plain text so TOC entries keep their visible words
// but drop inline markup such as code spans or emphasis.
type MdxJsxFlowElement = Extract<
  RootContent,
  { readonly type: "mdxJsxFlowElement" }
>;

type StructuredParent = Root | Element | MdxJsxFlowElement;

// remark-rehype emits the GFM footnotes block with this heading id; it is a
// screen-reader label, not an authored section, so it stays out of the model.
const FOOTNOTE_LABEL_ID = "footnote-label";

const textOf = (node: StructuredParent): string => {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") {
      text += child.value;
    } else if (child.type === "element" || child.type === "mdxJsxFlowElement") {
      text += textOf(child);
    }
  }
  return text;
};

const isElement = (node: RootContent): node is Element =>
  node.type === "element";

// Tailwind utilities remain private styling implementation. The data
// attribute is the stable behavior-bearing interface used by browser tests.
const TABLE_WRAPPER_CLASSES = [
  "mb-6",
  // The container carries the card - border, corners, the scroll box - so it
  // has to end where the columns end. Left block-level it stretched to the
  // reading width and drew a rule across empty space beside a narrow table.
  // fit-content still resolves to the available width when the table is wider
  // than the page, which is what keeps the scroll box working.
  "w-fit",
  "max-w-full",
  "overflow-x-auto",
  "rounded-md",
  "border",
  "border-edge",
] as const;

// Wraps each <table> in a scroll container so a wide table scrolls inside its
// own box instead of widening the whole page. Mutating the tree in place is
// the idiomatic shape for a rehype transform. A table whose parent is already
// a scroll container keeps it: components that ship their own figure-styled
// container must not gain a second, chrome-bearing wrapper here.
const wrapTables = (node: Root | Element): void => {
  if (
    node.type === "element" &&
    node.properties["data-wireframe"] !== undefined
  ) {
    return;
  }
  const nodeIsScrollContainer =
    node.type === "element" &&
    node.properties["data-table-scroll-container"] !== undefined;
  node.children = node.children.map((child) => {
    if (!isElement(child)) {
      return child;
    }
    wrapTables(child);
    if (child.tagName !== "table" || nodeIsScrollContainer) {
      return child;
    }
    const wrapper: Element = {
      type: "element",
      tagName: "div",
      properties: {
        "data-table-scroll-container": "",
        className: [...TABLE_WRAPPER_CLASSES],
      },
      children: [child],
    };
    return wrapper;
  });
};

const rehypeWrapTables = () => (tree: Root) => {
  wrapTables(tree);
};

// Finds the document title: the text of the first h1 in the rendered tree.
// Walking the parsed tree (rather than regexing the source) means a "# line"
// inside a fenced code block can never masquerade as the title.
const findTitle = (node: StructuredParent): string | undefined => {
  for (const child of node.children) {
    if (child.type === "element" && child.tagName === "h1") {
      return textOf(child);
    }
    if (child.type === "element" || child.type === "mdxJsxFlowElement") {
      const nested = findTitle(child);
      if (nested !== undefined) {
        return nested;
      }
    }
  }
  return undefined;
};

// Reads one static string value from a not-yet-compiled component marker so
// the pre-delivery metadata walk can preserve Part membership.
const staticAttribute = ({
  node,
  name,
}: {
  readonly node: MdxJsxFlowElement;
  readonly name: string;
}): string | undefined => {
  for (const attribute of node.attributes) {
    if (attribute.type === "mdxJsxAttribute" && attribute.name === name) {
      return typeof attribute.value === "string" ? attribute.value : undefined;
    }
  }
  return undefined;
};

type MetadataSection = {
  readonly id: string;
  readonly title: string;
  readonly part?: SectionPart;
};

type PartTracker = {
  part: SectionPart | undefined;
  count: number;
};

// Gathers every authored slugged h2 before component model delivery can
// remove a parent body, preserving nested headings and their source order.
const collectSections = (
  node: StructuredParent,
  sections: Array<MetadataSection>,
  tracker: PartTracker,
): void => {
  for (const child of node.children) {
    if (child.type === "mdxJsxFlowElement" && child.name === "Part") {
      tracker.count += 1;
      tracker.part = {
        number: tracker.count,
        title: staticAttribute({ node: child, name: "title" }) ?? "",
      };
    }
    if (child.type === "element") {
      const id = child.properties.id;
      if (
        child.tagName === "h2" &&
        typeof id === "string" &&
        id !== FOOTNOTE_LABEL_ID
      ) {
        sections.push({
          id,
          title: textOf(child),
          ...(tracker.part === undefined ? {} : { part: tracker.part }),
        });
      }
    }
    if (child.type === "element" || child.type === "mdxJsxFlowElement") {
      collectSections(child, sections, tracker);
    }
  }
};

type MarkdownMetadata = {
  title: string | undefined;
  readonly sections: Array<MetadataSection>;
};

// Captures authored headings after slugging but before model delivery removes
// component bodies or HTML delivery replaces them with React-produced HAST.
const rehypeCollectMetadata =
  ({ metadata }: { readonly metadata: MarkdownMetadata }) =>
  (tree: Root): void => {
    metadata.title = findTitle(tree);
    collectSections(tree, metadata.sections, { part: undefined, count: 0 });
  };

// Gathers ids from rendered elements for page-shell namespace allocation.
const collectElementIds = (
  node: Root | Element,
  elementIds: Array<string>,
): void => {
  for (const child of node.children) {
    if (!isElement(child)) {
      continue;
    }
    const id = child.properties.id;
    if (typeof id === "string") {
      elementIds.push(id);
    }
    collectElementIds(child, elementIds);
  }
};

/**
 * Validates and compiles an MDX plan into a structured review document plus its outline,
 * title, and element ids for collision-free shell anchors. The tree stays
 * structured so component and Annotation transforms can run before final
 * serialization.
 */
const compileMarkdownTree = ({
  markdown,
  models,
  collectModels,
  renderArtifacts,
}: {
  readonly markdown: string;
  readonly models?: Array<CollectedComponentModel>;
  readonly collectModels?: Array<CollectedComponentModel>;
  readonly renderArtifacts?: ReadonlyMap<string, unknown>;
}): CompiledMarkdown => {
  const diagnostics = createDiagnosticCollector();
  const metadata: MarkdownMetadata = { title: undefined, sections: [] };
  // Outline-aware components defer their presentation behind placeholders;
  // the deck transform fills the outline, and the completion pass then
  // presents every placeholder against it.
  const deferredOutline: DeferredOutlinePresentations = [];
  const outline: MutableDocumentOutline = { parts: [], sections: [] };
  const blocks: Array<BlockDescriptor> = [];
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
  const semanticPreflight = parser()
    .use(remarkRehype, {
      passThrough: [
        "mdxjsEsm",
        "mdxFlowExpression",
        "mdxTextExpression",
        "mdxJsxFlowElement",
        "mdxJsxTextElement",
      ],
    })
    .use(rehypeValidateComponentSemantics, { diagnostics });
  semanticPreflight.runSync(parsed);
  if (diagnostics.diagnostics.length > 0) {
    throw new MarkdownDiagnosticsError(diagnostics.diagnostics);
  }
  const resolvedRenderArtifacts =
    renderArtifacts ?? prepareMermaidArtifacts(parsed);
  const processor = parser()
    .use(remarkRehype, {
      // The GFM footnotes label ships visible as a small section heading;
      // without this option remark-rehype hides it behind class="sr-only".
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
    .use(rehypeCollectMetadata, { metadata })
    // Markdown exists before React-rendered component chrome. Marking it at
    // this boundary lets prose CSS follow authored provenance rather than
    // matching every semantic element a component happens to render.
    .use(rehypeMarkAuthoredProse)
    .use(rehypeRenderComponents, {
      diagnostics,
      ...(models === undefined ? {} : { models }),
      ...(collectModels === undefined ? {} : { collectModels }),
      deferOutline: deferredOutline,
      renderArtifacts: resolvedRenderArtifacts,
    })
    // Detection stays opt-in through the fence language: undeclared and
    // unknown languages remain readable without guessed tokenization.
    .use(rehypeHighlight)
    .use(rehypeWrapTables)
    .use(rehypeCodeFigures)
    .use(rehypeDeckTransform, { outline, diagnostics })
    .use(() => (tree: Root) => {
      completeOutlinePlaceholders({
        tree,
        presentations: deferredOutline,
        outline,
        diagnostics,
      });
    })
    // Identity runs last, over the finished deck, so every block it addresses
    // is the one the reader will actually point at.
    .use(rehypeBlockIdentity, { blocks });
  const tree: Root = processor.runSync(parsed);

  if (diagnostics.diagnostics.length > 0) {
    throw new MarkdownDiagnosticsError(diagnostics.diagnostics);
  }

  const elementIds: Array<string> = [];
  collectElementIds(tree, elementIds);
  const outlinedById = new Map(
    outline.sections.map((section) => [section.id, section]),
  );

  return {
    root: tree,
    embeddedStyles:
      resolvedRenderArtifacts.size === 0 ? [] : [MERMAID_FONT_CSS],
    sections: metadata.sections.map((section) => {
      const outlined = outlinedById.get(section.id);
      return outlined === undefined
        ? {
            id: section.id,
            name: section.title,
            title: section.title,
            ...(section.part === undefined ? {} : { part: section.part }),
          }
        : {
            id: section.id,
            name: outlined.name,
            title: outlined.title,
            ...(outlined.toc === undefined ? {} : { toc: outlined.toc }),
            ...(outlined.type === undefined ? {} : { type: outlined.type }),
            ...(section.part === undefined ? {} : { part: section.part }),
          };
    }),
    elementIds,
    title: metadata.title,
    partIds: outline.parts.map((part) => part.id ?? ""),
    blocks,
  };
};

/** Compiles Markdown through the HTML continuation. */
export const compileMarkdown = ({
  markdown,
}: {
  readonly markdown: string;
}): CompiledMarkdown => compileMarkdownTree({ markdown });

/** Compiles Markdown through the model continuation without top-level HTML. */
export const compileMarkdownModel = ({
  markdown,
}: {
  readonly markdown: string;
}): CompiledMarkdownModel => {
  const components: Array<CollectedComponentModel> = [];
  const { sections, title } = compileMarkdownTree({
    markdown,
    models: components,
  });
  return { sections, title, components };
};

/** Compiles through HTML delivery while collecting the same component models. */
export const compileMarkdownWithModels = ({
  markdown,
}: {
  readonly markdown: string;
}): CompiledMarkdownWithModels => {
  const components: Array<CollectedComponentModel> = [];
  const compiled = compileMarkdownTree({
    markdown,
    collectModels: components,
  });
  return { ...compiled, components };
};
