// Owns how one review's idle lifetime is spoken. The runtime's stop reason and
// review command help share this phrasing instead of formatting it independently.

/**
 * Names an idle lifetime the way a reader should hear it. Whole minutes read
 * as minutes; anything else reads as seconds, because "0.5 minutes" is not a
 * duration anyone says out loud.
 */
export const reviewIdleDurationLabel = (idleTimeoutMs: number): string => {
  const minutes = idleTimeoutMs / 60_000;
  if (Number.isInteger(minutes)) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const seconds = Math.round(idleTimeoutMs / 1_000);
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
};
