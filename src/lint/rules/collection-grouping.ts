// Implements the collection-grouping authoring rule: past a threshold, a flat
// list or table hides structure the author already knows, so a long collection
// must be grouped by a dimension that helps the reviewer judge it.

import type { InlineCode, List, Table, Text } from "mdast";
import type { Node, Parent } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

// Seven items is the point where a reader stops holding the whole collection
// at once; the rule fires past eight so a borderline list is left alone.
const MAXIMUM_UNGROUPED_ITEMS = 8;

const isParent = (node: Node): node is Parent => "children" in node;

const isText = (node: Node): node is Text => node.type === "text";

const isInlineCode = (node: Node): node is InlineCode =>
  node.type === "inlineCode";

const isList = (node: Node): node is List => node.type === "list";

const isTable = (node: Node): node is Table => node.type === "table";

const textOf = (node: Node): string => {
  if (isText(node) || isInlineCode(node)) {
    return node.value;
  }
  return isParent(node) ? node.children.map(textOf).join("") : "";
};

// A list is grouped when its items carry their own nested items, which is the
// shape a bulleted legend over sub-items produces. An author who instead
// splits the collection into several short labelled lists never reaches the
// threshold on any one of them.
const isGroupedList = (list: List): boolean =>
  list.children.some(
    (item) => isParent(item) && item.children.some((child) => isList(child)),
  );

// A table is grouped when its first column repeats, which is what a grouping
// dimension looks like once equal values sit together.
const isGroupedTable = (table: Table): boolean => {
  const rows = table.children.slice(1);
  const keys = rows.map((row) =>
    isParent(row) && row.children[0] !== undefined
      ? textOf(row.children[0]).trim().toLowerCase()
      : "",
  );
  return new Set(keys).size < keys.length;
};

const checkCollectionGrouping = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  const findings: Array<PlanLintFinding> = [];

  const visit = (node: Node): void => {
    if (node.position !== undefined) {
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
