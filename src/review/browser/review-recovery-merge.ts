// Merges the review state a browser recovered after a reload or a refused write
// against the state the runtime holds, using the base the two last agreed on.
//
// The base is per comment, not per snapshot. A whole-snapshot base can only say
// "these differ", which is not enough to tell an unsynchronized newer edit from
// a superseded older one; a per-comment base answers that question for each
// comment on its own. Where it cannot - both sides changed the same comment -
// this returns a conflict instead of choosing, because either choice silently
// discards work the reviewer did.
//
// A merge carrying conflicts is provisional: it holds the local side so nothing
// the reviewer typed disappears from the screen, and it must not be written to
// the runtime until every conflict has an answer.

import type { ReviewComment } from "../shared/comment.js";

/** One reviewer state, in the shape both the browser and the runtime carry. */
export type ReviewRecoveryState = {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly resolvedCommentIds: ReadonlySet<string>;
};

/** What the two sides last agreed on, recorded per comment. */
export type ReviewRecoveryBase = {
  readonly draftBodies: ReadonlyMap<string, string>;
  readonly resolvedCommentIds: ReadonlySet<string>;
};

/**
 * One comment both sides changed since the base. A `null` body means that side
 * no longer has the comment at all, which is a change like any other edit.
 */
export type ReviewRecoveryConflict =
  | {
      readonly kind: "draft";
      readonly commentId: string;
      readonly localBody: string | null;
      readonly runtimeBody: string | null;
    }
  | {
      readonly kind: "sent";
      readonly commentId: string;
      readonly localBody: string;
      readonly runtimeBody: string;
    };

export type ReviewRecoveryMerge = {
  readonly state: ReviewRecoveryState;
  readonly conflicts: ReadonlyArray<ReviewRecoveryConflict>;
};

/** Records the base a later merge compares against, from an agreed state. */
export const reviewRecoveryBase = (
  state: ReviewRecoveryState,
): ReviewRecoveryBase => ({
  draftBodies: new Map(state.drafts.map((draft) => [draft.id, draft.body])),
  resolvedCommentIds: new Set(state.resolvedCommentIds),
});

export const repliesForSentComments = ({
  replies,
  sent,
}: {
  readonly replies: ReadonlyMap<string, string>;
  readonly sent: ReadonlyArray<ReviewComment>;
}): ReadonlyMap<string, string> => {
  const sentIds = new Set(sent.map((comment) => comment.id));
  return new Map([...replies].filter(([commentId]) => sentIds.has(commentId)));
};

const mergeResolvedCommentIds = ({
  base,
  local,
  runtime,
}: {
  readonly base: ReadonlySet<string>;
  readonly local: ReadonlySet<string>;
  readonly runtime: ReadonlySet<string>;
}): ReadonlySet<string> => {
  // Membership is a single bit, so one side always agrees with the base and
  // the other side's change is the answer. There is no undecidable case.
  const merged = new Set(runtime);
  for (const id of new Set([...base, ...local, ...runtime])) {
    if (local.has(id) === runtime.has(id)) continue;
    if (local.has(id) !== base.has(id)) {
      if (local.has(id)) merged.add(id);
      else merged.delete(id);
    }
  }
  return merged;
};

