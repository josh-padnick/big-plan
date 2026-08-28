import { NamedFieldDiffView } from "../_shared/component-diff/named-field-diff-view.js";
import type { CompiledDataTable } from "./compile.js";
import type { CompiledDataTableDiff } from "./compile-diff.js";
import { DataTable } from "./view.js";

export const DataTableDiffView = ({
  model,
  controlId,
}: {
  readonly model: CompiledDataTableDiff;
  readonly controlId: string;
}) => {
  const project = (value: CompiledDataTable): CompiledDataTable => ({
    ...value,
    rows: value.rows.filter((_, index) =>
      new Set(
        model.status !== "added" && value === model.baseline
          ? model.baselineRowIndexes
          : model.proposedRowIndexes,
      ).has(index),
    ),
    ...(model.changedFields.some((field) => field.startsWith("Summary: "))
      ? {}
      : { summaryRow: undefined }),
  });
  return (
    <NamedFieldDiffView
      model={model}
      controlId={controlId}
      view={DataTable}
      project={project}
    />
  );
};
