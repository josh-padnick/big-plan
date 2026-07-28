// Owns component registration and the first post-MDX rehype transform:
// centralized form validation, scoped child collection, depth-first global
// dispatch, and removal of every MDX node.

import { fromHtml } from "hast-util-from-html";
import type { Element, Root, RootContent } from "hast";
import type { Nodes as MarkdownNode, Root as MarkdownRoot } from "mdast";
import type {
  ComponentAttributeValue,
  ComponentDefinition,
  MarkdownBodyNodeKind,
  MarkdownBodyPolicy,
  ScopedChild,
  ScopedChildDefinition,
} from "../../../model/component-contract.js";
import {
  createComponentIdAllocator,
  type ComponentIdAllocator,
} from "../../../model/component-contract.js";
import { BIG_DECISION_COMPONENT_DEFINITION } from "./big-decision/big-decision.js";
import { CALLOUT_COMPONENT_DEFINITION } from "./callout/callout.js";
import { CODE_DIFF_COMPONENT_DEFINITION } from "./code-diff/code-diff.js";
import { CODE_SNIPPET_COMPONENT_DEFINITION } from "./code-snippet/code-snippet.js";
import { DATABASE_TABLE_SCHEMA_COMPONENT_DEFINITION } from "./database-table-schema/database-table-schema.js";
import { FILE_TREE_COMPONENT_DEFINITION } from "./file-tree/file-tree.js";
import { FILE_TREE_DIFF_COMPONENT_DEFINITION } from "./file-tree/file-tree-diff.js";
import { GRAPHQL_OPERATION_COMPONENT_DEFINITION } from "./graphql-operation/graphql-operation.js";
import { GRPC_METHOD_COMPONENT_DEFINITION } from "./grpc-method/grpc-method.js";
import { HTTP_ENDPOINT_COMPONENT_DEFINITION } from "./http-endpoint/http-endpoint.js";
import { SMALL_DECISION_SET_COMPONENT_DEFINITION } from "./small-decision-set/small-decision-set.js";
import { createDiagnosticCollector } from "../../../model/diagnostics.js";
import type { DiagnosticCollector } from "../../../model/diagnostics.js";

type MdxJsxFlowElement = Extract<
  RootContent,
  { readonly type: "mdxJsxFlowElement" }
>;

export const COMPONENT_REGISTRY: Readonly<Record<string, ComponentDefinition>> =
  {
    BigDecision: BIG_DECISION_COMPONENT_DEFINITION,
    Callout: CALLOUT_COMPONENT_DEFINITION,
    CodeDiff: CODE_DIFF_COMPONENT_DEFINITION,
    CodeSnippet: CODE_SNIPPET_COMPONENT_DEFINITION,
    DatabaseTableSchema: DATABASE_TABLE_SCHEMA_COMPONENT_DEFINITION,
    FileTree: FILE_TREE_COMPONENT_DEFINITION,
    FileTreeDiff: FILE_TREE_DIFF_COMPONENT_DEFINITION,
    GraphqlOperation: GRAPHQL_OPERATION_COMPONENT_DEFINITION,
    GrpcMethod: GRPC_METHOD_COMPONENT_DEFINITION,
    HttpEndpoint: HTTP_ENDPOINT_COMPONENT_DEFINITION,
    SmallDecisionSet: SMALL_DECISION_SET_COMPONENT_DEFINITION,
  };

export type ComponentRegistry = Readonly<Record<string, ComponentDefinition>>;

/** One collected component instance: its name, position, and plan model. */
export type CollectedComponentModel = {
  readonly component: string;
  readonly line?: number;
  readonly column?: number;
  readonly model: unknown;
};

// The collector compiles with its own allocator (same reservations, same
// call order, therefore identical ids) and a discarded diagnostics
// collector, because the render path has already reported every authoring
// error once.
type ModelCollector = {
  readonly collected: Array<CollectedComponentModel>;
  readonly ids: ComponentIdAllocator;
  readonly diagnostics: DiagnosticCollector;
};

export const REGISTERED_COMPONENT_NAMES: ReadonlySet<string> = new Set(
  Object.keys(COMPONENT_REGISTRY),
);

const markdownChildren = (
  node: MarkdownRoot | MarkdownNode,
): ReadonlyArray<MarkdownNode> => ("children" in node ? node.children : []);

const registeredComponentName = ({
  node,
  registry,
}: {
  readonly node: MarkdownNode;
  readonly registry: ComponentRegistry;
}): string | undefined =>
  node.type === "mdxJsxFlowElement" &&
  node.name !== null &&
  Object.hasOwn(registry, node.name)
    ? node.name
    : undefined;

