// Owns the post-MDX delivery phase: attribute normalization, scoped child
// collection, compile-once dispatch, rendering and model collection, and MDX
// removal.

import type { Element, Root, RootContent } from "hast";
import type {
  ComponentAttributeValue,
  ScopedChild,
} from "../../../components/_authoring/contract.js";
import {
  createComponentIdAllocator,
  type ComponentIdAllocator,
} from "../../../components/_authoring/contract.js";
import type { DiagnosticCollector } from "../../../components/_authoring/diagnostics.js";
import {
  deferredMarkdownPlaceholder,
  MARKDOWN_EXPORT_INDEX_ATTRIBUTE,
  type ComponentMarkdownContext,
} from "../../../components/_model/markdown-export.js";
import {
  COMPONENT_REGISTRY,
  definitionFor,
  scopedDefinitionFor,
  type ComponentRegistry,
  type ScopedParentDefinition,
} from "../../../components/_registration/registry.js";
import {
  COMPONENT_INSTANCE_ATTRIBUTE,
  createComponentInstanceKeys,
} from "./component-instance.js";
import { COMPONENT_NAME_ATTRIBUTE } from "./component-name.js";
import {
  createOutlinePlaceholder,
  OUTLINE_PLACEHOLDER_ATTRIBUTE,
} from "./outline-placeholder.js";
import type { DeferredOutlinePresentations } from "./outline-placeholder.js";
import { reactToHast } from "./react-hast-adapter.js";
import type { ReactHastAdapter } from "./react-hast-adapter.js";

type MdxJsxFlowElement = Extract<
  RootContent,
  { readonly type: "mdxJsxFlowElement" }
>;

/** One collected component instance: its name, position, and plan model. */
export type CollectedComponentModel = {
  readonly component: string;
  readonly line?: number;
  readonly column?: number;
  // The delivery-local key this instance's rendered root carries, so a
  // document-wide pass holding that root can name the model behind it. It is
  // internal to one compilation and never reaches machine output.
  readonly instanceKey: string;
  readonly model: unknown;
};

/**
 * Every component instance one delivery compiled, keyed by its instance key
 * and held in collection order.
 */
export type CollectedComponentModels = Map<string, CollectedComponentModel>;

type ComponentDelivery =
  | {
      readonly kind: "validation";
    }
  | {
      readonly kind: "render";
      readonly adapt: ReactHastAdapter;
      readonly instanceKeys: () => string;
      readonly collected?: CollectedComponentModels;
      readonly deferOutline?: DeferredOutlinePresentations;
      // Whether a component's model must carry its nested components'
      // presentation instead of the placeholder a deferred outline leaves
      // behind. Machine delivery needs the presentation, because nothing
      // downstream completes a placeholder that only a model holds.
      readonly materializeNestedModels: boolean;
    }
  | {
      readonly kind: "markdown";
      readonly instanceKeys: () => string;
      readonly collected: CollectedComponentModels;
      readonly deferOutline: DeferredMarkdownPresentations;
    };

/**
 * Component Markdown callbacks deferred until the document knows both its
 * outline and how deep each component's headings belong.
 */
export type DeferredMarkdownPresentations = Array<
  {
    readonly model: unknown;
    readonly present: (context: ComponentMarkdownContext) => string;
  }
>;

