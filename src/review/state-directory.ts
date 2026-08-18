// Owns where Big Plan keeps user-level state that belongs to the machine
// rather than to one plan. Per-plan state lives beside the plan in
// `.big-plan/` and is owned by `store.ts`; this module owns the other kind:
// the guidance acknowledgment marker and the local service's registry.
//
// It lives in the review layer because that is the deepest layer that needs
// it. The CLI's guidance gate reads the same candidates from here rather than
// resolving them again, so `BIG_PLAN_STATE_DIR` means one thing everywhere.

import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Candidate user-level state directories in preference order.
 *
 * `BIG_PLAN_STATE_DIR` pins state to one directory for tests and sandboxed
 * environments. Without it, the home directory is preferred and the system
 * temporary directory is the fallback for sandboxes that block home writes.
 * The environment is read per call so a caller-scoped override takes effect
 * without rebuilding anything that depends on it.
 */
export const candidateStateDirectories = (): ReadonlyArray<string> => {
  const override = process.env["BIG_PLAN_STATE_DIR"];
  if (override !== undefined) {
    return [override];
  }
  return [join(homedir(), ".big-plan"), join(tmpdir(), "big-plan")];
};

/**
 * The one state directory a component that cannot fall back should use.
 *
 * The guidance gate tries every candidate because a missing acknowledgment
 * degrades to a warning. The service cannot degrade: its registry has to be
 * in the same place for the process that writes it and the process that reads
 * it, so it takes the first candidate and reports failure rather than
 * silently relocating.
 */
export const primaryStateDirectory = (): string =>
  candidateStateDirectories()[0] ?? join(homedir(), ".big-plan");