const prohibitedKind = ({
  node,
  registry,
}: {
  readonly node: MarkdownNode;
  readonly registry: ComponentRegistry;
}): MarkdownBodyNodeKind | undefined =>
  node.type === "heading" ||
  node.type === "footnoteReference" ||
  node.type === "footnoteDefinition"
    ? node.type
    : registeredComponentName({ node, registry }) === undefined
      ? undefined
      : "registeredComponent";

// Applies a scoped child's declared content policy recursively. Registered
// components are opaque after rejection so their internals add no secondary
// diagnostics for content the parent contract already excludes, and declared
// nested scoped children are skipped because their own policy governs them.
const validateMarkdownBody = ({
  node,
  policy,
  diagnostics,
  registry,
  nestedScopedNames,
}: {
  readonly node: MarkdownNode;
  readonly policy: MarkdownBodyPolicy;
  readonly diagnostics: DiagnosticCollector;
  readonly registry: ComponentRegistry;
  readonly nestedScopedNames: ReadonlySet<string>;
}): void => {
  if (
    node.type === "mdxJsxFlowElement" &&
    node.name !== null &&
    nestedScopedNames.has(node.name)
  ) {
    return;
  }
  const kind = prohibitedKind({ node, registry });
  const message = kind === undefined ? undefined : policy.prohibited[kind];
  if (message !== undefined) {
    diagnostics.add({ message, position: node.position });
  }
  if (kind === "registeredComponent") {
    return;
  }
  for (const child of markdownChildren(node)) {
    validateMarkdownBody({
      node: child,
      policy,
      diagnostics,
      registry,
      nestedScopedNames,
    });
  }
};

type ScopedParentDefinition = ComponentDefinition | ScopedChildDefinition;

const definitionFor = ({
  name,
  registry,
}: {
  readonly name: string | null;
  readonly registry: ComponentRegistry;
}): ComponentDefinition | undefined =>
  name !== null && Object.hasOwn(registry, name) ? registry[name] : undefined;

const scopedDefinitionFor = ({
  definitions,
  name,
}: {
  readonly definitions: ScopedParentDefinition["scopedChildren"];
  readonly name: string | null;
}): ScopedChildDefinition | undefined =>
  name !== null && definitions !== undefined && Object.hasOwn(definitions, name)
    ? definitions[name]
    : undefined;

// Carries the matched definition down the authored hierarchy so each level
// sees only the scoped names declared by its direct parent.
const validateRegisteredComponentMarkdown = ({
  node,
  diagnostics,
  registry,
  parentDefinition,
  suppressRegisteredComponents = false,
}: {
  readonly node: MarkdownRoot | MarkdownNode;
  readonly diagnostics: DiagnosticCollector;
  readonly registry: ComponentRegistry;
  readonly parentDefinition?: ScopedParentDefinition;
  readonly suppressRegisteredComponents?: boolean;
}): void => {
  const definition =
    parentDefinition ??
    (node.type === "mdxJsxFlowElement"
      ? definitionFor({ name: node.name, registry })
      : undefined);
  for (const child of markdownChildren(node)) {
    const scopedDefinition = scopedDefinitionFor({
      definitions: definition?.scopedChildren,
      name: child.type === "mdxJsxFlowElement" ? child.name : null,
    });
    if (scopedDefinition !== undefined) {
      const policy = scopedDefinition.markdownBody;
      if (policy !== undefined) {
        const nestedScopedNames = new Set(
          Object.keys(scopedDefinition.scopedChildren ?? {}),
        );
        for (const bodyChild of markdownChildren(child)) {
          validateMarkdownBody({
            node: bodyChild,
            policy,
            diagnostics,
            registry,
            nestedScopedNames,
          });
        }
      }
      validateRegisteredComponentMarkdown({
        node: child,
        diagnostics,
        registry,
        parentDefinition: scopedDefinition,
        suppressRegisteredComponents:
          policy?.prohibited.registeredComponent !== undefined,
      });
      continue;
    }
    if (suppressRegisteredComponents) {
      continue;
    }
    validateRegisteredComponentMarkdown({ node: child, diagnostics, registry });
  }
};

