// Compiles an authored plan into its validated machine-readable model,
// including document metadata and component models in source order.

import type {
  BlockDescriptor,
  CollectedComponentModel,
  Section,
} from "./markdown/compile-markdown.js";
import { compileMarkdownModel } from "./markdown/compile-markdown.js";

/** One component instance as machine delivery publishes it. */
export type PlanComponent = {
  readonly component: string;
  readonly line?: number;
  readonly column?: number;
  // The address a comment on this component resolves to, so an agent reading
  // the model already holds the anchor a reviewer will point at. Absent when
  // the instance has no address of its own: a component rendered privately
  // inside another component's markup is not a block a reader can point at.
  readonly blockId?: string;
  readonly model: unknown;
};

export type PlanModel = {
  readonly title: string;
  readonly sections: ReadonlyArray<Section>;
  readonly components: ReadonlyArray<PlanComponent>;
};

/**
 * Compiles one plan without serializing HTML. Diagnostics hard-fail exactly
 * as rendering does, so a model is only ever produced for a valid plan.
 */
export const compilePlanModel = ({
  markdown,
  fallbackTitle,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
}): PlanModel => {
  const { sections, title, components, blocks } = compileMarkdownModel({
    markdown,
  });
  return {
    title: title ?? fallbackTitle,
    sections,
    components: planComponents({ components, blocks }),
  };
};

// Collection happens child-first (a component's nested children finish
// rendering before it does), so document order - the compile command's
// contract - is restored by source position. The stable sort leaves entries
// without positions in collection order at the end.
const componentsInDocumentOrder = <
  Component extends { readonly line?: number; readonly column?: number },
>(
  components: ReadonlyArray<Component>,
): ReadonlyArray<Component> =>
  [...components].sort(
    (a, b) =>
      (a.line ?? Number.MAX_SAFE_INTEGER) -
        (b.line ?? Number.MAX_SAFE_INTEGER) ||
      (a.column ?? Number.MAX_SAFE_INTEGER) -
        (b.column ?? Number.MAX_SAFE_INTEGER),
  );

/**
 * Publishes the collected models in document order, each carrying the block
 * address the identity walk minted for it. The delivery-local instance key
 * makes that join exact and then stops here: it names one instance inside one
 * compilation, so nothing outside this function may depend on it.
 */
export const planComponents = ({
  components,
  blocks,
}: {
  readonly components: ReadonlyArray<CollectedComponentModel>;
  readonly blocks: ReadonlyArray<BlockDescriptor>;
}): ReadonlyArray<PlanComponent> => {
  const blockIdByInstance = new Map(
    blocks.flatMap((block) =>
      block.componentInstance === undefined
        ? []
        : [[block.componentInstance, block.id] as const],
    ),
  );
  return componentsInDocumentOrder(components).map(
    ({ component, line, column, instanceKey, model }) => {
      const blockId = blockIdByInstance.get(instanceKey);
      return {
        component,
        ...(line === undefined ? {} : { line }),
        ...(column === undefined ? {} : { column }),
        ...(blockId === undefined ? {} : { blockId }),
        model,
      };
    },
  );
};
