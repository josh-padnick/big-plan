// Owns the compact per-thread reopen projection shipped on the agent poll.
// Durable reopen records live on the request; this ships one entry per
// current sent thread so the wire stays bounded.

export type ThreadReopenState = {
  readonly commentId: string;
};

/** Current sent threads that a request reopened by creating new work. */
export const projectThreadReopenStates = ({
  requests,
  currentCommentIds,
}: {
  readonly requests: ReadonlyArray<{
    readonly reopenedCommentIds?: ReadonlyArray<string>;
  }>;
  readonly currentCommentIds: ReadonlySet<string>;
}): ReadonlyArray<ThreadReopenState> => {
  const seen = new Set<string>();
  const states: Array<ThreadReopenState> = [];
  for (const request of requests) {
    for (const commentId of request.reopenedCommentIds ?? []) {
      if (!currentCommentIds.has(commentId) || seen.has(commentId)) continue;
      seen.add(commentId);
      states.push({ commentId });
    }
  }
  return states;
};
