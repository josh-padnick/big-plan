// Owns the pre-HAST Markdown validation phase for registered components and
// their recursively scoped child-body policies.

import type { Nodes as MarkdownNode, Root as MarkdownRoot } from "mdast";
import type {
  MarkdownBodyNodeKind,
  MarkdownBodyPolicy,
} from "../../../components/_authoring/contract.js";
import type { DiagnosticCollector } from "../../../components/_authoring/diagnostics.js";
import {
  COMPONENT_REGISTRY,
  definitionFor,
  scopedDefinitionFor,
  type ComponentRegistry,
  type ScopedParentDefinition,
} from "./registry.js";

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
