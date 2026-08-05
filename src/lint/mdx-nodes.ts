// Owns the mdast/MDX node reader shared by lint rules and lint support
// modules: parent detection, component identification, and static attribute
// reading.

import type { Node, Parent } from "unist";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Narrows any mdast node that carries children. */
export const isParent = (node: Node): node is Parent => "children" in node;

/** Narrows an authored flow-level component element by its authored name. */
export const isNamedFlowElement = (node: Node, name: string): node is Parent =>
  node.type === "mdxJsxFlowElement" &&
  isParent(node) &&
  "name" in node &&
  node.name === name;

/**
 * Reads one static string attribute from an authored component node; missing
 * and expression-valued attributes read as absent, and structural compilation
 * owns rejecting them.
 */
export const stringAttribute = ({
  node,
  name,
}: {
  readonly node: Node;
  readonly name: string;
}): string | undefined => {
  if (!("attributes" in node) || !Array.isArray(node.attributes)) {
    return undefined;
  }
  for (const attribute of node.attributes) {
    if (
      isRecord(attribute) &&
      attribute["type"] === "mdxJsxAttribute" &&
      attribute["name"] === name
    ) {
      const value = attribute["value"];
      return typeof value === "string" ? value : undefined;
    }
  }
  return undefined;
};