/** Applies every component's declarative pre-HAST Markdown policy. */
export const remarkValidateComponents =
  ({
    diagnostics,
    registry = COMPONENT_REGISTRY,
  }: {
    readonly diagnostics: DiagnosticCollector;
    readonly registry?: ComponentRegistry;
  }) =>
  (tree: MarkdownRoot): void => {
    validateRegisteredComponentMarkdown({ node: tree, diagnostics, registry });
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

type ParentNode = Root | Element | MdxJsxFlowElement;

const collectExistingIds = (
  node: ParentNode,
  ids: Array<string> = [],
): ReadonlyArray<string> => {
  for (const child of node.children) {
    if (child.type === "element") {
      const id = child.properties.id;
      if (typeof id === "string") {
        ids.push(id);
      }
    }
    if (child.type === "element" || child.type === "mdxJsxFlowElement") {
      collectExistingIds(child, ids);
    }
  }
  return ids;
};

// Restores the property conventions the authored HAST uses after an HTML
// round trip, so later transforms treat React-rendered fragments exactly
// like vanilla ones. Two parser artifacts are involved: `hidden` on SVG
// elements round-trips as the string "" (spec-identical to the boolean the
// vanilla HAST carries, but serialized differently), and data-* attributes
// come back as camelCase dataset keys where authored HAST and the transforms
// that inspect it use the dashed form.
export const normalizeReparsedProperties = (
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

// Reports an unknown name, validates attributes, recursively prepares direct
// scoped children, then dispatches a registered global component.
const renderFlowElement = ({
  node,
  diagnostics,
  registry,
  ids,
  models,
}: {
  readonly node: MdxJsxFlowElement;
  readonly diagnostics: DiagnosticCollector;
  readonly registry: ComponentRegistry;
  readonly ids: ComponentIdAllocator;
  readonly models?: ModelCollector;
}): Element | undefined => {
  const name = node.name;
  const definition = definitionFor({ name, registry });
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
    registry,
    ids,
    ...(models === undefined ? {} : { models }),
  });
  if (definition === undefined) {
    return undefined;
  }
  if (
    models !== undefined &&
    definition.compile !== undefined &&
    name !== null
  ) {
    models.collected.push({
      component: name,
      ...(node.position === undefined
        ? {}
        : {
            line: node.position.start.line,
            column: node.position.start.column,
          }),
      model: definition.compile({
        attributes,
        children: node.children,
        scopedChildren,
        position: node.position,
        diagnostics: models.diagnostics,
        ids: models.ids,
      }),
    });
  }
  const rendered = definition.renderStatic({
    attributes,
    children: node.children,
    scopedChildren,
    position: node.position,
    diagnostics,
    ids,
  });
  // Reparsing routes the React output through the same final serializer as
  // everything else, so escaping and formatting can never diverge by path.
  const fragment = fromHtml(rendered, { fragment: true });
  normalizeReparsedProperties(fragment.children);
  const first = fragment.children.find(
    (child): child is Element => child.type === "element",
  );
  if (first !== undefined) {
    return first;
  }
  diagnostics.add({
    message: `Internal error: static renderer for "${name ?? "<fragment>"}" produced no element`,
    position: node.position,
  });
  return undefined;
};

/** Rewrites MDX children and returns direct scoped children in authored order. */
const renderChildren = ({
  parent,
  scopedDefinitions,
  diagnostics,
  registry,
  ids,
  models,
}: {
  readonly parent: ParentNode;
  readonly scopedDefinitions?: ScopedParentDefinition["scopedChildren"];
  readonly diagnostics: DiagnosticCollector;
  readonly registry: ComponentRegistry;
  readonly ids: ComponentIdAllocator;
  readonly models?: ModelCollector;
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
    const scopedDefinition = scopedDefinitionFor({
      definitions: scopedDefinitions,
      name: childName,
    });
    if (
      child.type === "mdxJsxFlowElement" &&
      childName !== null &&
      scopedDefinition !== undefined
    ) {
      const nestedScopedChildren = renderChildren({
        parent: child,
        scopedDefinitions: scopedDefinition.scopedChildren,
        diagnostics,
        registry,
        ids,
        ...(models === undefined ? {} : { models }),
      });
      scopedChildren.push({
        name: childName,
        attributes: normalizeAttributes({ node: child, diagnostics }),
        children: child.children,
        ...(nestedScopedChildren.length === 0
          ? {}
          : { scopedChildren: nestedScopedChildren }),
        position: child.position,
      });
      parent.children.splice(index, 1);
      continue;
    }
    if (child.type === "element") {
      renderChildren({
        parent: child,
        diagnostics,
        registry,
        ids,
        ...(models === undefined ? {} : { models }),
      });
    }
    if (child.type === "mdxJsxFlowElement") {
      const rendered = renderFlowElement({
        node: child,
        diagnostics,
        registry,
        ids,
        ...(models === undefined ? {} : { models }),
      });
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
  ({
    diagnostics,
    registry = COMPONENT_REGISTRY,
    models,
  }: {
    readonly diagnostics: DiagnosticCollector;
    readonly registry?: ComponentRegistry;
    readonly models?: Array<CollectedComponentModel>;
  }) =>
  (tree: Root): void => {
    const reservedIds = collectExistingIds(tree);
    renderChildren({
      parent: tree,
      diagnostics,
      registry,
      ids: createComponentIdAllocator({ reservedIds }),
      ...(models === undefined
        ? {}
        : {
            models: {
              collected: models,
              ids: createComponentIdAllocator({ reservedIds }),
              diagnostics: createDiagnosticCollector(),
            },
          }),
    });
    reportSurvivors({ parent: tree, diagnostics });
  };
