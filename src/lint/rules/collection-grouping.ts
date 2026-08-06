// Implements the collection-grouping authoring rule: past a threshold, a flat
// list or table hides structure the author already knows, so a long collection
// must be grouped by a dimension that helps the reviewer judge it.

import type { Node } from "unist";
import {
  acceptanceCriteriaCollections,
  isGroupedList,
  isGroupedTable,
  isList,
  isTable,
} from "../collections.js";
import { isParent } from "../mdx-nodes.js";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

// Seven items is the point where a reader stops holding the whole collection
// at once; the rule fires past eight so a borderline list is left alone.
const MAXIMUM_UNGROUPED_ITEMS = 8;

const checkCollectionGrouping = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  const findings: Array<PlanLintFinding> = [];

  // A slide's single criteria collection is already held to the stricter
  // seven-criterion contract, so reporting it here would ask for the same edit
  // twice. Once a slide splits its criteria across several collections the
  // criteria rule treats them as grouped and reports nothing, so each one
  // stays subject to the general threshold.
  const criteriaCollections = new Set<Node>(
    acceptanceCriteriaCollections(tree)
      .filter(({ collections }) => collections.length === 1)
      .flatMap(({ collections }) => [...collections]),
  );

  const visit = (node: Node): void => {
    if (node.position !== undefined && !criteriaCollections.has(node)) {
      if (
        isList(node) &&
        node.children.length > MAXIMUM_UNGROUPED_ITEMS &&
        !isGroupedList(node)
      ) {
        findings.push({
          line: node.position.start.line,
          column: node.position.start.column,
          message: `Group this ${node.children.length}-item list by a dimension that helps the reviewer judge - importance, lifecycle stage, owner, audience - using a bulleted legend over nested items, or split it into shorter labelled lists`,
        });
      }
      if (isTable(node)) {
        const rowCount = node.children.length - 1;
        if (rowCount > MAXIMUM_UNGROUPED_ITEMS && !isGroupedTable(node)) {
          findings.push({
            line: node.position.start.line,
            column: node.position.start.column,
            message: `Group this ${rowCount}-row table by a dimension that helps the reviewer judge - importance, lifecycle stage, owner, audience - and make that dimension the first column so rows sharing a group sit together`,
          });
        }
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

export const collectionGroupingRule: PlanLintRule = {
  id: "collection-grouping",
  check: checkCollectionGrouping,
};
