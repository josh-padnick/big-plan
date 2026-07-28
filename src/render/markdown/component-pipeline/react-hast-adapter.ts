// Owns the sole static React-to-HAST boundary: serialization, reparsing,
// parser-property normalization, and the single-root-element contract.

import { fromHtml } from "hast-util-from-html";
import type { Element, RootContent } from "hast";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

// Restores the authored-HAST property conventions after the HTML parser
// normalizes boolean SVG and data-* attributes differently.
const normalizeReparsedProperties = (
  nodes: ReadonlyArray<RootContent>,
): void => {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (node.properties["hidden"] === "") {
      node.properties["hidden"] = true;
    }
    const renamed: Element["properties"] = {};
    for (const key of Object.keys(node.properties)) {
      const dashed = /^data[A-Z]/.test(key)
        ? key.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`)
        : key;
      renamed[dashed] = node.properties[key];
    }
    node.properties = renamed;
    normalizeReparsedProperties(node.children);
  }
};

export type ReactHastAdapter = (presentation: ReactNode) => Element | undefined;

/** Converts one deferred React presentation into its normalized root element. */
export const reactToHast: ReactHastAdapter = (presentation) => {
  const fragment = fromHtml(renderToStaticMarkup(presentation), {
    fragment: true,
  });
  normalizeReparsedProperties(fragment.children);
  const elements = fragment.children.filter(
    (child): child is Element => child.type === "element",
  );
  return elements.length === 1 ? elements[0] : undefined;
};
