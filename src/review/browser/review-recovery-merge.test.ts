import { describe, expect, it } from "vitest";
import type { ReviewComment } from "../shared/comment.js";
import {
  adoptLiveReviewRecovery,
  mergeLiveReviewRecovery,
  mergeReviewStateAfterHydration,
  refreshReviewRecoveryConflicts,
  repliesForSentComments,
  resolveReviewRecoveryConflict,
  resumeLiveReviewRecovery,
  reviewRecoveryBase,
  reviewRecoveryBaseAfterConflictAnswers,
} from "./review-recovery-merge.js";
import type { LiveReviewRecovery } from "./review-recovery-merge.js";

const comment = (id: string, body: string): ReviewComment => ({
  id,
  body,
  createdAt: "2026-01-01T00:00:00.000Z",
  premiseSnapshot: "snapshot",
  target: { type: "document" },
});

const state = (
  drafts: ReadonlyArray<ReviewComment>,
  resolvedCommentIds: ReadonlyArray<string> = [],
) => ({ drafts, resolvedCommentIds: new Set(resolvedCommentIds) });

const recovery = ({
  base,
  drafts,
}: {
  readonly base: ReturnType<typeof reviewRecoveryBase>;
  readonly drafts: ReadonlyArray<ReviewComment>;
}): LiveReviewRecovery => ({
  ...state(drafts),
  reconciliation: { base, conflicts: [], runtime: null },
});

