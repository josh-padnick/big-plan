// Compiles GFM markdown into a structured HAST review document plus its title
// and h2 outline, then owns final HTML serialization after transforms finish.
// The page chrome around that content lives in shell.ts.

import type { Element, Root, RootContent } from "hast";
import { Check, Copy } from "lucide";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { renderLucideIcon } from "../icons/lucide-icon.js";

export type Section = {
  readonly id: string;
  readonly text: string;
};

export type CompiledMarkdown = {
  readonly root: Root;
  readonly sections: ReadonlyArray<Section>;
  readonly title: string | undefined;
};

// remark-rehype emits the GFM footnotes block with this heading id; it is a
// screen-reader label, not an authored section, so it stays out of the TOC.
const FOOTNOTE_LABEL_ID = "footnote-label";

// Flattens a heading to plain text so TOC entries keep their visible words
// but drop inline markup such as code spans or emphasis.
const textOf = (node: Element): string => {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") {
      text += child.value;
    } else if (child.type === "element") {
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

// This data contract is shared with the browser copy behavior so a future
// CodeSnippet component can opt in without depending on Markdown internals.
export const CODE_BLOCK_SELECTOR = "data-code-block";

const COPY_BUTTON_CLASSES =
  "code-copy-button inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

// Wraps each <table> in a scroll container so a wide table scrolls inside its
// own box instead of widening the whole page. Mutating the tree in place is
// the idiomatic shape for a rehype transform.
const wrapTables = (node: Root | Element): void => {
  node.children = node.children.map((child) => {
    if (!isElement(child)) {
      return child;
    }
    wrapTables(child);
    if (child.tagName !== "table") {
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

// Adds framework-free shadcn Button markup to rendered code blocks. The
// source remains in the sibling <code> element so copy behavior can read the
// exact text after syntax highlighting has split it into token spans.
const wrapCodeBlocks = (node: Root | Element): void => {
  node.children = node.children.map((child) => {
    if (!isElement(child)) {
      return child;
    }
    wrapCodeBlocks(child);
    const hasCodeChild = child.tagName === "pre" &&
      child.children.some(
        (codeChild) => isElement(codeChild) && codeChild.tagName === "code",
      );
    if (!hasCodeChild) {
      return child;
    }
    const copyButton: Element = {
      type: "element",
      tagName: "button",
      properties: {
        type: "button",
        className: COPY_BUTTON_CLASSES.split(" "),
        ariaLabel: "Copy code",
        ariaLive: "polite",
        "data-copy-code": "",
        "data-size": "xs",
        "data-slot": "button",
        "data-variant": "ghost",
      },
      children: [
        renderLucideIcon({ icon: Copy, name: "copy", hidden: false }),
        renderLucideIcon({ icon: Check, name: "check", hidden: true }),
      ],
    };
    const wrapper: Element = {
      type: "element",
      tagName: "div",
      properties: {
        className: ["code-block"],
        [CODE_BLOCK_SELECTOR]: "",
      },
      children: [
        child,
        {
          type: "element",
          tagName: "span",
          properties: {
            className: ["code-copy-message"],
            ariaHidden: "true",
            "data-copy-message": "",
            hidden: true,
          },
          children: [{ type: "text", value: "Copied!" }],
        },
        copyButton,
      ],
    };
    return wrapper;
  });
};

const rehypeWrapCodeBlocks = () => (tree: Root) => {
  wrapCodeBlocks(tree);
};

// Finds the document title: the text of the first h1 in the rendered tree.
// Walking the parsed tree (rather than regexing the source) means a "# line"
// inside a fenced code block can never masquerade as the title.
const findTitle = (node: Root | Element): string | undefined => {
  for (const child of node.children) {
    if (!isElement(child)) {
      continue;
    }
    if (child.tagName === "h1") {
      return textOf(child);
    }
    const nested = findTitle(child);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
};

// Gathers every slugged h2 in document order, at any nesting depth, so
// sections inside containers such as blockquotes still reach the TOC.
const collectSections = (
  node: Root | Element,
  sections: Array<Section>,
): void => {
  for (const child of node.children) {
    if (!isElement(child)) {
      continue;
    }
    const id = child.properties.id;
    if (
      child.tagName === "h2" &&
      typeof id === "string" &&
      id !== FOOTNOTE_LABEL_ID
    ) {
      sections.push({ id, text: textOf(child) });
    }
    collectSections(child, sections);
  }
};

/**
 * Compiles GFM markdown into a structured review document plus its outline
 * and title. The tree stays structured so future typed-block and annotation
 * transforms can run before the final serialization step.
 */
export const compileMarkdown = ({
  markdown,
}: {
  readonly markdown: string;
}): CompiledMarkdown => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, {
      // The GFM footnotes label ships visible as a small section heading;
      // without this option remark-rehype hides it behind class="sr-only".
      footnoteLabelProperties: { className: ["footnotes-heading"] },
    })
    .use(rehypeSlug)
    // Detection stays opt-in through the fence language: undeclared and
    // unknown languages remain readable without guessed tokenization.
    .use(rehypeHighlight)
    .use(rehypeWrapCodeBlocks)
    .use(rehypeWrapTables);
  const tree = processor.runSync(processor.parse(markdown));

  const sections: Array<Section> = [];
  collectSections(tree, sections);

  return { root: tree, sections, title: findTitle(tree) };
};

/** Serializes a compiled review document only after all transforms finish. */
export const serializeMarkdown = ({ root }: { readonly root: Root }): string =>
  unified().use(rehypeStringify).stringify(root);
