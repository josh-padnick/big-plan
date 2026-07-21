// Owns the column-to-index participation model behind DatabaseTableSchema's
// numbered INDX references: which indexes use a column as a key entry and
// which only reference it from a partial-index predicate.

import type { TableColumn, TableIndex } from "./parse-table-schema.js";

export type IndexParticipation = {
  readonly position: number;
  readonly kind: "key" | "predicate";
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

// A column participates as a key when it is a plain entry or appears inside
// an expression entry; predicate participation covers partial-index WHERE
// clauses that mention the column without indexing it. Key participation
// wins when both apply, since the reference marks are mutually exclusive.
export const indexParticipation = ({
  column,
  indexes,
}: {
  readonly column: TableColumn;
  readonly indexes: ReadonlyArray<TableIndex>;
}): ReadonlyArray<IndexParticipation> => {
  const namePattern = new RegExp(
    String.raw`\b${escapeRegExp(column.name)}\b`,
    "u",
  );
  const found: Array<IndexParticipation> = [];
  for (const [offset, index] of indexes.entries()) {
    const position = offset + 1;
    const isKey = index.columns.some(
      (entry) =>
        entry.replaceAll("`", "") === column.name || namePattern.test(entry),
    );
    if (isKey) {
      found.push({ position, kind: "key" });
    } else if (index.where !== undefined && namePattern.test(index.where)) {
      found.push({ position, kind: "predicate" });
    }
  }
  return found;
};
