import { describe, expect, it } from "vitest";
import type { ReviewComment } from "../shared/comment.js";
import {
  mergeLiveReviewRecovery,
  resolveReviewRecoveryConflict,
  reviewRecoveryBase,
} from "./review-recovery-merge.js";

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

describe("live review recovery merge", () => {
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
        commentId: "c1",
        localBody: "typed here",
        runtimeBody: "typed elsewhere",
      },
    ]);
    expect(merged.state.drafts.map((draft) => draft.body)).toEqual([
      "typed here",
    ]);
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

  it("should report a conflict when one side edited what the other removed", () => {
    const base = reviewRecoveryBase(state([comment("c1", "agreed")]));

    const merged = mergeLiveReviewRecovery({
      base,
      local: state([comment("c1", "edited while it was deleted")]),
      runtime: state([]),
    });

    expect(merged.conflicts).toEqual([
      {
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
});
