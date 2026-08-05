// Proves browser review workflow transitions without a DOM or filesystem.

import { describe, expect, it } from "vitest";
import {
  createInitialReviewState,
  createReviewStateStore,
  reduceReviewState,
} from "./browser-state.js";

const entity = ({
  id,
  body,
}: {
  readonly id: string;
  readonly body: string;
}) => ({ id, body });

describe("browser review state", () => {
  it("should adopt runtime drafts without losing distinct offline drafts", () => {
    const offline = reduceReviewState({
      state: createInitialReviewState(),
      action: {
        type: "offlineDraftsLoaded",
        drafts: [entity({ id: "offline", body: "Offline" })],
        activeDraft: "Unsent plan chat",
        composeDrafts: { selection: "Selection note" },
        threadReplies: {},
        planChatMessages: [],
      },
    });

    const adopted = reduceReviewState({
      state: offline,
      action: {
        type: "runtimeAdoptedDrafts",
        drafts: [entity({ id: "durable", body: "Durable" })],
        sent: [],
        activeDraft: "",
        resolvedCommentIds: [],
        sourceRevision: "revision-a",
        reviewerRevision: 4,
        agent: offline.agent,
      },
    });

    expect(adopted.drafts).toEqual([
      entity({ id: "durable", body: "Durable" }),
      entity({ id: "offline", body: "Offline" }),
    ]);
    expect(adopted.activeDraft).toBe("Unsent plan chat");
    expect(adopted.reviewerRevision).toBe(4);
  });

  it("should create edit and remove drafts immutably", () => {
    const initial = createInitialReviewState();
    const created = reduceReviewState({
      state: initial,
      action: {
        type: "draftCreated",
        draft: entity({ id: "draft", body: "First" }),
      },
    });
    const edited = reduceReviewState({
      state: created,
      action: {
        type: "draftEdited",
        draft: entity({ id: "draft", body: "Second" }),
      },
    });
    const removed = reduceReviewState({
      state: edited,
      action: { type: "draftRemoved", id: "draft" },
    });

    expect(initial.drafts).toEqual([]);
    expect(created.drafts).toEqual([entity({ id: "draft", body: "First" })]);
    expect(edited.drafts).toEqual([entity({ id: "draft", body: "Second" })]);
    expect(removed.drafts).toEqual([]);
  });

  it("should own submission success and failure transitions", () => {
    const draft = entity({ id: "draft", body: "Send me" });
    const started = reduceReviewState({
      state: { ...createInitialReviewState(), drafts: [draft] },
      action: { type: "feedbackSubmissionStarted", ids: ["draft"] },
    });
    const failed = reduceReviewState({
      state: started,
      action: {
        type: "feedbackSubmissionFailed",
        ids: ["draft"],
        message: "Still staged",
      },
    });
    const accepted = reduceReviewState({
      state: started,
      action: {
        type: "feedbackSubmissionAccepted",
        submittedIds: ["draft"],
        sent: [draft],
        requests: [entity({ id: "request", body: "Request" })],
        reviewerRevision: 5,
        agentConnected: true,
      },
    });

    expect(started.submittingIds).toEqual(["draft"]);
    expect(failed.submittingIds).toEqual([]);
    expect(failed.submitErrors).toEqual({ draft: "Still staged" });
    expect(accepted.drafts).toEqual([]);
    expect(accepted.sent).toEqual([draft]);
    expect(accepted.agent.requests).toHaveLength(1);
    expect(accepted.reviewerRevision).toBe(5);
  });

  it("should preserve local conflict text and expose its error", () => {
    const local = entity({ id: "draft", body: "Local body" });
    const conflicted = reduceReviewState({
      state: { ...createInitialReviewState(), drafts: [local] },
      action: {
        type: "durableSaveConflicted",
        drafts: [local],
        reviewerRevision: 7,
        errors: { draft: "Review this conflict" },
      },
    });

    expect(conflicted.drafts).toEqual([local]);
    expect(conflicted.submitErrors).toEqual({
      draft: "Review this conflict",
    });
    expect(conflicted.reviewerRevision).toBe(7);
  });

  it("should replace exchange progress and resolution state by event", () => {
    const initial = createInitialReviewState();
    const exchanged = reduceReviewState({
      state: initial,
      action: {
        type: "agentExchangeUpdated",
        agent: {
          ...initial.agent,
          connected: true,
          requests: [entity({ id: "request", body: "Request" })],
        },
      },
    });
    const progressed = reduceReviewState({
      state: exchanged,
      action: {
        type: "progressEventsObserved",
        events: [entity({ id: "event", body: "Working" })],
      },
    });
    const resolved = reduceReviewState({
      state: progressed,
      action: { type: "threadResolved", id: "comment" },
    });
    const reopened = reduceReviewState({
      state: resolved,
      action: { type: "threadReopened", id: "comment" },
    });

    expect(progressed.agent.connected).toBe(true);
    expect(progressed.progressEvents).toHaveLength(1);
    expect(resolved.resolvedCommentIds).toEqual(["comment"]);
    expect(reopened.resolvedCommentIds).toEqual([]);
  });

  it("should notify subscribers once per dispatch and allow unsubscribe", () => {
    const store = createReviewStateStore(createInitialReviewState());
    let observations = 0;
    const unsubscribe = store.subscribe(() => {
      observations += 1;
    });

    store.dispatch({ type: "activeDraftChanged", body: "First" });
    unsubscribe();
    store.dispatch({ type: "activeDraftChanged", body: "Second" });

    expect(observations).toBe(1);
    expect(store.getState().activeDraft).toBe("Second");
  });
});