describe("live review recovery merge", () => {
  it("should keep reviewer state created while hydration is pending", () => {
    const before = state([comment("existing", "before")]);
    const current = state(
      [comment("existing", "edited while loading"), comment("new", "staged")],
      ["existing"],
    );
    const restored = state(
      [comment("existing", "runtime"), comment("restored", "recovered")],
      ["restored"],
    );

    expect(
      mergeReviewStateAfterHydration({ before, current, restored }),
    ).toEqual(
      state(
        [
          comment("existing", "edited while loading"),
          comment("restored", "recovered"),
          comment("new", "staged"),
        ],
        ["existing", "restored"],
      ),
    );
  });

  it("should keep a deletion made while hydration is pending", () => {
    const before = state([comment("deleted", "before")]);

    expect(
      mergeReviewStateAfterHydration({
        before,
        current: state([]),
        restored: state([comment("deleted", "runtime")]),
      }).drafts,
    ).toEqual([]);
  });

  it("should offer an orphaned tab's unsynchronized draft before applying it", () => {
    const agreed = state([comment("c1", "agreed")]);
    const merged = adoptLiveReviewRecovery({
      recovery: recovery({
        base: reviewRecoveryBase(agreed),
        drafts: [comment("c1", "recovered")],
      }),
      runtime: agreed,
    });

    expect(merged.state.drafts).toEqual([comment("c1", "recovered")]);
    expect(merged.conflicts).toEqual([
      {
        kind: "draft",
        commentId: "c1",
        localBody: "recovered",
        runtimeBody: "agreed",
      },
    ]);
  });

  it("should not offer unchanged work adopted from an orphaned tab", () => {
    const agreed = state([comment("c1", "agreed")]);
    const merged = adoptLiveReviewRecovery({
      recovery: recovery({
        base: reviewRecoveryBase(agreed),
        drafts: agreed.drafts,
      }),
      runtime: agreed,
    });

    expect(merged.conflicts).toEqual([]);
  });

  it("should report a conflict when both sides changed the same comment", () => {
    // The case no rule can settle: choosing either side here throws away work
    // the reviewer did, so the merge must hand the choice back.
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));

    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "typed here")]),
      runtime: state([comment("c1", "typed elsewhere")]),
    });

    expect(merged.conflicts).toEqual([
      {
        kind: "draft",
        commentId: "c1",
        localBody: "typed here",
        runtimeBody: "typed elsewhere",
      },
    ]);
    expect(merged.state.drafts.map((draft) => draft.body)).toEqual([
      "typed here",
    ]);
  });

  it("should not mistake an adopted sibling runtime change for a local edit", () => {
    const base = reviewRecoveryBase(
      state([comment("x", "agreed x"), comment("y", "agreed y")]),
    );
    const runtime = state([
      comment("x", "runtime x"),
      comment("y", "runtime y"),
    ]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("x", "agreed x"), comment("y", "local y")]),
      runtime,
    });
    const conflict = merged.conflicts[0];
    if (conflict === undefined) throw new Error("expected one conflict");
    const afterAnswer = resolveReviewRecoveryConflict({
      state: merged.state,
      runtime,
      conflict,
      keep: "local",
    });
    const baseAfterAnswer = reviewRecoveryBaseAfterConflictAnswers({
      base,
      runtime,
      answeredConflicts: [conflict],
      remainingConflicts: [],
    });

    const reconciled = mergeLiveReviewRecovery({
      base: baseAfterAnswer,
      local: afterAnswer,
      runtime: state([
        comment("x", "later runtime x"),
        comment("y", "runtime y"),
      ]),
    });

    expect(reconciled.conflicts).toEqual([]);
    expect(reconciled.state.drafts).toEqual([
      comment("x", "later runtime x"),
      comment("y", "local y"),
    ]);
  });

  it("should carry a conflict while advancing unrelated runtime state", () => {
    const original = state([
      comment("x", "agreed x"),
      comment("y", "agreed y"),
    ]);
    const firstRuntime = state([
      comment("x", "runtime x"),
      comment("y", "runtime y"),
    ]);
    const firstMerge = mergeLiveReviewRecovery({
      base: reviewRecoveryBase(original),
      local: state([comment("x", "agreed x"), comment("y", "local y")]),
      runtime: firstRuntime,
    });
    const resumed = resumeLiveReviewRecovery({
      recovery: {
        ...firstMerge.state,
        reconciliation: {
          base: reviewRecoveryBase(original),
          conflicts: firstMerge.conflicts,
          runtime: firstRuntime,
        },
      },
      runtime: state([
        comment("x", "later runtime x"),
        comment("y", "runtime y"),
      ]),
    });

    expect(resumed.state.drafts).toEqual([
      comment("x", "later runtime x"),
      comment("y", "local y"),
    ]);
    expect(resumed.conflicts).toEqual([
      {
        kind: "draft",
        commentId: "y",
        localBody: "local y",
        runtimeBody: "runtime y",
      },
    ]);
  });

  it("should preserve an answer while another conflict remains", () => {
    const base = reviewRecoveryBase(
      state([comment("x", "agreed x"), comment("y", "agreed y")]),
    );
    const runtime = state([
      comment("x", "runtime x"),
      comment("y", "runtime y"),
    ]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("x", "local x"), comment("y", "local y")]),
      runtime,
    });
    const [answered, remaining] = merged.conflicts;
    if (answered === undefined || remaining === undefined) {
      throw new Error("expected two conflicts");
    }
    const afterAnswer = resolveReviewRecoveryConflict({
      state: merged.state,
      runtime,
      conflict: answered,
      keep: "local",
    });
    const baseAfterAnswer = reviewRecoveryBaseAfterConflictAnswers({
      base,
      runtime,
      answeredConflicts: [answered],
      remainingConflicts: [remaining],
    });

    const recovered = mergeLiveReviewRecovery({
      base: baseAfterAnswer,
      local: afterAnswer,
      runtime,
    });

    expect(recovered.conflicts).toEqual([remaining]);
    expect(recovered.state.drafts).toEqual([
      comment("x", "local x"),
      comment("y", "local y"),
    ]);
  });

  it("should refresh the local conflict body before either answer is applied", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));
    const runtime = state([comment("c1", "typed elsewhere")]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "first local edit")]),
      runtime,
    });
    const refreshed = refreshReviewRecoveryConflicts({
      conflicts: merged.conflicts,
      local: state([comment("c1", "latest local edit")]),
    });
    const conflict = refreshed.conflicts[0];
    if (conflict === undefined || conflict.kind === "resolution") {
      throw new Error("expected one body conflict");
    }

    expect(conflict.localBody).toBe("latest local edit");
    expect(
      resolveReviewRecoveryConflict({
        state: state([comment("c1", "latest local edit")]),
        runtime,
        conflict,
        keep: "local",
      }).drafts,
    ).toEqual([comment("c1", "latest local edit")]);
    expect(
      resolveReviewRecoveryConflict({
        state: state([comment("c1", "latest local edit")]),
        runtime,
        conflict,
        keep: "runtime",
      }).drafts,
    ).toEqual([comment("c1", "typed elsewhere")]);
  });

  it("should settle a conflict when the local edit matches the runtime", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));
    const runtime = state([comment("c1", "typed elsewhere")]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "typed here")]),
      runtime,
    });

    const refreshed = refreshReviewRecoveryConflicts({
      conflicts: merged.conflicts,
      local: runtime,
    });

    expect(refreshed.conflicts).toEqual([]);
    expect(refreshed.settledConflicts).toEqual(merged.conflicts);
  });

  it("should turn a conflicted local edit into a deletion choice", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));
    const runtime = state([comment("c1", "typed elsewhere")]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "typed here")]),
      runtime,
    });
    const refreshed = refreshReviewRecoveryConflicts({
      conflicts: merged.conflicts,
      local: state([]),
    });
    const conflict = refreshed.conflicts[0];
    if (conflict === undefined) throw new Error("expected one conflict");

    expect(conflict).toEqual({
      kind: "draft",
      commentId: "c1",
      localBody: null,
      runtimeBody: "typed elsewhere",
    });
    expect(
      resolveReviewRecoveryConflict({
        state: state([]),
        runtime,
        conflict,
        keep: "local",
      }).drafts,
    ).toEqual([]);
    expect(
      resolveReviewRecoveryConflict({
        state: state([]),
        runtime,
        conflict,
        keep: "runtime",
      }).drafts,
    ).toEqual([comment("c1", "typed elsewhere")]);
  });

  it("should not resurrect a superseded body", () => {
    // Risk 2, directly: the browser holds a body it already replaced in the
    // runtime. Reconciling by minting a new id returned that superseded body
    // as a second comment the reviewer never wrote.
    const base = reviewRecoveryBase(state([comment("c1", "first try")]));

    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "first try")]),
      runtime: state([comment("c1", "the newer edit")]),
    });

    expect(merged.conflicts).toEqual([]);
    expect(merged.state.drafts).toEqual([comment("c1", "the newer edit")]);
  });

  it("should keep a local edit the runtime has not seen", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));

    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "still being typed")]),
      runtime: state([comment("c1", "agreed")]),
    });

    expect(merged.conflicts).toEqual([]);
    expect(merged.state.drafts).toEqual([comment("c1", "still being typed")]);
  });

  it("should leave an unchanged comment alone", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));

    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "agreed")]),
      runtime: state([comment("c1", "agreed")]),
    });

    expect(merged.conflicts).toEqual([]);
    expect(merged.state.drafts).toEqual([comment("c1", "agreed")]);
  });

  it("should keep a draft the runtime has never seen", () => {
    const merged = mergeLiveReviewRecovery({
      base: reviewRecoveryBase(state([])),
      local: state([comment("c1", "written offline")]),
      runtime: state([]),
    });

    expect(merged.conflicts).toEqual([]);
    expect(merged.state.drafts).toEqual([comment("c1", "written offline")]);
  });

  it("should accept a removal the browser has not seen yet", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));

    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "agreed")]),
      runtime: state([]),
    });

    expect(merged.conflicts).toEqual([]);
    expect(merged.state.drafts).toEqual([]);
  });

  it("should not restore an unchanged draft after it was sent", () => {
    const agreed = state([comment("c1", "agreed")]);

    const merged = mergeLiveReviewRecovery({
      base: reviewRecoveryBase(agreed),
      local: agreed,
      runtime: state([]),
      sent: [comment("c1", "agreed")],
    });

    expect(merged.conflicts).toEqual([]);
    expect(merged.state.drafts).toEqual([]);
  });

  it("should treat an identical sent body as agreement after a lost response", () => {
    const merged = mergeLiveReviewRecovery({
      base: reviewRecoveryBase(state([comment("c1", "agreed")])),
      local: state([comment("c1", "accepted body")]),
      runtime: state([]),
      sent: [comment("c1", "accepted body")],
    });

    expect(merged.state.drafts).toEqual([]);
    expect(merged.conflicts).toEqual([]);
  });

  it("should surface a sent transition without minting an id", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));
    const existingIds = new Set(["c1"]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "edited here")]),
      runtime: state([]),
      sent: [comment("c1", "agreed")],
    });

    expect(
      merged.state.drafts.every((draft) => existingIds.has(draft.id)),
    ).toBe(true);
    expect(merged.conflicts).toEqual([
      {
        kind: "sent",
        commentId: "c1",
        localBody: "edited here",
        runtimeBody: "agreed",
      },
    ]);
  });

  it("should surface an edit made while its prior body was sent", () => {
    const merged = mergeLiveReviewRecovery({
      base: reviewRecoveryBase(state([])),
      local: state([comment("c1", "newer edit")]),
      runtime: state([]),
      sent: [comment("c1", "submitted body")],
      submittedBodies: new Map([["c1", "submitted body"]]),
    });

    expect(merged.state.drafts).toEqual([comment("c1", "newer edit")]);
    expect(merged.conflicts).toEqual([
      {
        kind: "sent",
        commentId: "c1",
        localBody: "newer edit",
        runtimeBody: "submitted body",
      },
    ]);
  });

  it("should apply either answer to a sent-transition conflict", () => {
    const runtime = state([]);
    const merged = mergeLiveReviewRecovery({
      base: reviewRecoveryBase(state([comment("c1", "agreed")])),
      local: state([comment("c1", "edited here")]),
      runtime,
      sent: [comment("c1", "agreed")],
    });
    const conflict = merged.conflicts[0];
    if (conflict === undefined) throw new Error("expected one conflict");

    expect(
      resolveReviewRecoveryConflict({
        state: merged.state,
        runtime,
        conflict,
        keep: "runtime",
      }).drafts,
    ).toEqual([]);
    expect(
      resolveReviewRecoveryConflict({
        state: merged.state,
        runtime,
        conflict,
        keep: "local",
        replacementCommentId: "c2",
      }).drafts,
    ).toEqual([comment("c2", "edited here")]);
  });

  it("should keep thread resolution on a staged sent replacement", () => {
    const runtime = state([], ["c1"]);
    const merged = mergeLiveReviewRecovery({
      base: reviewRecoveryBase(state([comment("c1", "agreed")], ["c1"])),
      local: state([comment("c1", "edited here")], ["c1"]),
      runtime,
      sent: [comment("c1", "agreed")],
    });
    const conflict = merged.conflicts[0];
    if (conflict === undefined) throw new Error("expected one conflict");

    const resolved = resolveReviewRecoveryConflict({
      state: merged.state,
      runtime,
      conflict,
      keep: "local",
      replacementCommentId: "c2",
    });

    expect(resolved.drafts).toEqual([comment("c2", "edited here")]);
    expect([...resolved.resolvedCommentIds]).toEqual(["c1"]);
  });

  it("should offer an adopted deletion against authoritative runtime state", () => {
    const agreed = state([comment("c1", "agreed")]);
    const merged = adoptLiveReviewRecovery({
      recovery: recovery({ base: reviewRecoveryBase(agreed), drafts: [] }),
      runtime: agreed,
    });

    expect(merged.state.drafts).toEqual([]);
    expect(merged.conflicts).toEqual([
      {
        kind: "draft",
        commentId: "c1",
        localBody: null,
        runtimeBody: "agreed",
      },
    ]);
  });

  it("should remove reply text when its sent thread is deleted", () => {
    expect(
      repliesForSentComments({
        replies: new Map([
          ["c1", "reply to deleted thread"],
          ["c2", "reply to retained thread"],
        ]),
        sent: [comment("c2", "retained thread")],
      }),
    ).toEqual(new Map([["c2", "reply to retained thread"]]));
  });

  it("should report a conflict when one side edited what the other removed", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));

    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "edited while it was deleted")]),
      runtime: state([]),
    });

    expect(merged.conflicts).toEqual([
      {
        kind: "draft",
        commentId: "c1",
        localBody: "edited while it was deleted",
        runtimeBody: null,
      },
    ]);
    expect(merged.state.drafts).toEqual([
      comment("c1", "edited while it was deleted"),
    ]);
  });

  it("should keep the runtime order and append what only the browser holds", () => {
    const merged = mergeLiveReviewRecovery({
      base: reviewRecoveryBase(state([])),
      local: state([comment("c9", "browser only")]),
      runtime: state([comment("c1", "one"), comment("c2", "two")]),
    });

    expect(merged.state.drafts.map((draft) => draft.id)).toEqual([
      "c1",
      "c2",
      "c9",
    ]);
  });

  it("should apply each side's resolve change without undoing the other's", () => {
    const base = reviewRecoveryBase(state([], ["c1", "c2"]));

    const merged = mergeLiveReviewRecovery({
      base,
      // The browser unresolved c1; the runtime resolved c3.
      local: state([], ["c2"]),
      runtime: state([], ["c1", "c2", "c3"]),
    });

    expect([...merged.state.resolvedCommentIds].sort()).toEqual(["c2", "c3"]);
  });

  it("should take the runtime side when a conflict is answered that way", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));
    const runtime = state([comment("c1", "typed elsewhere")]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "typed here")]),
      runtime,
    });
    const conflict = merged.conflicts[0];
    if (conflict === undefined) throw new Error("expected one conflict");

    expect(
      resolveReviewRecoveryConflict({
        state: merged.state,
        runtime,
        conflict,
        keep: "runtime",
      }).drafts,
    ).toEqual([comment("c1", "typed elsewhere")]);
    expect(
      resolveReviewRecoveryConflict({
        state: merged.state,
        runtime,
        conflict,
        keep: "local",
      }).drafts,
    ).toEqual([comment("c1", "typed here")]);
  });

  it("should drop the comment when a removal conflict is answered the runtime's way", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));
    const runtime = state([]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "edited while it was deleted")]),
      runtime,
    });
    const conflict = merged.conflicts[0];
    if (conflict === undefined) throw new Error("expected one conflict");

    expect(
      resolveReviewRecoveryConflict({
        state: merged.state,
        runtime,
        conflict,
        keep: "runtime",
      }).drafts,
    ).toEqual([]);
  });

  it("should keep the local edit when the runtime removed the comment", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));
    const runtime = state([]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "edited while it was deleted")]),
      runtime,
    });
    const conflict = merged.conflicts[0];
    if (conflict === undefined) throw new Error("expected one conflict");

    expect(
      resolveReviewRecoveryConflict({
        state: merged.state,
        runtime,
        conflict,
        keep: "local",
      }).drafts,
    ).toEqual([comment("c1", "edited while it was deleted")]);
  });

  it("should keep the runtime edit when the browser removed the comment", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));
    const runtime = state([comment("c1", "edited in the review session")]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([]),
      runtime,
    });
    const conflict = merged.conflicts[0];
    if (conflict === undefined) throw new Error("expected one conflict");

    expect(
      resolveReviewRecoveryConflict({
        state: merged.state,
        runtime,
        conflict,
        keep: "runtime",
      }).drafts,
    ).toEqual([comment("c1", "edited in the review session")]);
  });

  it("should keep the local removal when the runtime edited the comment", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));
    const runtime = state([comment("c1", "edited in the review session")]);
    const merged = mergeLiveReviewRecovery({
      base,
      local: state([]),
      runtime,
    });
    const conflict = merged.conflicts[0];
    if (conflict === undefined) throw new Error("expected one conflict");

    expect(merged.state.drafts).toEqual([]);
    expect(
      mergeLiveReviewRecovery({
        base,
        local: merged.state,
        runtime,
      }).conflicts,
    ).toEqual([conflict]);
    expect(
      resolveReviewRecoveryConflict({
        state: merged.state,
        runtime,
        conflict,
        keep: "local",
      }).drafts,
    ).toEqual([]);
  });
});
