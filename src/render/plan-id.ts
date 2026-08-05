// Owns the stable identity that namespaces persisted viewer state for one
// rendered plan. Location distinguishes plans while remaining stable across
// the source revisions a reviewer creates during one review.

import { createHash } from "node:crypto";
import { resolve } from "node:path";

const PLAN_ID_LENGTH = 16;

/**
 * Derives a deterministic persistence id from the resolved source path. The
 * path is hashed rather than exposed in delivered HTML.
 */
export const derivePlanId = ({
  planPath,
}: {
  readonly planPath: string;
}): string =>
  createHash("sha256")
    .update(resolve(planPath))
    .digest("hex")
    .slice(0, PLAN_ID_LENGTH);
