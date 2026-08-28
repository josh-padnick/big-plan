import { NamedFieldDiffView } from "../_shared/component-diff/named-field-diff-view.js";
import { sameDiffValue } from "../_model/component-diff/named-fields.js";
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
  const changedIndexes =
    model.status === "changed"
      ? new Set(
          Array.from(
            {
              length: Math.max(
                model.baseline.rows.length,
                model.proposed.rows.length,
              ),
            },
            (_, index) => index,
          ).filter(
            (index) =>
              !sameDiffValue(
                model.baseline.rows[index],
                model.proposed.rows[index],
              ),
          ),
        )
      : new Set<number>();
  const project = (value: CompiledDataTable): CompiledDataTable => ({
    ...value,
    rows: value.rows.filter((_, index) => changedIndexes.has(index)),
    ...(model.changedFields.includes("Summary row")
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