export const mergeLiveReviewRecovery = ({
  base,
  local,
  runtime,
  sent = [],
  submittedBodies = new Map(),
}: {
  readonly base: ReviewRecoveryBase;
  readonly local: ReviewRecoveryState;
  readonly runtime: ReviewRecoveryState;
  readonly sent?: ReadonlyArray<ReviewComment>;
  readonly submittedBodies?: ReadonlyMap<string, string>;
}): ReviewRecoveryMerge => {
  const localDrafts = new Map(local.drafts.map((draft) => [draft.id, draft]));
  const runtimeDrafts = new Map(
    runtime.drafts.map((draft) => [draft.id, draft]),
  );
  const sentBodies = new Map(sent.map((comment) => [comment.id, comment.body]));
  const drafts: Array<ReviewComment> = [];
  const conflicts: Array<ReviewRecoveryConflict> = [];
  // Runtime order first so the stored order survives, then whatever the
  // browser holds and the runtime has never seen.
  const ids = [
    ...runtime.drafts.map((draft) => draft.id),
    ...local.drafts
      .map((draft) => draft.id)
      .filter((id) => !runtimeDrafts.has(id)),
  ];
  for (const id of ids) {
    const localDraft = localDrafts.get(id);
    const runtimeDraft = runtimeDrafts.get(id);
    const baseBody = base.draftBodies.get(id);
    const sentBody = sentBodies.get(id);
    if (sentBody !== undefined) {
      if (localDraft === undefined) continue;
      const priorBody = submittedBodies.get(id) ?? baseBody ?? sentBody;
      if (localDraft.body === priorBody) continue;
      drafts.push(localDraft);
      conflicts.push({
        kind: "sent",
        commentId: id,
        localBody: localDraft.body,
        runtimeBody: sentBody,
      });
      continue;
    }
    if (localDraft !== undefined && runtimeDraft !== undefined) {
      // Target metadata is runtime-owned and may be canonicalized on first
      // save, so a matching body is the same comment even when the browser's
      // display kind differs from the stored block kind.
      if (localDraft.body === runtimeDraft.body) {
        drafts.push(runtimeDraft);
        continue;
      }
      if (baseBody !== undefined && localDraft.body === baseBody) {
        drafts.push(runtimeDraft);
        continue;
      }
      if (baseBody !== undefined && runtimeDraft.body === baseBody) {
        drafts.push(localDraft);
        continue;
      }
      drafts.push(localDraft);
      conflicts.push({
        kind: "draft",
        commentId: id,
        localBody: localDraft.body,
        runtimeBody: runtimeDraft.body,
      });
      continue;
    }
    if (localDraft !== undefined) {
      // The runtime no longer has it. Only an unchanged local copy proves the
      // browser is looking at a removal it simply has not seen yet.
      if (baseBody === undefined) {
        drafts.push(localDraft);
        continue;
      }
      if (localDraft.body === baseBody) continue;
      drafts.push(localDraft);
      conflicts.push({
        kind: "draft",
        commentId: id,
        localBody: localDraft.body,
        runtimeBody: null,
      });
      continue;
    }
    if (runtimeDraft === undefined) continue;
    if (baseBody === undefined) {
      drafts.push(runtimeDraft);
      continue;
    }
    if (runtimeDraft.body === baseBody) continue;
    conflicts.push({
      kind: "draft",
      commentId: id,
      localBody: null,
      runtimeBody: runtimeDraft.body,
    });
  }
  return {
    state: {
      drafts,
      resolvedCommentIds: mergeResolvedCommentIds({
        base: base.resolvedCommentIds,
        local: local.resolvedCommentIds,
        runtime: runtime.resolvedCommentIds,
      }),
    },
    conflicts,
  };
};

/** Applies one answered conflict, keeping the side the reviewer chose. */
export const resolveReviewRecoveryConflict = ({
  state,
  runtime,
  conflict,
  keep,
  replacementCommentId,
}: {
  readonly state: ReviewRecoveryState;
  readonly runtime: ReviewRecoveryState;
  readonly conflict: ReviewRecoveryConflict;
  readonly keep: "local" | "runtime";
  readonly replacementCommentId?: string;
}): ReviewRecoveryState => {
  if (keep === "local") {
    if (conflict.kind === "sent") {
      if (replacementCommentId === undefined) {
        throw new Error("A sent comment edit needs a new staged comment id");
      }
      const resolvedCommentIds = new Set(state.resolvedCommentIds);
      if (resolvedCommentIds.delete(conflict.commentId)) {
        resolvedCommentIds.add(replacementCommentId);
      }
      return {
        drafts: state.drafts.map((draft) =>
          draft.id === conflict.commentId
            ? { ...draft, id: replacementCommentId }
            : draft,
        ),
        resolvedCommentIds,
      };
    }
    return conflict.localBody === null
      ? {
          drafts: state.drafts.filter(
            (draft) => draft.id !== conflict.commentId,
          ),
          resolvedCommentIds: state.resolvedCommentIds,
        }
      : state;
  }
  const runtimeDraft = runtime.drafts.find(
    (draft) => draft.id === conflict.commentId,
  );
  if (runtimeDraft === undefined) {
    return {
      drafts: state.drafts.filter((draft) => draft.id !== conflict.commentId),
      resolvedCommentIds: state.resolvedCommentIds,
    };
  }
  const replaced = state.drafts.some(
    (draft) => draft.id === conflict.commentId,
  );
  return {
    drafts: replaced
      ? state.drafts.map((draft) =>
          draft.id === conflict.commentId ? runtimeDraft : draft,
        )
      : [...state.drafts, runtimeDraft],
    resolvedCommentIds: state.resolvedCommentIds,
  };
};

export const advanceReviewRecoveryBase = ({
  base,
  runtime,
  conflict,
}: {
  readonly base: ReviewRecoveryBase;
  readonly runtime: ReviewRecoveryState;
  readonly conflict: ReviewRecoveryConflict;
}): ReviewRecoveryBase => {
  const draftBodies = new Map(base.draftBodies);
  const runtimeDraft = runtime.drafts.find(
    (draft) => draft.id === conflict.commentId,
  );
  if (runtimeDraft === undefined) draftBodies.delete(conflict.commentId);
  else draftBodies.set(conflict.commentId, runtimeDraft.body);
  return {
    draftBodies,
    resolvedCommentIds: new Set(runtime.resolvedCommentIds),
  };
};
