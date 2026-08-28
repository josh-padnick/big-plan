import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import {
  compileNamedFieldDiff,
  type NamedFieldDiff,
  sameDiffValue,
  unionNamedFields,
} from "../_model/component-diff/named-fields.js";
import type { CompiledDataTable, CompiledDataTableRow } from "./compile.js";

export type CompiledDataTableDiff = NamedFieldDiff<CompiledDataTable> & {
  readonly baselineRowIndexes: ReadonlyArray<number>;
  readonly proposedRowIndexes: ReadonlyArray<number>;
};

const rowLabel = (row: CompiledDataTableRow): string =>
  row.cells[0]?.text || "Table row";

const alignChangedRows = (
  baseline: ReadonlyArray<CompiledDataTableRow>,
  proposed: ReadonlyArray<CompiledDataTableRow>,
) => {
  const baselineMatched = new Set<number>();
  const proposedMatched = new Set<number>();
  const pairs: Array<readonly [number | undefined, number | undefined]> = [];
  for (
    let proposedIndex = 0;
    proposedIndex < proposed.length;
    proposedIndex += 1
  ) {
    const baselineIndex = baseline.findIndex(
      (row, index) =>
        !baselineMatched.has(index) &&
        rowLabel(row) === rowLabel(proposed[proposedIndex]!),
    );
    if (baselineIndex !== -1) {
      baselineMatched.add(baselineIndex);
      proposedMatched.add(proposedIndex);
      pairs.push([baselineIndex, proposedIndex]);
    }
  }
  const remainingBaseline = baseline
    .map((_, index) => index)
    .filter((index) => !baselineMatched.has(index));
  const remainingProposed = proposed
    .map((_, index) => index)
    .filter((index) => !proposedMatched.has(index));
  const fallbackCount = Math.min(
    remainingBaseline.length,
    remainingProposed.length,
  );
  for (let index = 0; index < fallbackCount; index += 1) {
    pairs.push([remainingBaseline[index], remainingProposed[index]]);
  }
  for (const index of remainingBaseline.slice(fallbackCount)) {
    pairs.push([index, undefined]);
  }
  for (const index of remainingProposed.slice(fallbackCount)) {
    pairs.push([undefined, index]);
  }
  const changed = pairs.filter(([baselineIndex, proposedIndex]) =>
    !sameDiffValue(
      baselineIndex === undefined ? undefined : baseline[baselineIndex],
      proposedIndex === undefined ? undefined : proposed[proposedIndex],
    ),
  );
  return {
    names: changed.map(([baselineIndex, proposedIndex]) =>
      rowLabel(
        proposedIndex === undefined
          ? baseline[baselineIndex!]!
          : proposed[proposedIndex]!,
      ),
    ),
    baselineIndexes: changed.flatMap(([index]) =>
      index === undefined ? [] : [index],
    ),
    proposedIndexes: changed.flatMap(([, index]) =>
      index === undefined ? [] : [index],
    ),
  };
};

export const compileDataTableDiff = (
  input: ComponentDiffInput<CompiledDataTable>,
): CompiledDataTableDiff => {
  const sample = input.status === "removed" ? input.baseline : input.proposed;
  const rows =
    input.status === "changed"
      ? alignChangedRows(input.baseline.rows, input.proposed.rows)
      : {
          names: sample.rows.map(rowLabel),
          baselineIndexes:
            input.status === "removed"
              ? sample.rows.map((_, index) => index)
              : [],
          proposedIndexes:
            input.status === "added"
              ? sample.rows.map((_, index) => index)
              : [],
        };
  const summaryRows =
    input.status === "changed"
      ? [input.baseline.summaryRow, input.proposed.summaryRow]
      : [sample.summaryRow];
  const summary = compileNamedFieldDiff(
    input,
    unionNamedFields(
      summaryRows.flatMap((row) =>
        row === undefined
          ? []
          : [
              {
                name: `Summary: ${row.cells[0]?.text || "Table summary"}`,
                value: (model: CompiledDataTable) => model.summaryRow,
              },
            ],
      ),
    ),
  );
  return {
    ...summary,
    changedFields: [...rows.names, ...new Set(summary.changedFields)],
    baselineRowIndexes: rows.baselineIndexes,
    proposedRowIndexes: rows.proposedIndexes,
  };
};
