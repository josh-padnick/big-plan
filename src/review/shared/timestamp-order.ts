// Owns chronological comparison for review records whose timestamps may use
// different ISO spellings.

/** Orders parseable instants chronologically and malformed values lexically. */
export const compareTimestamps = (left: string, right: string): number => {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isNaN(leftMs) || Number.isNaN(rightMs)
    ? left.localeCompare(right)
    : leftMs - rightMs;
};
