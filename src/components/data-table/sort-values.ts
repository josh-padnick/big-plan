// Owns DataTable value comparison so the browser enhancement and this
// component's focused unit tests share one comparator.

export type DataTableSortValueType = "text" | "number" | "date";
export type DataTableSortDirection = 1 | -1;

/** Compares two complete cell values while keeping empty or invalid data last. */
export const compareDataTableValues = ({
  left,
  right,
  type,
  direction,
}: {
  readonly left: string;
  readonly right: string;
  readonly type: DataTableSortValueType;
  readonly direction: DataTableSortDirection;
}): number => {
  const parseNumber = (value: string): number => {
    const normalized = value.replace(/[^0-9.eE+-]/g, "");
    return normalized === "" ? Number.NaN : Number(normalized);
  };
  const x =
    type === "number"
      ? parseNumber(left)
      : type === "date"
        ? Date.parse(left)
        : left;
  const y =
    type === "number"
      ? parseNumber(right)
      : type === "date"
        ? Date.parse(right)
        : right;
  const xBad = left === "" || (typeof x === "number" && !Number.isFinite(x));
  const yBad = right === "" || (typeof y === "number" && !Number.isFinite(y));
  if (xBad && yBad) return 0;
  if (xBad) return 1;
  if (yBad) return -1;
  const order =
    typeof x === "number" && typeof y === "number"
      ? x === y
        ? 0
        : x < y
          ? -1
          : 1
      : String(x).localeCompare(String(y), undefined, {
          sensitivity: "base",
          numeric: true,
        });
  return order * direction;
};
