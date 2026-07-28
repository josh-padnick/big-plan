// Owns the structural mechanics shared by authored component bodies:
// ignorable whitespace, fenced-code shape, language, source, and positions.

import type { Element, ElementContent, Root } from "hast";

type NodePosition = Root["position"];

export type AuthoredFence = {
  readonly source: string;
  readonly language?: string;
  readonly codePosition: NodePosition;
};

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

/** Identifies whitespace emitted between authored block children. */
export const isIgnorableWhitespace = (node: ElementContent): boolean =>
  node.type === "text" && /^\s*$/u.test(node.value);

/** Removes only whitespace separators while retaining authored block order. */
export const meaningfulChildren = (
  children: ReadonlyArray<ElementContent>,
): ReadonlyArray<ElementContent> =>
  children.filter((child) => !isIgnorableWhitespace(child));

const languageClasses = (element: Element): ReadonlyArray<string> => {
  const className = element.properties.className;
  if (!Array.isArray(className)) {
    return [];
  }
  return className.filter(
    (value): value is string => typeof value === "string",
  );
};

/** Reads the declared language from a pre containing a code child. */
export const fenceLanguage = (node: ElementContent): string | undefined => {
  if (!isElement(node) || node.tagName !== "pre") {
    return undefined;
  }
  const code = node.children.find(
    (child) => isElement(child) && child.tagName === "code",
  );
  if (code === undefined || !isElement(code)) {
    return undefined;
  }
  const languageClass = languageClasses(code).find((name) =>
    name.startsWith("language-"),
  );
  return languageClass?.slice("language-".length);
};

/** Identifies a pre containing a code child, with or without a language. */
export const isAuthoredFence = (node: ElementContent): boolean =>
  isElement(node) &&
  node.tagName === "pre" &&
  node.children.some((child) => isElement(child) && child.tagName === "code");

/**
 * Reads exactly one pre > code > text fence after ignoring separators.
 * Callers retain ownership of requirements and diagnostic wording.
 */
export const singleAuthoredFence = ({
  children,
  language,
}: {
  readonly children: ReadonlyArray<ElementContent>;
  readonly language?: string;
}): AuthoredFence | undefined => {
  const meaningful = meaningfulChildren(children);
  if (meaningful.length !== 1) {
    return undefined;
  }
  const pre = meaningful[0];
  if (
    pre === undefined ||
    !isElement(pre) ||
    pre.tagName !== "pre" ||
    pre.children.length !== 1
  ) {
    return undefined;
  }
  const code = pre.children[0];
  if (
    code === undefined ||
    !isElement(code) ||
    code.tagName !== "code" ||
    code.children.length !== 1
  ) {
    return undefined;
  }
  const text = code.children[0];
  if (text === undefined || text.type !== "text") {
    return undefined;
  }
  const declaredLanguage = fenceLanguage(pre);
  if (language !== undefined && declaredLanguage !== language) {
    return undefined;
  }
  return {
    source: text.value,
    ...(declaredLanguage === undefined ? {} : { language: declaredLanguage }),
    codePosition: code.position,
  };
};

/** Counts fences recursively through prose containers such as quotes/lists. */
export const countAuthoredFences = (
  children: ReadonlyArray<ElementContent>,
): number => {
  let count = 0;
  for (const child of children) {
    if (isAuthoredFence(child)) {
      count += 1;
    } else if (isElement(child)) {
      count += countAuthoredFences(child.children);
    }
  }
  return count;
};
