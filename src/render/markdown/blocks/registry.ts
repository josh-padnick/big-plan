// Owns the typed-block registry and the first rehype transform after MDX is
// converted to HAST: validation, dispatch, and removal of every MDX node.

import type { Element, ElementContent, Root, RootContent } from "hast";
import { renderCallout } from "./callout/callout.js";
import { renderCodeDiff } from "./code-diff/code-diff.js";
import type { DiagnosticCollector } from "./diagnostics.js";

type MdxJsxFlowElement = Extract<
  RootContent,
  { readonly type: "mdxJsxFlowElement" }
>;
type NodePosition = Root["position"];

export type BlockAttributeValue = string | boolean;

export type BlockRenderer = (input: {
  readonly attributes: Readonly<Record<string, BlockAttributeValue>>;
  readonly children: ReadonlyArray<ElementContent>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
}) => Element;

export const BLOCK_REGISTRY: Readonly<Record<string, BlockRenderer>> = {
  Callout: renderCallout,
  CodeDiff: renderCodeDiff,
};

const isMdxNodeType = (type: string): boolean => type.startsWith("mdx");

// Maps disallowed non-block MDX nodes to their author-facing explanation.
const diagnosticMessage = (node: RootContent): string | undefined => {
  switch (node.type) {
    case "mdxjsEsm":
      return "ESM import/export statements are not supported";
    case "mdxFlowExpression":
      return "Flow expressions are not supported";
    case "mdxTextExpression":
      return "Text expressions are not supported";
    case "mdxJsxTextElement":
      return "Inline JSX is not supported; blocks must be flow-level";
    default:
      return undefined;
  }
};

// Accepts static strings and shorthand booleans while reporting every unsafe
// or ambiguous attribute form on the element.
const normalizeAttributes = ({
  node,
  diagnostics,
}: {
  readonly node: MdxJsxFlowElement;
  readonly diagnostics: DiagnosticCollector;
}): Readonly<Record<string, BlockAttributeValue>> => {
  const attributes: Array<readonly [string, BlockAttributeValue]> = [];
  const names = new Set<string>();
  for (const attribute of node.attributes) {
    if (attribute.type === "mdxJsxExpressionAttribute") {
      diagnostics.add({
        message: "Spread attributes are not supported",
        position: attribute.position,
      });
      continue;
    }
    if (names.has(attribute.name)) {
      diagnostics.add({
        message: `Duplicate attribute "${attribute.name}"`,
        position: attribute.position,
      });
      continue;
    }
    names.add(attribute.name);
    if (typeof attribute.value === "object" && attribute.value !== null) {
      diagnostics.add({
        message: `Expression-valued attribute "${attribute.name}" is not supported`,
        position: attribute.position,
      });
      continue;
    }
    attributes.push([attribute.name, attribute.value ?? true]);
  }
  return Object.fromEntries(attributes);
};

// Reports an unknown name, validates attributes, then dispatches registered
// blocks with already-processed HAST children.
const renderFlowElement = ({
  node,
  diagnostics,
}: {
  readonly node: MdxJsxFlowElement;
  readonly diagnostics: DiagnosticCollector;
}): Element | undefined => {
  const name = node.name;
  const renderer = name !== null && Object.hasOwn(BLOCK_REGISTRY, name)
    ? BLOCK_REGISTRY[name]
    : undefined;
  if (renderer === undefined) {
    diagnostics.add({
      message: `Unknown block "${name ?? "<fragment>"}"`,
      position: node.position,
    });
  }
  const attributes = normalizeAttributes({ node, diagnostics });
  if (renderer === undefined) {
    return undefined;
  }
  return renderer({
    attributes,
    children: node.children,
    position: node.position,
    diagnostics,
  });
};

type ParentNode = Root | Element | MdxJsxFlowElement;

/** Rewrites or removes MDX children recursively while retaining HAST order. */
const renderChildren = ({
  parent,
  diagnostics,
}: {
  readonly parent: ParentNode;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  let index = 0;
  while (index < parent.children.length) {
    const child = parent.children[index];
    if (child === undefined) {
      index += 1;
      continue;
    }
    if (child.type === "element" || child.type === "mdxJsxFlowElement") {
      renderChildren({ parent: child, diagnostics });
    }
    if (child.type === "mdxJsxFlowElement") {
      const rendered = renderFlowElement({ node: child, diagnostics });
      parent.children.splice(index, 1, ...(rendered === undefined ? [] : [rendered]));
      if (rendered !== undefined) {
        index += 1;
      }
      continue;
    }
    const message = diagnosticMessage(child);
    if (message !== undefined) {
      diagnostics.add({ message, position: child.position });
      parent.children.splice(index, 1);
      continue;
    }
    index += 1;
  }
};

/** Finds an impossible post-transform MDX survivor as a defensive invariant. */
const reportSurvivors = ({
  parent,
  diagnostics,
}: {
  readonly parent: Root | Element;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  for (const child of parent.children) {
    if (isMdxNodeType(child.type)) {
      diagnostics.add({
        message: `Internal error: MDX node "${child.type}" survived block rendering`,
        position: child.position,
      });
      continue;
    }
    if (child.type === "element") {
      reportSurvivors({ parent: child, diagnostics });
    }
  }
};

/** Creates the rehype transform that validates and dispatches typed blocks. */
export const rehypeRenderBlocks = ({
  diagnostics,
}: {
  readonly diagnostics: DiagnosticCollector;
}) => (tree: Root): void => {
  renderChildren({ parent: tree, diagnostics });
  reportSurvivors({ parent: tree, diagnostics });
};
