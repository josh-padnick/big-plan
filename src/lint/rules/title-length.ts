// Implements the title-length authoring rule: a plan's level-one title is a
// punchy noun phrase, not a sentence, so the review document opens with a
// scannable name for the outcome.

import type { Heading, InlineCode, Text } from "mdast";
import type { Node, Parent } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

const MAXIMUM_WORDS = 8;
const MAXIMUM_CHARACTERS = 60;

const isParent = (node: Node): node is Parent => "children" in node;

const isHeading = (node: Node): node is Heading => node.type === "heading";

const isText = (node: Node): node is Text => node.type === "text";

const isInlineCode = (node: Node): node is InlineCode =>
  node.type === "inlineCode";

// A title's comparable text concatenates plain and inline-code content, so a
// code-styled word still counts toward the budget.
const headingText = (heading: Heading): string =>
  heading.children
    .map((child) => (isText(child) || isInlineCode(child) ? child.value : ""))
    .join("")
    .trim();

const checkTitleLength = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  if (!isParent(tree)) {
    return [];
  }
  const [first] = tree.children;
  if (
    first === undefined ||
    !isHeading(first) ||
    first.depth !== 1 ||
    first.position === undefined
  ) {
    return [];
  }
  const text = headingText(first);
  const wordCount = text.split(/\s+/u).filter((word) => word !== "").length;
  if (wordCount <= MAXIMUM_WORDS && text.length <= MAXIMUM_CHARACTERS) {
    return [];
  }
  return [
    {
      line: first.position.start.line,
      column: first.position.start.column,
      message: `Keep the title a punchy noun phrase of at most ${MAXIMUM_WORDS} words and ${MAXIMUM_CHARACTERS} characters naming the outcome`,
    },
  ];
};

export const titleLengthRule: PlanLintRule = {
  id: "title-length",
  check: checkTitleLength,
};
