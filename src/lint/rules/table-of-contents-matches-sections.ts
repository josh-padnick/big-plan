// Implements the table-of-contents-matches-sections authoring rule: when a plan carries
// a TableOfContents, its Entry section attributes must repeat the document's
// structural section names exactly, in order, one to one, so typed names and
// untyped h2 names can never drift from the overview.

import type { Node } from "unist";
import { collectAuthoredSections } from "../authored-sections.js";
import { isNamedFlowElement, isParent, stringAttribute } from "../mdx-nodes.js";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

type TableOfContentsNode = {
  readonly entries: ReadonlyArray<string>;
  readonly line: number;
  readonly column: number;
};

const checkTableOfContentsMatchesSections = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  const overviews: Array<TableOfContentsNode> = [];
  const sectionNames = collectAuthoredSections(tree).map(
    ({ name, toc }) => toc ?? name,
  );

  const visit = (node: Node): void => {
    if (
      isNamedFlowElement(node, "TableOfContents") &&
      node.position !== undefined
    ) {
      overviews.push({
        entries: node.children
          .filter((child) => isNamedFlowElement(child, "Entry"))
          .map((child) => stringAttribute({ node: child, name: "section" }))
          .filter((section): section is string => section !== undefined),
        line: node.position.start.line,
        column: node.position.start.column,
      });
    }
    if (isParent(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  visit(tree);

  const findings: Array<PlanLintFinding> = [];
  for (const overview of overviews) {
    const count = Math.max(overview.entries.length, sectionNames.length);
    for (let index = 0; index < count; index += 1) {
      const entry = overview.entries[index];
      const section = sectionNames[index];
      if (entry !== undefined && section !== undefined && entry !== section) {
        findings.push({
          line: overview.line,
          column: overview.column,
          message: `TableOfContents entry ${index + 1} says "${entry}" but section ${index + 1} is named "${section}"; list every section name exactly, in document order`,
        });
      } else if (entry !== undefined && section === undefined) {
        findings.push({
          line: overview.line,
          column: overview.column,
          message: `TableOfContents entry ${index + 1} ("${entry}") has no matching section; a TableOfContents lists exactly the document's sections`,
        });
      } else if (entry === undefined && section !== undefined) {
        findings.push({
          line: overview.line,
          column: overview.column,
          message: `TableOfContents is missing an entry for section ${index + 1} ("${section}")`,
        });
      }
    }
  }
  return findings;
};

export const tableOfContentsMatchesSectionsRule: PlanLintRule = {
  id: "table-of-contents-matches-sections",
  check: checkTableOfContentsMatchesSections,
};
