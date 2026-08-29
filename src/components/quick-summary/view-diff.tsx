// Presents changed QuickSummary facets through the shared diff view.

import { NamedFieldDiffView } from "../_shared/component-diff/named-field-diff-view.js";
import type { CompiledQuickSummary } from "./compile.js";
import type { CompiledQuickSummaryDiff } from "./compile-diff.js";
import { QuickSummary } from "./view.js";

const project = (
  model: CompiledQuickSummary,
  fields: ReadonlySet<string>,
): CompiledQuickSummary => ({
  facets: model.facets.filter((facet) => fields.has(facet.name)),
});
export const QuickSummaryDiffView = ({
  model,
  controlId,
}: {
  readonly model: CompiledQuickSummaryDiff;
  readonly controlId: string;
}) => (
  <NamedFieldDiffView
    model={model}
    controlId={controlId}
    view={QuickSummary}
    project={project}
  />
);
