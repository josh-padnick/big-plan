// Owns the approved-state copy the details popover paints: the quiet date
// label, the exact-time tooltip, and the count-aware leftover-decisions
// sentence. Critical decisions cannot survive a successful approval, so this
// copy never describes an unanswered leftover as anything but non-critical.

/** The primary date row, or a date-free fallback when the timestamp is unusable. */
export const approvedOnLabel = (at: string): string => {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return "Approved";
  const when = new Date(parsed).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Approved ${when}`;
};

/**
 * Exact local date and time for a title tooltip. Absent when the timestamp
 * cannot be parsed, so the UI never invents a clock reading.
 */
export const approvedAtExactLabel = (at: string): string | undefined => {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

/**
 * The leftover-decisions sentence for an already-approved plan. Undefined
 * when nothing remains, so the row is omitted rather than filled with a
 * zero-count reassurance.
 */
export const unansweredNonCriticalCopy = (
  count: number,
): string | undefined => {
  if (count <= 0) return undefined;
  if (count === 1) return "1 non-critical decision was left unanswered.";
  return `${count} non-critical decisions were left unanswered.`;
};

/**
 * The date and time one history row shows. Falls back to the raw stored value
 * when it cannot be parsed, so a row never disappears over a clock reading.
 */
export const approvalHistoryTimeLabel = (at: string): string => {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return at;
  return new Date(parsed).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

/**
 * The plan version an approval pinned, in the same short form the change-set
 * labels use, so one reviewer vocabulary covers both surfaces.
 */
export const pinnedVersionLabel = (pinnedSnapshot: string): string =>
  `Version ${pinnedSnapshot.slice(0, 7)}`;
