// Implements the slide-leading-title authoring rule: a slide or sub-slide
// names its message before it shows anything, so a reviewer never meets a
// figure before the sentence saying what it is for.

import type { Heading, Text } from "mdast";
import type { Node, Parent } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

const isParent = (node: Node): node is Parent => "children" in node;

const isHeading = (node: Node): node is Heading => node.type === "heading";

const isText = (node: Node): node is Text => node.type === "text";

// Whitespace-only text between blocks carries no content of its own.
const isBlank = (node: Node): boolean =>
  isText(node) && node.value.trim() === "";

const isImage = (node: Node): boolean =>
  node.type === "image" || node.type === "imageReference";

const containsOnlyImage = (node: Node): boolean => {
  if (!isParent(node)) {
    return false;
  }
  const meaningful = node.children.filter((child) => !isBlank(child));
  const [only] = meaningful;
  return meaningful.length === 1 && only !== undefined && isImage(only);
};

// An image standing alone in its paragraph is a figure; an image inside a
// sentence is illustration the surrounding prose already introduces.
const isImageParagraph = (node: Node): boolean => {
  if (node.type !== "paragraph" || !isParent(node)) {
    return false;
  }
  const meaningful = node.children.filter((child) => !isBlank(child));
  const [only] = meaningful;
  return (
    meaningful.length === 1 &&
    only !== undefined &&
    (isImage(only) ||
      ((only.type === "link" || only.type === "linkReference") &&
        containsOnlyImage(only)))
  );
};

// The block kinds that arrive as a picture rather than a claim. None of them
// states what it is for, so one directly under a heading leaves the reader
// reconstructing the point from the artwork.
const isFigure = (node: Node): boolean =>
  node.type === "mdxJsxFlowElement" ||
  node.type === "code" ||
  node.type === "table" ||
  isImageParagraph(node);

// Only a slide (h2) or sub-slide (h3) heading opens a frame that needs its own
// leading title. A deeper heading directly under one is that title, and a
// following sibling heading means the frame holds no content to lead.
const checkSlideLeadingTitle = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  if (!isParent(tree)) {
    return [];
  }
  const findings: Array<PlanLintFinding> = [];
  for (const [index, node] of tree.children.entries()) {
    if (!isHeading(node) || (node.depth !== 2 && node.depth !== 3)) {
      continue;
    }
    const next = tree.children[index + 1];
    if (
      next === undefined ||
      next.position === undefined ||
      isHeading(next) ||
      !isFigure(next)
    ) {
      continue;
    }
    findings.push({
      line: next.position.start.line,
      column: next.position.start.column,
      message:
        node.depth === 3
          ? "Title this sub-slide above the figure: its h3 renders as a small kicker, so add an h4 line stating the message this figure shows"
          : "Say what this figure shows before showing it: lead the slide with a title line or a context builder, not the figure",
    });
  }
  return findings;
};

export const slideLeadingTitleRule: PlanLintRule = {
  id: "slide-leading-title",
  check: checkSlideLeadingTitle,
};
