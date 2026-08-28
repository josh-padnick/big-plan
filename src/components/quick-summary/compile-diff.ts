// Derives QuickSummary diffs from the component's declared facets.

import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import {
  compileNamedFieldDiff,
  type NamedFieldDiff,
} from "../_model/component-diff/named-fields.js";
import type { CompiledQuickSummary } from "./compile.js";

export type CompiledQuickSummaryDiff = NamedFieldDiff<CompiledQuickSummary>;
export const compileQuickSummaryDiff = (
  input: ComponentDiffInput<CompiledQuickSummary>,
): CompiledQuickSummaryDiff =>
  compileNamedFieldDiff(
    input,
    ["Why", "What", "How"].map((name) => ({
      name,
      value: (model: CompiledQuickSummary) =>
        model.facets.find((facet) => facet.name === name),
    })),
  );
