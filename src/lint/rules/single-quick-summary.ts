// Implements the single-quick-summary authoring rule: a plan carries at most
// one QuickSummary, so the reviewer always has exactly one place to start.

import type { Node, Parent } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

const isParent = (node: Node): node is Parent => "children" in node;

const isQuickSummary = (node: Node): boolean =>
  node.type === "mdxJsxFlowElement" &&
  "name" in node &&
  node.name === "QuickSummary";

const checkSingleQuickSummary = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  const findings: Array<PlanLintFinding> = [];
  let seen = 0;

  const visit = (node: Node): void => {
    if (isQuickSummary(node)) {
      seen += 1;
      if (seen > 1 && node.position !== undefined) {
        findings.push({
          line: node.position.start.line,
          column: node.position.start.column,
          message:
            "Only one QuickSummary is allowed; merge the key points into the first one",
        });
      }
    }
    if (isParent(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  visit(tree);
  return findings;
};

export const singleQuickSummaryRule: PlanLintRule = {
  id: "single-quick-summary",
  check: checkSingleQuickSummary,
};
