// Owns the deliberately lossy text key used only to align likely counterparts
// between snapshots before exact authored changes are reported.

/** Normalizes text only for candidate alignment across snapshots. */
export const normalizedAlignmentText = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLowerCase();
