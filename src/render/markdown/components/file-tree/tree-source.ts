// Extracts the shared single tree-fence contract from FileTree component
// children before later code transforms can replace the raw source text.

import type { Element, ElementContent, Root } from "hast";

type NodePosition = Root["position"];

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

const isWhitespace = (node: ElementContent): boolean =>
  node.type === "text" && /^\s*$/u.test(node.value);

const languageClasses = (element: Element): ReadonlyArray<string> => {
  const className = element.properties.className;
  if (!Array.isArray(className)) {
    return [];
  }
  return className.filter(
    (value): value is string => typeof value === "string",
  );
};

/** Returns raw tree text only when the block contains exactly one tree fence. */
export const treeSource = ({
  children,
}: {
  readonly children: ReadonlyArray<ElementContent>;
}): { readonly source?: string; readonly codePosition?: NodePosition } => {
  const meaningful = children.filter((child) => !isWhitespace(child));
  if (meaningful.length !== 1) {
    return {};
  }
  const pre = meaningful[0];
  if (pre === undefined || !isElement(pre) || pre.tagName !== "pre") {
    return {};
  }
  if (pre.children.length !== 1) {
    return {};
  }
  const code = pre.children[0];
  if (
    code === undefined ||
    !isElement(code) ||
    code.tagName !== "code" ||
    !languageClasses(code).includes("language-tree") ||
    code.children.length !== 1
  ) {
    return {};
  }
  const source = code.children[0];
  if (source === undefined || source.type !== "text") {
    return {};
  }
  return { source: source.value, codePosition: code.position };
};
