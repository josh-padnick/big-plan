// Owns the post-MDX delivery phase: attribute normalization, scoped child
// collection, compile-once dispatch, model/HTML delivery, and MDX removal.

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
  COMPONENT_REGISTRY,
  definitionFor,
  scopedDefinitionFor,
  type ComponentRegistry,
  type ScopedParentDefinition,
} from "../../../components/_registration/registry.js";
import { createOutlinePlaceholder } from "./outline-placeholder.js";
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
  readonly model: unknown;
};

type ComponentDelivery =
  | {
      readonly kind: "html";
      readonly adapt: ReactHastAdapter;
      readonly collected?: Array<CollectedComponentModel>;
      readonly deferOutline?: DeferredOutlinePresentations;
    }
  | {
      readonly kind: "model";
      readonly collected: Array<CollectedComponentModel>;
      readonly adapt: ReactHastAdapter;
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
// scoped children, compiles once, then chooses model or HTML delivery.
const renderFlowElement = ({
  node,
  diagnostics,
  registry,
  ids,
  delivery,
  materializeModel,
}: {
  readonly node: MdxJsxFlowElement;
  readonly diagnostics: DiagnosticCollector;
  readonly registry: ComponentRegistry;
  readonly ids: ComponentIdAllocator;
  readonly delivery: ComponentDelivery;
  readonly materializeModel: boolean;
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
  const ordinal =
    definition === undefined || name === null
      ? undefined
      : ids.nextOrdinal({ component: name });
  const scopedChildren = renderChildren({
    parent: node,
    scopedDefinitions: definition?.scopedChildren,
    diagnostics,
    registry,
    ids,
    delivery,
    // A model carrying authored HAST must retain a nested component's
    // presentation inside its parent body. Top-level model entries stop
    // before adaptation.
    materializeModels: delivery.kind === "model",
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
    ...(ordinal === undefined ? {} : { ordinal }),
  });
  if (name !== null && delivery.collected !== undefined) {
    delivery.collected.push({
      component: name,
      ...(node.position === undefined
        ? {}
        : {
            line: node.position.start.line,
            column: node.position.start.column,
          }),
      model: compiled.model,
    });
  }
  if (delivery.kind === "model") {
    return materializeModel
      ? delivery.adapt(compiled.presentation())
      : undefined;
  }
  // An outline-aware component defers its presentation behind a placeholder
  // until the deck transform has computed the document outline.
  if (compiled.outline !== undefined && delivery.deferOutline !== undefined) {
    delivery.deferOutline.push(compiled.outline.present);
    return createOutlinePlaceholder({
      index: delivery.deferOutline.length - 1,
      marker: compiled.outline.marker,
    });
  }
  const rendered = delivery.adapt(compiled.presentation());
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
  materializeModels,
}: {
  readonly parent: ParentNode;
  readonly scopedDefinitions?: ScopedParentDefinition["scopedChildren"];
  readonly diagnostics: DiagnosticCollector;
  readonly registry: ComponentRegistry;
  readonly ids: ComponentIdAllocator;
  readonly delivery: ComponentDelivery;
  readonly materializeModels: boolean;
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
        materializeModels,
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
        materializeModels,
      });
    }
    if (child.type === "mdxJsxFlowElement") {
      const rendered = renderFlowElement({
        node: child,
        diagnostics,
        registry,
        ids,
        delivery,
        materializeModel: materializeModels,
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
    collectModels,
    deferOutline,
    adapt = reactToHast,
  }: {
    readonly diagnostics: DiagnosticCollector;
    readonly registry?: ComponentRegistry;
    readonly models?: Array<CollectedComponentModel>;
    readonly collectModels?: Array<CollectedComponentModel>;
    readonly deferOutline?: DeferredOutlinePresentations;
    readonly adapt?: ReactHastAdapter;
  }) =>
  (tree: Root): void => {
    if (models !== undefined && collectModels !== undefined) {
      throw new Error(
        "Component delivery cannot use model-only and HTML model collection together",
      );
    }
    const reservedIds = collectExistingIds(tree);
    renderChildren({
      parent: tree,
      diagnostics,
      registry,
      ids: createComponentIdAllocator({ reservedIds }),
      materializeModels: false,
      delivery:
        models === undefined
          ? {
              kind: "html",
              adapt,
              ...(collectModels === undefined
                ? {}
                : { collected: collectModels }),
              ...(deferOutline === undefined ? {} : { deferOutline }),
            }
          : { kind: "model", collected: models, adapt },
    });
    reportSurvivors({ parent: tree, diagnostics });
  };
