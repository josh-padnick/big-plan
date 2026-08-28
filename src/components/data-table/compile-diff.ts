import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import {
  compileNamedFieldDiff,
  type NamedFieldDiff,
} from "../_model/component-diff/named-fields.js";
import type { CompiledDataTable } from "./compile.js";

export type CompiledDataTableDiff = NamedFieldDiff<CompiledDataTable>;

export const compileDataTableDiff = (
  input: ComponentDiffInput<CompiledDataTable>,
): CompiledDataTableDiff => {
  const sample = input.status === "removed" ? input.baseline : input.proposed;
  const rowCount =
    input.status === "changed"
      ? Math.max(input.baseline.rows.length, input.proposed.rows.length)
      : sample.rows.length;
  return compileNamedFieldDiff(input, [
    ...Array.from({ length: rowCount }, (_, index) => ({
      name: `Row: ${sample.rows[index]?.cells[0]?.text || String(index + 1)}`,
      value: (model: CompiledDataTable) => model.rows[index],
    })),
    ...(sample.summaryRow === undefined
      ? []
      : [
          {
            name: "Summary row",
            value: (model: CompiledDataTable) => model.summaryRow,
          },
        ]),
  ]);
};
