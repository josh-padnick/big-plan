// Collapses whitespace and case so two records of the same authored text
// compare equal. Snapshot alignment on the server and lens anchor
// verification in the browser must agree on what counts as "the same text",
// so the one normalization lives here where both sides can import it.

/** Normalizes text for identity comparison across snapshots and renderings. */
export const normalizedText = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLowerCase();
