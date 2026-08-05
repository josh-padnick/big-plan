// Owns the compact lifecycle vocabulary used by grouped sidebar threads.
// The group tells the shared state once; rows expose only exceptional
// per-thread sub-state so labels cannot double as the card expands.

import type { ThreadStatusStage } from "./thread-status.js";

export type PendingThreadGroup = {
  readonly key: "waiting" | "blocked";
  readonly label: "Waiting" | "Blocked";
};

/** Names the one pending group from the globally observed agent connection. */
export const pendingThreadGroup = (
  agentConnected: boolean,
): PendingThreadGroup =>
  agentConnected
    ? { key: "waiting", label: "Waiting" }
    : { key: "blocked", label: "Blocked" };

export type ThreadSubstate = "working" | "stalled" | null;

/** Keeps only row-level signals that add information beyond the group label. */
export const threadSubstate = (
  stage: ThreadStatusStage | undefined,
): ThreadSubstate =>
  stage === "working" ? "working" : stage === "stalled" ? "stalled" : null;
