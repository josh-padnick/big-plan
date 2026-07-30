// Implements the lede-length authoring rule: the lede under a plan's title is
// the document's subtitle, so it stays a single concise sentence instead of
// an opening paragraph of body prose.

import type { Paragraph } from "mdast";
import type { Node, Parent } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

const MAXIMUM_WORDS = 30;

const isParent = (node: Node): node is Parent => "children" in node;

const isHeadingDepthOne = (node: Node): boolean =>
  node.type === "heading" && "depth" in node && node.depth === 1;

const isParagraph = (node: Node): node is Paragraph =>
  node.type === "paragraph";

// Counts words over the paragraph's readable content: plain and inline-code
// values plus nested emphasis, so markup never hides length.
const textOf = (node: Node): string => {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  if (isParent(node)) {
    return node.children.map(textOf).join(" ");
  }
  return "";
};

const checkLedeLength = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  if (!isParent(tree)) {
    return [];
  }
  const [first, second] = tree.children;
  if (
    first === undefined ||
    second === undefined ||
    !isHeadingDepthOne(first) ||
    !isParagraph(second) ||
    second.position === undefined
  ) {
    return [];
  }
  const wordCount = textOf(second)
    .split(/\s+/u)
    .filter((word) => word !== "").length;
  if (wordCount <= MAXIMUM_WORDS) {
    return [];
  }
  return [
    {
      line: second.position.start.line,
      column: second.position.start.column,
      message: `Keep the lede at most ${MAXIMUM_WORDS} words (currently ${wordCount}); it is the subtitle, so move supporting detail into the sections below`,
    },
  ];
};

export const ledeLengthRule: PlanLintRule = {
  id: "lede-length",
  check: checkLedeLength,
};
