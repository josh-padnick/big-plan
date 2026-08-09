// Owns defensive relative-time labels for live review message chrome.

const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const RELATIVE_LIMIT_MS = 60 * 60_000;

/** Formats message activity without leaking invalid epoch arithmetic. */
export const messageTimeLabel = ({
  now,
  createdAt,
  absoluteLabel,
}: {
  readonly now: number;
  readonly createdAt: string;
  readonly absoluteLabel: (at: number) => string;
}): string => {
  const at = Date.parse(createdAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(at) ||
    now <= 0 ||
    at <= 0 ||
    at - now > MAX_FUTURE_SKEW_MS
  ) {
    return "Time unavailable";
  }
  const elapsed = Math.max(0, now - at);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < RELATIVE_LIMIT_MS) {
    return `${Math.max(1, Math.floor(elapsed / 60_000))}m`;
  }
  return absoluteLabel(at);
};
