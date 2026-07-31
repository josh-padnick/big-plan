// Owns a rendered document's persistence identity: the id that namespaces
// every piece of viewer state a reader accumulates (comment drafts today,
// collapse and table settings next) so two plans can never share a namespace.
//
// The id is derived from the plan's resolved path alone. Path already makes it
// unique on one machine, and leaving content out is deliberate: a
// content-sensitive id would change on every edit, so a reviewer's unsent
// drafts would be orphaned by the very re-render their feedback produced.
// A document with no id stamped gets no persistence at all - the viewer skips
// storage rather than falling back to a title two plans can share.

import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Long enough that collisions are not a practical concern, short enough to
// read in a storage key or a directory name.
const PLAN_ID_LENGTH = 16;

/**
 * Derives the stable persistence id for one plan from where it lives on disk.
 * Pure: the path is hashed, never read.
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
