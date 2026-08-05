// Marks renderer-owned Markdown elements before component presentation is
// materialized, giving prose styles an explicit provenance boundary.

import type { Element, Root, RootContent } from "hast";

type MdxJsxFlowElement = Extract<
  RootContent,
  { readonly type: "mdxJsxFlowElement" }
>;

type ProseParent = Root | Element | MdxJsxFlowElement;

/** Opts authored Markdown into prose styling without styling component chrome. */
export const markAuthoredProse = (node: ProseParent): void => {
  for (const child of node.children) {
    if (child.type === "element") {
      child.properties["data-authored-prose"] = "";
      markAuthoredProse(child);
    } else if (child.type === "mdxJsxFlowElement") {
      markAuthoredProse(child);
    }
  }
};

export const rehypeMarkAuthoredProse =
  () =>
  (tree: Root): void => {
    markAuthoredProse(tree);
  };
