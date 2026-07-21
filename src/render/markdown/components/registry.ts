// Owns component registration and the first post-MDX rehype transform:
// centralized form validation, scoped child collection, depth-first global
// dispatch, and removal of every MDX node.

import type { Element, Root, RootContent } from "hast";
import type { Nodes as MarkdownNode, Root as MarkdownRoot } from "mdast";
import type {
  ComponentAttributeValue,
  ComponentDefinition,
  MarkdownBodyNodeKind,
  MarkdownBodyPolicy,
  ScopedChild,
} from "./component-contract.js";
import { CALLOUT_COMPONENT_DEFINITION } from "./callout/callout.js";
import { CODE_DIFF_COMPONENT_DEFINITION } from "./code-diff/code-diff.js";
import { CODE_SNIPPET_COMPONENT_DEFINITION } from "./code-snippet/code-snippet.js";
import { FILE_TREE_COMPONENT_DEFINITION } from "./file-tree/file-tree.js";
import { FILE_TREE_DIFF_COMPONENT_DEFINITION } from "./file-tree/file-tree-diff.js";
import { GRAPHQL_OPERATION_COMPONENT_DEFINITION } from "./graphql-operation/graphql-operation.js";
import { GRPC_METHOD_COMPONENT_DEFINITION } from "./grpc-method/grpc-method.js";
import { HTTP_ENDPOINT_COMPONENT_DEFINITION } from "./http-endpoint/http-endpoint.js";
import type { DiagnosticCollector } from "./diagnostics.js";

type MdxJsxFlowElement = Extract<
  RootContent,
  { readonly type: "mdxJsxFlowElement" }
>;

export const COMPONENT_REGISTRY: Readonly<Record<string, ComponentDefinition>> =
  {
    Callout: CALLOUT_COMPONENT_DEFINITION,
    CodeDiff: CODE_DIFF_COMPONENT_DEFINITION,
    CodeSnippet: CODE_SNIPPET_COMPONENT_DEFINITION,
    FileTree: FILE_TREE_COMPONENT_DEFINITION,
    FileTreeDiff: FILE_TREE_DIFF_COMPONENT_DEFINITION,
    GraphqlOperation: GRAPHQL_OPERATION_COMPONENT_DEFINITION,
    GrpcMethod: GRPC_METHOD_COMPONENT_DEFINITION,
    HttpEndpoint: HTTP_ENDPOINT_COMPONENT_DEFINITION,
  };

export const REGISTERED_COMPONENT_NAMES: ReadonlySet<string> = new Set(
  Object.keys(COMPONENT_REGISTRY),
);

const markdownChildren = (
  node: MarkdownRoot | MarkdownNode,
): ReadonlyArray<MarkdownNode> => ("children" in node ? node.children : []);

const registeredComponentName = (node: MarkdownNode): string | undefined =>
  node.type === "mdxJsxFlowElement" &&
  node.name !== null &&
  REGISTERED_COMPONENT_NAMES.has(node.name)
    ? node.name
    : undefined;

const prohibitedKind = (
  node: MarkdownNode,
): MarkdownBodyNodeKind | undefined =>
  node.type === "heading" ||
  node.type === "footnoteReference" ||
  node.type === "footnoteDefinition"
    ? node.type
    : registeredComponentName(node) === undefined
      ? undefined
      : "registeredComponent";

// Applies a scoped child's declared content policy recursively. Registered
// components are opaque after rejection so their internals add no secondary
// diagnostics for content the parent contract already excludes.
const validateMarkdownBody = ({
  node,
  policy,
  diagnostics,
}: {
  readonly node: MarkdownNode;
  readonly policy: MarkdownBodyPolicy;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const kind = prohibitedKind(node);
  const message = kind === undefined ? undefined : policy.prohibited[kind];
  if (message !== undefined) {
    diagnostics.add({ message, position: node.position });
  }
  if (kind === "registeredComponent") {
    return;
  }
  for (const child of markdownChildren(node)) {
    validateMarkdownBody({ node: child, policy, diagnostics });
  }
};

// Finds registered parents anywhere in Markdown and applies each direct
// scoped child's declarative body policy before Markdown becomes HAST.
const validateRegisteredComponentMarkdown = ({
  node,
  diagnostics,
}: {
  readonly node: MarkdownRoot | MarkdownNode;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const componentName =
    node.type === "root" ? undefined : registeredComponentName(node);
  const definition =
    componentName === undefined ? undefined : COMPONENT_REGISTRY[componentName];
  for (const child of markdownChildren(node)) {
    const scopedDefinition =
      child.type !== "mdxJsxFlowElement" || child.name === null
        ? undefined
        : definition?.scopedChildren?.[child.name];
    if (scopedDefinition !== undefined) {
      const policy = scopedDefinition.markdownBody;
      if (policy !== undefined) {
        for (const bodyChild of markdownChildren(child)) {
          validateMarkdownBody({
            node: bodyChild,
            policy,
            diagnostics,
          });
        }
      }
      if (policy?.prohibited.registeredComponent !== undefined) {
        continue;
      }
    }
    validateRegisteredComponentMarkdown({ node: child, diagnostics });
  }
};

/** Applies every component's declarative pre-HAST Markdown policy. */
export const remarkValidateComponents =
  ({ diagnostics }: { readonly diagnostics: DiagnosticCollector }) =>
  (tree: MarkdownRoot): void => {
    validateRegisteredComponentMarkdown({ node: tree, diagnostics });
  };

const isMdxNodeType = (type: string): boolean => type.startsWith("mdx");

// Maps disallowed non-component MDX nodes to their author-facing explanation.
const diagnosticMessage = (node: RootContent): string | undefined => {
  switch (node.type) {
    case "mdxjsEsm":
      return "ESM import/export statements are not supported";
    case "mdxFlowExpression":
      return "Flow expressions are not supported";
    case "mdxTextExpression":
      return "Text expressions are not supported";
    case "mdxJsxTextElement":
      return "Inline JSX is not supported; components must be flow-level";
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
}): Readonly<Record<string, ComponentAttributeValue>> => {
  const attributes: Array<readonly [string, ComponentAttributeValue]> = [];
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

const definitionFor = (name: string | null): ComponentDefinition | undefined =>
  name !== null && Object.hasOwn(COMPONENT_REGISTRY, name)
    ? COMPONENT_REGISTRY[name]
    : undefined;

const declaresScopedChild = ({
  definitions,
  name,
}: {
  readonly definitions: ComponentDefinition["scopedChildren"];
  readonly name: string | null;
}): boolean =>
  name !== null &&
  definitions !== undefined &&
  Object.hasOwn(definitions, name);

type ParentNode = Root | Element | MdxJsxFlowElement;

// Reports an unknown name, validates attributes, recursively prepares direct
// scoped children, then dispatches a registered global component.
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
      message: `Unknown component "${name ?? "<fragment>"}"`,
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
  readonly scopedDefinitions?: ComponentDefinition["scopedChildren"];
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
      parent.children.splice(
        index,
        1,
        ...(rendered === undefined ? [] : [rendered]),
      );
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
        message: `Internal error: MDX node "${child.type}" survived component rendering`,
        position: child.position,
      });
      continue;
    }
    if (child.type === "element") {
      reportSurvivors({ parent: child, diagnostics });
    }
  }
};

/** Creates the rehype transform that validates and dispatches components. */
export const rehypeRenderComponents =
  ({ diagnostics }: { readonly diagnostics: DiagnosticCollector }) =>
  (tree: Root): void => {
    renderChildren({ parent: tree, diagnostics });
    reportSurvivors({ parent: tree, diagnostics });
  };
