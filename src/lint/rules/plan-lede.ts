// Implements the plan-lede authoring rule: a plan that opens with a title
// must state its thesis in prose before the first section heading, so the
// reader is oriented before structure begins.

import type { Heading } from "mdast";
import type { Node, Parent } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

const isParent = (node: Node): node is Parent => "children" in node;

const isHeading = (node: Node): node is Heading => node.type === "heading";

// Only a top-level title followed directly by another heading is a confident
// finding. A document without a leading level-one title, or one that already
// opens with any non-heading flow content, is left alone.
const checkPlanLede = ({
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
    !isHeading(first) ||
    first.depth !== 1 ||
    !isHeading(second) ||
    second.position === undefined
  ) {
    return [];
  }
  return [
    {
      line: second.position.start.line,
      column: second.position.start.column,
      message:
        "Open with a lede: one or two sentences after the title stating the plan's thesis, before the first section heading",
    },
  ];
};

export const planLedeRule: PlanLintRule = {
  id: "plan-lede",
  check: checkPlanLede,
};
