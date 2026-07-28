// Compiles an authored plan into its validated machine-readable model,
// including document metadata and component models in source order.

import type {
  CollectedComponentModel,
  Section,
} from "./markdown/compile-markdown.js";
import { compileMarkdownModel } from "./markdown/compile-markdown.js";

export type PlanModel = {
  readonly title: string;
  readonly sections: ReadonlyArray<Section>;
  readonly components: ReadonlyArray<CollectedComponentModel>;
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
  const { sections, title, components } = compileMarkdownModel({ markdown });
  return {
    title: title ?? fallbackTitle,
    sections,
    components: sortedBySourcePosition(components),
  };
};

// Collection happens child-first (a component's nested children finish
// rendering before it does), so document order - the compile command's
// contract - is restored by source position. The stable sort leaves entries
// without positions in collection order at the end.
const sortedBySourcePosition = (
  components: ReadonlyArray<CollectedComponentModel>,
): ReadonlyArray<CollectedComponentModel> =>
  [...components].sort(
    (a, b) =>
      (a.line ?? Number.MAX_SAFE_INTEGER) -
        (b.line ?? Number.MAX_SAFE_INTEGER) ||
      (a.column ?? Number.MAX_SAFE_INTEGER) -
        (b.column ?? Number.MAX_SAFE_INTEGER),
  );
