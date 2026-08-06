// Owns the collection reader shared by the grouping rules: list and table
// narrowing, the structural collections a slide body itself presents, and the
// heuristics that decide whether a collection already exposes a grouping
// dimension.

import type { List, Table } from "mdast";
import type { Node } from "unist";
import {
  collectAuthoredSections,
  type AuthoredSection,
} from "./authored-sections.js";
import { isParent } from "./mdx-nodes.js";

/** Narrows a Markdown list node. */
export const isList = (node: Node): node is List => node.type === "list";

/** Narrows a GFM table node. */
export const isTable = (node: Node): node is Table => node.type === "table";

const textOf = (node: Node): string => {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  return isParent(node) ? node.children.map(textOf).join("") : "";
};

/**
 * Returns the collections a section body presents directly. A list or table
 * nested inside a component belongs to that component's own presentation, so
 * it is not part of the section's own collection structure.
 */
const directCollectionsIn = (
  nodes: ReadonlyArray<Node>,
): ReadonlyArray<List | Table> =>
  nodes.filter((node): node is List | Table => isList(node) || isTable(node));

/**
 * Returns the collections each acceptance-criteria slide presents as its own
 * criteria, so the criteria contract and the general collection rule agree on
 * which nodes the criteria rule already owns.
 */
export const acceptanceCriteriaCollections = (
  tree: Node,
): ReadonlyArray<{
  readonly section: AuthoredSection;
  readonly collections: ReadonlyArray<List | Table>;
}> =>
  collectAuthoredSections(tree)
    .filter((section) => section.type === "acceptance-criteria")
    .map((section) => ({
      section,
      collections: directCollectionsIn(section.content),
    }));

// A list is grouped when its items carry their own nested items, which is the
// shape a bulleted legend over sub-items produces. An author who instead
// splits the collection into several short labelled lists never reaches the
// threshold on any one of them.
export const isGroupedList = (list: List): boolean =>
  list.children.some(
    (item) => isParent(item) && item.children.some((child) => isList(child)),
  );

// A table is grouped when its first column repeats, which is what a grouping
// dimension looks like once equal values sit together.
export const isGroupedTable = (table: Table): boolean => {
  const keys = table.children
    .slice(1)
    .map((row) =>
      isParent(row) && row.children[0] !== undefined
        ? textOf(row.children[0]).trim().toLowerCase()
        : "",
    );
  return new Set(keys).size < keys.length;
};
