// Compiles static-subset MDX into a structured HAST review document plus its title,
// h2 outline, and element ids, then owns final HTML serialization after
// transforms finish. The page chrome around that content lives in shell.ts.

import type { Element, Root, RootContent } from "hast";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
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
import { rehypeRenderComponents } from "./component-pipeline/deliver.js";
import type { CollectedComponentModel } from "./component-pipeline/deliver.js";
export type { CollectedComponentModel } from "./component-pipeline/deliver.js";
import { remarkValidateComponents } from "./component-pipeline/validate-authoring.js";

export type Section = {
  readonly id: string;
  readonly text: string;
};

export type CompiledMarkdown = {
  readonly root: Root;
  readonly sections: ReadonlyArray<Section>;
  readonly elementIds: ReadonlyArray<string>;
  readonly title: string | undefined;
};

export type CompiledMarkdownModel = {
  readonly sections: ReadonlyArray<Section>;
  readonly title: string | undefined;
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

// remark-rehype emits the GFM footnotes block with this heading id; it is a
// screen-reader label, not an authored section, so it stays out of the TOC.
const FOOTNOTE_LABEL_ID = "footnote-label";

// Flattens a heading to plain text so TOC entries keep their visible words
// but drop inline markup such as code spans or emphasis.
type MdxJsxFlowElement = Extract<
  RootContent,
  { readonly type: "mdxJsxFlowElement" }
>;

type StructuredParent = Root | Element | MdxJsxFlowElement;

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
  "mb-5",
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

// Gathers every slugged h2 in document order, at any nesting depth, so
// sections inside containers such as blockquotes still reach the TOC.
const collectSections = (
  node: StructuredParent,
  sections: Array<Section>,
): void => {
  for (const child of node.children) {
    if (child.type === "element") {
      const id = child.properties.id;
      if (
        child.tagName === "h2" &&
        typeof id === "string" &&
        id !== FOOTNOTE_LABEL_ID
      ) {
        sections.push({ id, text: textOf(child) });
      }
    }
    if (child.type === "element" || child.type === "mdxJsxFlowElement") {
      collectSections(child, sections);
    }
  }
};

type MarkdownMetadata = {
  title: string | undefined;
  readonly sections: Array<Section>;
};

// Captures authored headings after slugging but before model delivery removes
// component bodies or HTML delivery replaces them with React-produced HAST.
const rehypeCollectMetadata =
  ({ metadata }: { readonly metadata: MarkdownMetadata }) =>
  (tree: Root): void => {
    metadata.title = findTitle(tree);
    collectSections(tree, metadata.sections);
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
 * Compiles static-subset MDX into a structured review document plus its outline,
 * title, and element ids for collision-free shell anchors. The tree stays
 * structured so component and Annotation transforms can run before final
 * serialization.
 */
const compileMarkdownTree = ({
  markdown,
  models,
}: {
  readonly markdown: string;
  readonly models?: Array<CollectedComponentModel>;
}): CompiledMarkdown => {
  const diagnostics = createDiagnosticCollector();
  const metadata: MarkdownMetadata = { title: undefined, sections: [] };
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMdx)
    .use(remarkValidateComponents, { diagnostics })
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
    .use(rehypeRenderComponents, {
      diagnostics,
      ...(models === undefined ? {} : { models }),
    })
    // Detection stays opt-in through the fence language: undeclared and
    // unknown languages remain readable without guessed tokenization.
    .use(rehypeHighlight)
    .use(rehypeWrapTables);
  // Only parsing reflects author mistakes; a transform that throws is a
  // renderer defect and must surface as an internal error, not as a
  // diagnostic blaming the document.
  let parsed: ReturnType<typeof processor.parse>;
  try {
    parsed = processor.parse(markdown);
  } catch (error: unknown) {
    throw new MarkdownDiagnosticsError([diagnosticFromParseError(error)]);
  }
  const tree: Root = processor.runSync(parsed);

  if (diagnostics.diagnostics.length > 0) {
    throw new MarkdownDiagnosticsError(diagnostics.diagnostics);
  }

  const elementIds: Array<string> = [];
  collectElementIds(tree, elementIds);

  return {
    root: tree,
    sections: metadata.sections,
    elementIds,
    title: metadata.title,
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

/** Serializes a compiled review document only after all transforms finish. */
export const serializeMarkdown = ({ root }: { readonly root: Root }): string =>
  unified().use(rehypeStringify).stringify(root);
