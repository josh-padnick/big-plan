// The version a reviewer's own state carries on the wire. It exists so a drafts
// write can be conditional: the browser sends back the version it read, and the
// runtime refuses the write when the store has moved on since then.
//
// The version is derived from the stored content rather than counted, so no new
// stored state is needed and two runtimes holding the same content agree.

import { createHash } from "node:crypto";
import type { ReviewComment } from "./shared/comment.js";

/** Derives the conditional-write version of one reviewer state. */
export const reviewStateVersion = ({
  drafts,
  resolvedCommentIds,
}: {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly resolvedCommentIds: ReadonlyArray<string>;
}): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        drafts,
        resolvedCommentIds: [...resolvedCommentIds].sort(),
      }),
    )
    .digest("hex")
    .slice(0, 16);
