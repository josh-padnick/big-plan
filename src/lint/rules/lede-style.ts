// Implements the lede-style authoring rule: the lede under a plan's title
// describes the delivered future as a declarative subtitle, never the
// document or its author.

import type { Paragraph, Text } from "mdast";
import type { Node, Parent } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

// Openers that make the lede a statement about the plan or its author.
// Matching is prefix-only and case-insensitive, so declarative prose that
// merely mentions a phrase later in the sentence is never flagged.
const SELF_REFERENTIAL_OPENERS: ReadonlyArray<string> = [
  "i propose",
  "i recommend",
  "i will",
  "i plan",
  "we propose",
  "we recommend",
  "we will",
  "this plan",
  "this document",
  "in this plan",
  "in this document",
];

const isParent = (node: Node): node is Parent => "children" in node;

const isHeadingDepthOne = (node: Node): boolean =>
  node.type === "heading" && "depth" in node && node.depth === 1;

const isParagraph = (node: Node): node is Paragraph =>
  node.type === "paragraph";

const isText = (node: Node): node is Text => node.type === "text";

const checkLedeStyle = ({
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
  const [leadingChild] = second.children;
  if (leadingChild === undefined || !isText(leadingChild)) {
    return [];
  }
  const opening = leadingChild.value.trimStart().toLowerCase();
  const matches = SELF_REFERENTIAL_OPENERS.some((opener) =>
    opening.startsWith(opener),
  );
  if (!matches) {
    return [];
  }
  return [
    {
      line: second.position.start.line,
      column: second.position.start.column,
      message:
        'Write the lede as a declarative subtitle describing the delivered outcome, not an opener like "I propose" or "This plan"',
    },
  ];
};

export const ledeStyleRule: PlanLintRule = {
  id: "lede-style",
  check: checkLedeStyle,
};
