// Implements the acceptance-criteria grouping rule: a verification contract
// with more than seven criteria must expose a grouping dimension.

import type { List, Table } from "mdast";
import type { Node, Parent } from "unist";
import { collectAuthoredSections } from "../authored-sections.js";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

const MAXIMUM_UNGROUPED_CRITERIA = 7;

const isParent = (node: Node): node is Parent => "children" in node;
const isList = (node: Node): node is List => node.type === "list";
const isTable = (node: Node): node is Table => node.type === "table";

const hasNestedList = (list: List): boolean =>
  list.children.some(
    (item) => isParent(item) && item.children.some((child) => isList(child)),
  );

const countLeafCriteria = (list: List): number =>
  list.children.reduce((count, item) => {
    if (!isParent(item)) {
      return count;
    }
    const nested = item.children.filter(isList);
    return nested.length === 0
      ? count + 1
      : count +
          nested.reduce((total, child) => total + countLeafCriteria(child), 0);
  }, 0);

const textOf = (node: Node): string => {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  return isParent(node) ? node.children.map(textOf).join("") : "";
};

const hasRepeatingFirstColumn = (table: Table): boolean => {
  const keys = table.children
    .slice(1)
    .map((row) =>
      isParent(row) && row.children[0] !== undefined
        ? textOf(row.children[0]).trim().toLowerCase()
        : "",
    );
  return new Set(keys).size < keys.length;
};

const collectionsIn = (nodes: ReadonlyArray<Node>): Array<List | Table> => {
  const collections: Array<List | Table> = [];
  const visit = (node: Node): void => {
    if (isList(node) || isTable(node)) {
      collections.push(node);
      return;
    }
    if (isParent(node)) {
      node.children.forEach(visit);
    }
  };
  nodes.forEach(visit);
  return collections;
};

const checkAcceptanceCriteriaGrouping: PlanLintRule["check"] = ({ tree }) => {
  const findings: Array<PlanLintFinding> = [];
  for (const section of collectAuthoredSections(tree)) {
    if (section.type !== "acceptance-criteria") {
      continue;
    }
    const collections = collectionsIn(section.content);
    const total = collections.reduce(
      (count, collection) =>
        count +
        (isList(collection)
          ? countLeafCriteria(collection)
          : collection.children.length - 1),
      0,
    );
    const grouped =
      collections.length > 1 ||
      collections.some(
        (collection) =>
          (isList(collection) && hasNestedList(collection)) ||
          (isTable(collection) && hasRepeatingFirstColumn(collection)),
      );
    if (total > MAXIMUM_UNGROUPED_CRITERIA && !grouped) {
      findings.push({
        line: section.line,
        column: section.column,
        message: `Group all ${total} acceptance criteria by a dimension that helps the reviewer judge them; more than seven criteria must not stay flat`,
      });
    }
  }
  return findings;
};

export const acceptanceCriteriaGroupingRule: PlanLintRule = {
  id: "acceptance-criteria-grouping",
  check: checkAcceptanceCriteriaGrouping,
};
