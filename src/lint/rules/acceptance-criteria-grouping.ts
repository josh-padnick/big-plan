// Implements the acceptance-criteria grouping rule: a verification contract
// with more than seven criteria must expose a grouping dimension.

import type { List } from "mdast";
import {
  acceptanceCriteriaCollections,
  isGroupedList,
  isGroupedTable,
  isList,
} from "../collections.js";
import { isParent } from "../mdx-nodes.js";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

const MAXIMUM_UNGROUPED_CRITERIA = 7;

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

const checkAcceptanceCriteriaGrouping: PlanLintRule["check"] = ({ tree }) => {
  const findings: Array<PlanLintFinding> = [];
  for (const { section, collections } of acceptanceCriteriaCollections(tree)) {
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
      collections.some((collection) =>
        isList(collection)
          ? isGroupedList(collection)
          : isGroupedTable(collection),
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
