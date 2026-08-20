// The delivery-local address that joins a rendered component root back to the
// model the component compiled.
//
// Delivery mints one key per compiled instance and stamps it on that
// instance's rendered root; block identity reads the key to record what the
// component asserted on the block a reader points at; and the strip pass here
// removes every key once identity has run. The key therefore lives inside one
// compilation and never reaches a reader: a rendered document is byte-for-byte
// what it was before the join existed, which is the only reason a join through
// the markup is safe at all.

import type { Element, ElementContent, Root, RootContent } from "hast";

export const COMPONENT_INSTANCE_ATTRIBUTE = "data-component-instance";

/** Mints the delivery-local instance keys of one compilation, in order. */
export const createComponentInstanceKeys = (): (() => string) => {
  let minted = 0;
  return () => {
    minted += 1;
    return `component-${minted}`;
  };
};

/** Reads the instance key a delivery stamped on a rendered component root. */
export const componentInstanceKeyOf = (node: Element): string | undefined => {
  const key = node.properties[COMPONENT_INSTANCE_ATTRIBUTE];
  return typeof key === "string" && key.length > 0 ? key : undefined;
};

const stripChildren = (
  children: ReadonlyArray<RootContent | ElementContent>,
): void => {
  for (const child of children) {
    if (child.type !== "element") {
      continue;
    }
    delete child.properties[COMPONENT_INSTANCE_ATTRIBUTE];
    stripChildren(child.children);
  }
};

/**
 * Removes every delivery-local instance key from a finished document, so the
 * join leaves no trace in the HTML a reader receives.
 */
export const stripComponentInstanceKeys = (tree: Root): void => {
  stripChildren(tree.children);
};
