// Owns the stable identity that namespaces persisted viewer state for one
// rendered plan. Both source location and source content participate, so
// unrelated paths and distinct revisions can never inherit each other's
// collapse, table, or draft state.

import { createHash } from "node:crypto";
import { resolve } from "node:path";

const PLAN_ID_LENGTH = 32;

/**
 * Derives a deterministic persistence id from the resolved source path and a
 * hash of the exact authored content. The path is hashed rather than exposed
 * in delivered HTML.
 */
export const derivePlanId = ({
  planPath,
  planContent,
}: {
  readonly planPath: string;
  readonly planContent: string;
}): string => {
  const contentHash = createHash("sha256").update(planContent).digest();
  return createHash("sha256")
    .update(resolve(planPath))
    .update("\0")
    .update(contentHash)
    .digest("hex")
    .slice(0, PLAN_ID_LENGTH);
};