const nestedMarkdownPlaceholders = ({
  model,
  presentations,
}: {
  readonly model: unknown;
  readonly presentations: DeferredMarkdownPresentations;
}): ReadonlyArray<Element> => {
  const placeholders: Array<Element> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (
      record.type === "element" &&
      ((record.properties as Record<string, unknown> | undefined)?.[
        MARKDOWN_EXPORT_INDEX_ATTRIBUTE
      ] !== undefined ||
        (record.properties as Record<string, unknown> | undefined)?.[
          OUTLINE_PLACEHOLDER_ATTRIBUTE
        ] !== undefined)
    ) {
      const placeholder = structuredClone(value as Element);
      const properties = record.properties as Record<string, unknown>;
      const index = Number(
        properties[OUTLINE_PLACEHOLDER_ATTRIBUTE] ??
          properties[MARKDOWN_EXPORT_INDEX_ATTRIBUTE],
      );
      const deferred = presentations[index];
      if (deferred !== undefined) {
        placeholder.children.push(
          ...nestedMarkdownPlaceholders({
            model: deferred.model,
            presentations,
          }),
        );
      }
      placeholders.push(placeholder);
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(model);
  return placeholders;
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

// Reports an unknown name, validates attributes, recursively prepares direct
// scoped children, compiles once, then collects that model and renders it -
// unless the delivery only validates, which stops at compilation.
const renderFlowElement = ({
  node,
  diagnostics,
  registry,
  ids,
  delivery,
  insideComponentBody,
  renderArtifacts,
}: {
  readonly node: MdxJsxFlowElement;
  readonly diagnostics: DiagnosticCollector;
  readonly registry: ComponentRegistry;
  readonly ids: ComponentIdAllocator;
  readonly delivery: ComponentDelivery;
  // Whether this element is being rendered into another component's body
  // rather than into the document. See the instance key and the materialized
  // model below.
  readonly insideComponentBody: boolean;
  readonly renderArtifacts?: ReadonlyMap<string, unknown>;
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
    delivery,
    insideComponentBody: true,
    ...(renderArtifacts === undefined ? {} : { renderArtifacts }),
  });
  if (definition === undefined) {
    return undefined;
  }
  const compiled = definition.compile({
    attributes,
    children: node.children,
    scopedChildren,
    position: node.position,
    diagnostics,
    ids,
    ...(delivery.kind === "validation" || delivery.kind === "markdown"
      ? { validationOnly: true }
      : {}),
    renderArtifacts,
  });
  if (delivery.kind === "validation") {
    return undefined;
  }
  // The key is minted before the root exists, so it can ride whichever element
  // ends up standing for this instance: its presentation, or the placeholder an
  // outline-aware component leaves until the outline is known.
  const instanceKey = name === null ? undefined : delivery.instanceKeys();
  if (name !== null && instanceKey !== undefined) {
    delivery.collected?.set(instanceKey, {
      component: name,
      ...(node.position === undefined
        ? {}
        : {
            line: node.position.start.line,
            column: node.position.start.column,
          }),
      instanceKey,
      model: compiled.model,
    });
  }
  // Only a root the document will hold carries the key. A root rendered into
  // another component's body is that component's private markup: block
  // identity never stamps it, so it needs no key - and it would never lose
  // one, because the parent's model holds this very element while the document
  // holds the copy the parent's own rendering reparsed, and only that copy
  // passes under the strip.
  const stampedKey = insideComponentBody ? undefined : instanceKey;
  // The authored component name and that key ride on the rendered root so
  // later document-wide passes can name what a reader is pointing at, and
  // reach the model behind it, without knowing any component's markup.
  const named = (element: Element | undefined): Element | undefined => {
    if (element !== undefined && name !== null) {
      element.properties[COMPONENT_NAME_ATTRIBUTE] = name;
    }
    if (element !== undefined && stampedKey !== undefined) {
      element.properties[COMPONENT_INSTANCE_ATTRIBUTE] = stampedKey;
    }
    return element;
  };
  // A model carrying authored HAST must retain a nested component's
  // presentation inside its parent body, which is a property of where this
  // element is being rendered rather than a second thing to thread.
  const materializeModel =
    insideComponentBody &&
    (delivery.kind === "markdown" ||
      (delivery.kind === "render" && delivery.materializeNestedModels));
  // Every Markdown component defers, not only the outline-aware ones: heading
  // depth and outline are properties of where the finished document puts it.
  // Nested models retain their placeholders so the completion pass can apply
  // that same eventual context before their parent serializes its body.
  if (delivery.kind === "markdown") {
    delivery.deferOutline.push({
      model: compiled.model,
      present: compiled.markdown,
    });
    const index = delivery.deferOutline.length - 1;
    if (materializeModel) {
      return deferredMarkdownPlaceholder({
        index,
        ...(node.position === undefined ? {} : { position: node.position }),
      });
    }
    const placeholder =
      compiled.outline === undefined
        ? deferredMarkdownPlaceholder({
            index,
            ...(node.position === undefined ? {} : { position: node.position }),
          })
        : createOutlinePlaceholder({
            index,
            marker: compiled.outline.marker,
            ...(node.position === undefined ? {} : { position: node.position }),
            ...(name === null ? {} : { component: name }),
            ...(stampedKey === undefined ? {} : { instanceKey: stampedKey }),
          });
    placeholder.children.push(
      ...nestedMarkdownPlaceholders({
        model: compiled.model,
        presentations: delivery.deferOutline,
      }),
    );
    return placeholder;
  }
  // An outline-aware component defers its presentation behind a placeholder
  // until the deck transform has computed the document outline. A model being
  // materialized inside a parent's body never reaches the document tree, so
  // it presents against the empty outline instead of leaking a placeholder.
  if (
    compiled.outline !== undefined &&
    delivery.deferOutline !== undefined &&
    !materializeModel
  ) {
    delivery.deferOutline.push(compiled.outline.present);
    return createOutlinePlaceholder({
      index: delivery.deferOutline.length - 1,
      marker: compiled.outline.marker,
      ...(node.position === undefined ? {} : { position: node.position }),
      ...(name === null ? {} : { component: name }),
      ...(stampedKey === undefined ? {} : { instanceKey: stampedKey }),
    });
  }
  const rendered = named(delivery.adapt(compiled.presentation()));
  if (rendered !== undefined) {
    return rendered;
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
  delivery,
  insideComponentBody = false,
  renderArtifacts,
}: {
  readonly parent: ParentNode;
  readonly scopedDefinitions?: ScopedParentDefinition["scopedChildren"];
  readonly diagnostics: DiagnosticCollector;
  readonly registry: ComponentRegistry;
  readonly ids: ComponentIdAllocator;
  readonly delivery: ComponentDelivery;
  readonly insideComponentBody?: boolean;
  readonly renderArtifacts?: ReadonlyMap<string, unknown>;
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
        delivery,
        insideComponentBody,
        ...(renderArtifacts === undefined ? {} : { renderArtifacts }),
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
        delivery,
        insideComponentBody,
        ...(renderArtifacts === undefined ? {} : { renderArtifacts }),
      });
    }
    if (child.type === "mdxJsxFlowElement") {
      const rendered = renderFlowElement({
        node: child,
        diagnostics,
        registry,
        ids,
        delivery,
        insideComponentBody,
        ...(renderArtifacts === undefined ? {} : { renderArtifacts }),
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
    collectModels,
    materializeNestedModels = false,
    deferOutline,
    adapt = reactToHast,
    renderArtifacts,
  }: {
    readonly diagnostics: DiagnosticCollector;
    readonly registry?: ComponentRegistry;
    readonly collectModels?: CollectedComponentModels;
    readonly materializeNestedModels?: boolean;
    readonly deferOutline?: DeferredOutlinePresentations;
    readonly adapt?: ReactHastAdapter;
    readonly renderArtifacts?: ReadonlyMap<string, unknown>;
  }) =>
  (tree: Root): void => {
    const reservedIds = collectExistingIds(tree);
    renderChildren({
      parent: tree,
      diagnostics,
      registry,
      ids: createComponentIdAllocator({ reservedIds }),
      ...(renderArtifacts === undefined ? {} : { renderArtifacts }),
      delivery: {
        kind: "render",
        adapt,
        instanceKeys: createComponentInstanceKeys(),
        materializeNestedModels,
        ...(collectModels === undefined ? {} : { collected: collectModels }),
        ...(deferOutline === undefined ? {} : { deferOutline }),
      },
    });
    reportSurvivors({ parent: tree, diagnostics });
  };

/** Creates the delivery transform whose component roots are semantic Markdown. */
export const rehypeRenderComponentsAsMarkdown =
  ({
    diagnostics,
    registry = COMPONENT_REGISTRY,
    collectModels,
    deferOutline,
  }: {
    readonly diagnostics: DiagnosticCollector;
    readonly registry?: ComponentRegistry;
    readonly collectModels: CollectedComponentModels;
    readonly deferOutline: DeferredMarkdownPresentations;
  }) =>
  (tree: Root): void => {
    const reservedIds = collectExistingIds(tree);
    renderChildren({
      parent: tree,
      diagnostics,
      registry,
      ids: createComponentIdAllocator({ reservedIds }),
      delivery: {
        kind: "markdown",
        instanceKeys: createComponentInstanceKeys(),
        collected: collectModels,
        deferOutline,
      },
    });
    reportSurvivors({ parent: tree, diagnostics });
  };

export const rehypeValidateComponentSemantics =
  ({
    diagnostics,
    registry = COMPONENT_REGISTRY,
  }: {
    readonly diagnostics: DiagnosticCollector;
    readonly registry?: ComponentRegistry;
  }) =>
  (tree: Root): void => {
    const reservedIds = collectExistingIds(tree);
    renderChildren({
      parent: tree,
      diagnostics,
      registry,
      ids: createComponentIdAllocator({ reservedIds }),
      delivery: { kind: "validation" },
    });
    reportSurvivors({ parent: tree, diagnostics });
  };
