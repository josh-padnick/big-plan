import type { Element, Root, RootContent } from "hast";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

export type Section = {
  readonly id: string;
  readonly text: string;
};

export type ConvertedMarkdown = {
  readonly bodyHtml: string;
  readonly sections: ReadonlyArray<Section>;
};

// remark-rehype emits the GFM footnotes block with this heading id; it is a
// screen-reader label, not an authored section, so it stays out of the TOC.
const FOOTNOTE_LABEL_ID = "footnote-label";

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
      properties: { className: ["table-scroll"] },
      children: [child],
    };
    return wrapper;
  });
};

const rehypeWrapTables = () => (tree: Root) => {
  wrapTables(tree);
};

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
 * Converts GFM markdown into body HTML plus the level-two heading outline
 * used for the table of contents. Pure: same input, same output.
 */
export const convertMarkdown = ({
  markdown,
}: {
  readonly markdown: string;
}): ConvertedMarkdown => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeWrapTables);
  const tree = processor.runSync(processor.parse(markdown));

  const sections: Array<Section> = [];
  collectSections(tree, sections);

  const bodyHtml = unified().use(rehypeStringify).stringify(tree);
  return { bodyHtml, sections };
};
