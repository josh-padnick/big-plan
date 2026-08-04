// Owns defensive time labels for live review chrome. Store sentinels and
// malformed timestamps stop here so UI renderers never perform epoch-zero or
// non-finite relative-time arithmetic.

const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const RELATIVE_SIGNAL_LIMIT_MS = 60 * 60_000;

const elapsedFrom = ({
  now,
  at,
}: {
  readonly now: number;
  readonly at: number;
}): number | null => {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(at) ||
    now <= 0 ||
    at <= 0 ||
    at - now > MAX_FUTURE_SKEW_MS
  ) {
    return null;
  }
  return Math.max(0, now - at);
};

/** Formats a live signal without ever exposing sentinel-derived huge ages. */
export const relativeSignalLabel = ({
  now,
  at,
}: {
  readonly now: number;
  readonly at: number;
}): string => {
  const elapsed = elapsedFrom({ now, at });
  if (elapsed === null) return "signal unavailable";
  if (elapsed >= RELATIVE_SIGNAL_LIMIT_MS) return "over an hour ago";
  const seconds = Math.round(elapsed / 1_000);
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
};

/** Formats comment activity while rejecting invalid or implausible epochs. */
export const commentTimeLabel = ({
  now,
  at,
  absoluteLabel,
}: {
  readonly now: number;
  readonly at: number;
  readonly absoluteLabel: (at: number) => string;
}): string => {
  const elapsed = elapsedFrom({ now, at });
  if (elapsed === null) return "Time unavailable";
  if (elapsed < 60_000) return "Just now";
  if (elapsed < RELATIVE_SIGNAL_LIMIT_MS) {
    return `${Math.max(1, Math.floor(elapsed / 60_000))}m`;
  }
  return absoluteLabel(at);
};

/** Formats paired event durations only when both endpoints are trustworthy. */
export const compactDurationLabel = ({
  start,
  end,
}: {
  readonly start: number;
  readonly end: number;
}): string | null => {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start <= 0 ||
    end <= 0 ||
    end < start
  ) {
    return null;
  }
  const seconds = Math.floor((end - start) / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
};
