// Owns typed-block registration and the first post-MDX rehype transform:
// centralized form validation, scoped child collection, depth-first global
// dispatch, and removal of every MDX node.

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

export type ScopedChild = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, BlockAttributeValue>>;
  readonly children: ReadonlyArray<ElementContent>;
  readonly position: NodePosition;
};

export type BlockRenderer = (input: {
  readonly attributes: Readonly<Record<string, BlockAttributeValue>>;
  readonly children: ReadonlyArray<ElementContent>;
  readonly scopedChildren: ReadonlyArray<ScopedChild>;
  readonly position: NodePosition;
  readonly diagnostics: DiagnosticCollector;
}) => Element;

export type ScopedChildDefinition = {
  readonly kind: "scoped-child";
};

export type BlockDefinition = {
  readonly render: BlockRenderer;
  readonly scopedChildren?: Readonly<Record<string, ScopedChildDefinition>>;
};

export const BLOCK_REGISTRY: Readonly<Record<string, BlockDefinition>> = {
  Callout: { render: renderCallout },
  CodeDiff: {
    render: renderCodeDiff,
    scopedChildren: { Annotation: { kind: "scoped-child" } },
  },
};

export const REGISTERED_BLOCK_NAMES: ReadonlySet<string> = new Set(
  Object.keys(BLOCK_REGISTRY),
);

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

const definitionFor = (name: string | null): BlockDefinition | undefined =>
  name !== null && Object.hasOwn(BLOCK_REGISTRY, name)
    ? BLOCK_REGISTRY[name]
    : undefined;

const declaresScopedChild = ({
  definitions,
  name,
}: {
  readonly definitions: BlockDefinition["scopedChildren"];
  readonly name: string | null;
}): boolean =>
  name !== null && definitions !== undefined && Object.hasOwn(definitions, name);

type ParentNode = Root | Element | MdxJsxFlowElement;

// Reports an unknown name, validates attributes, recursively prepares direct
// scoped children, then dispatches a registered global block.
const renderFlowElement = ({
  node,
  diagnostics,
}: {
  readonly node: MdxJsxFlowElement;
  readonly diagnostics: DiagnosticCollector;
}): Element | undefined => {
  const name = node.name;
  const definition = definitionFor(name);
  if (definition === undefined) {
    diagnostics.add({
      message: `Unknown block "${name ?? "<fragment>"}"`,
      position: node.position,
    });
  }
  const attributes = normalizeAttributes({ node, diagnostics });
  const scopedChildren = renderChildren({
    parent: node,
    scopedDefinitions: definition?.scopedChildren,
    diagnostics,
  });
  if (definition === undefined) {
    return undefined;
  }
  return definition.render({
    attributes,
    children: node.children,
    scopedChildren,
    position: node.position,
    diagnostics,
  });
};

/** Rewrites MDX children and returns direct scoped children in authored order. */
const renderChildren = ({
  parent,
  scopedDefinitions,
  diagnostics,
}: {
  readonly parent: ParentNode;
  readonly scopedDefinitions?: BlockDefinition["scopedChildren"];
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<ScopedChild> => {
  const scopedChildren: Array<ScopedChild> = [];
  let index = 0;
  while (index < parent.children.length) {
    const child = parent.children[index];
    if (child === undefined) {
      index += 1;
      continue;
    }
    const childName = child.type === "mdxJsxFlowElement" ? child.name : null;
    if (
      child.type === "mdxJsxFlowElement" &&
      childName !== null &&
      declaresScopedChild({ definitions: scopedDefinitions, name: childName })
    ) {
      renderChildren({ parent: child, diagnostics });
      scopedChildren.push({
        name: childName,
        attributes: normalizeAttributes({ node: child, diagnostics }),
        children: child.children,
        position: child.position,
      });
      parent.children.splice(index, 1);
      continue;
    }
    if (child.type === "element") {
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
  return scopedChildren;
};

/** Reports impossible post-transform MDX survivors. */
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
