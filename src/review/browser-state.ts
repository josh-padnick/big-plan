// Owns browser-side review workflow state and its pure transitions.
// DOM, selection, geometry, observers, timers, and transport remain in the
// authored review script adapter.

export type ReviewStateEntity = Readonly<Record<string, unknown>>;

export type ReviewAgentState = {
  readonly requests: ReadonlyArray<ReviewStateEntity>;
  readonly responses: ReadonlyArray<ReviewStateEntity>;
  readonly cancelledIds: ReadonlyArray<string>;
  readonly connected: boolean;
  readonly heartbeatAt: number;
  readonly connectionLog: ReadonlyArray<ReviewStateEntity>;
  readonly planPath: string;
  readonly command: string;
  readonly recoveryPrompt: string;
};

export type ReviewState = {
  readonly drafts: ReadonlyArray<ReviewStateEntity>;
  readonly sent: ReadonlyArray<ReviewStateEntity>;
  readonly activeDraft: string;
  readonly composeDrafts: Readonly<Record<string, string>>;
  readonly threadReplies: Readonly<
    Record<string, ReadonlyArray<ReviewStateEntity>>
  >;
  readonly planChatMessages: ReadonlyArray<ReviewStateEntity>;
  readonly resolvedCommentIds: ReadonlyArray<string>;
  readonly sourceRevision: string;
  readonly reviewerRevision: number;
  readonly agent: ReviewAgentState;
  readonly progressEvents: ReadonlyArray<ReviewStateEntity>;
  readonly submittingIds: ReadonlyArray<string>;
  readonly submitErrors: Readonly<Record<string, string>>;
};

export type ReviewAction =
  | {
      readonly type: "offlineDraftsLoaded";
      readonly drafts: ReadonlyArray<ReviewStateEntity>;
      readonly activeDraft: string;
      readonly composeDrafts: Readonly<Record<string, string>>;
      readonly threadReplies: Readonly<
        Record<string, ReadonlyArray<ReviewStateEntity>>
      >;
      readonly planChatMessages: ReadonlyArray<ReviewStateEntity>;
    }
  | {
      readonly type: "runtimeAdoptedDrafts";
      readonly drafts: ReadonlyArray<ReviewStateEntity>;
      readonly sent: ReadonlyArray<ReviewStateEntity>;
      readonly activeDraft: string;
      readonly resolvedCommentIds: ReadonlyArray<string>;
      readonly sourceRevision: string;
      readonly reviewerRevision: number;
      readonly agent: ReviewAgentState;
    }
  | {
      readonly type: "draftCreated" | "draftEdited";
      readonly draft: ReviewStateEntity;
    }
  | { readonly type: "draftRemoved"; readonly id: string }
  | {
      readonly type: "draftsReplaced";
      readonly drafts: ReadonlyArray<ReviewStateEntity>;
    }
  | {
      readonly type: "activeDraftChanged";
      readonly body: string;
    }
  | {
      readonly type: "composeDraftChanged";
      readonly key: string;
      readonly body: string;
    }
  | {
      readonly type: "conversationStateReplaced";
      readonly threadReplies: Readonly<
        Record<string, ReadonlyArray<ReviewStateEntity>>
      >;
      readonly planChatMessages: ReadonlyArray<ReviewStateEntity>;
    }
  | {
      readonly type: "feedbackSubmissionStarted";
      readonly ids: ReadonlyArray<string>;
    }
  | {
      readonly type: "feedbackSubmissionAccepted";
      readonly submittedIds: ReadonlyArray<string>;
      readonly sent: ReadonlyArray<ReviewStateEntity>;
      readonly requests: ReadonlyArray<ReviewStateEntity>;
      readonly reviewerRevision: number;
      readonly agentConnected: boolean;
    }
  | {
      readonly type: "feedbackSubmissionFailed";
      readonly ids: ReadonlyArray<string>;
      readonly message: string;
    }
  | {
      readonly type: "durableSnapshotReplaced";
      readonly drafts: ReadonlyArray<ReviewStateEntity>;
      readonly sent: ReadonlyArray<ReviewStateEntity>;
      readonly activeDraft: string;
      readonly resolvedCommentIds: ReadonlyArray<string>;
      readonly reviewerRevision: number;
    }
  | {
      readonly type: "durableSaveConflicted";
      readonly drafts: ReadonlyArray<ReviewStateEntity>;
      readonly reviewerRevision: number;
      readonly errors: Readonly<Record<string, string>>;
    }
  | {
      readonly type: "reviewerRevisionChanged";
      readonly revision: number;
    }
  | {
      readonly type: "agentExchangeUpdated";
      readonly agent: ReviewAgentState;
    }
  | {
      readonly type: "progressEventsObserved";
      readonly events: ReadonlyArray<ReviewStateEntity>;
    }
  | {
      readonly type: "sourceRevisionChanged";
      readonly revision: string;
    }
  | { readonly type: "threadResolved"; readonly id: string }
  | { readonly type: "threadReopened"; readonly id: string }
  | {
      readonly type: "resolutionsReplaced";
      readonly ids: ReadonlyArray<string>;
    };

export type ReviewStateStore = {
  readonly getState: () => ReviewState;
  readonly dispatch: (action: ReviewAction) => void;
  readonly subscribe: (listener: () => void) => () => void;
};

/** Returns the empty workflow state used before offline and runtime adoption. */
export const createInitialReviewState = (): ReviewState => ({
  drafts: [],
  sent: [],
  activeDraft: "",
  composeDrafts: {},
  threadReplies: {},
  planChatMessages: [],
  resolvedCommentIds: [],
  sourceRevision: "",
  reviewerRevision: 0,
  agent: {
    requests: [],
    responses: [],
    cancelledIds: [],
    connected: false,
    heartbeatAt: 0,
    connectionLog: [],
    planPath: "",
    command: "",
    recoveryPrompt: "",
  },
  progressEvents: [],
  submittingIds: [],
  submitErrors: {},
});

const entityId = (entity: ReviewStateEntity): string =>
  typeof entity.id === "string" ? entity.id : "";

const appendUnique = ({
  values,
  value,
}: {
  readonly values: ReadonlyArray<string>;
  readonly value: string;
}): ReadonlyArray<string> =>
  values.includes(value) ? values : values.concat(value);

/** Applies one named workflow event without browser or filesystem effects. */
export const reduceReviewState = ({
  state,
  action,
}: {
  readonly state: ReviewState;
  readonly action: ReviewAction;
}): ReviewState => {
  switch (action.type) {
    case "offlineDraftsLoaded":
      return {
        ...state,
        drafts: action.drafts,
        activeDraft: action.activeDraft,
        composeDrafts: action.composeDrafts,
        threadReplies: action.threadReplies,
        planChatMessages: action.planChatMessages,
      };
    case "runtimeAdoptedDrafts": {
      const durableIds = new Set(action.drafts.map(entityId));
      return {
        ...state,
        drafts: action.drafts.concat(
          state.drafts.filter((draft) => !durableIds.has(entityId(draft))),
        ),
        sent: action.sent,
        activeDraft:
          state.activeDraft === "" ? action.activeDraft : state.activeDraft,
        resolvedCommentIds: action.resolvedCommentIds,
        sourceRevision: action.sourceRevision,
        reviewerRevision: action.reviewerRevision,
        agent: action.agent,
      };
    }
    case "draftCreated":
      return {
        ...state,
        drafts: state.drafts.concat(action.draft),
      };
    case "draftEdited":
      return {
        ...state,
        drafts: state.drafts.map((draft) =>
          entityId(draft) === entityId(action.draft) ? action.draft : draft,
        ),
      };
    case "draftRemoved":
      return {
        ...state,
        drafts: state.drafts.filter((draft) => entityId(draft) !== action.id),
      };
    case "draftsReplaced":
      return { ...state, drafts: action.drafts };
    case "activeDraftChanged":
      return { ...state, activeDraft: action.body };
    case "composeDraftChanged": {
      const composeDrafts = { ...state.composeDrafts };
      if (action.body === "") delete composeDrafts[action.key];
      else composeDrafts[action.key] = action.body;
      return { ...state, composeDrafts };
    }
    case "conversationStateReplaced":
      return {
        ...state,
        threadReplies: action.threadReplies,
        planChatMessages: action.planChatMessages,
      };
    case "feedbackSubmissionStarted": {
      const submittingIds = new Set(state.submittingIds);
      const submitErrors = { ...state.submitErrors };
      for (const id of action.ids) {
        submittingIds.add(id);
        delete submitErrors[id];
      }
      return {
        ...state,
        submittingIds: Array.from(submittingIds),
        submitErrors,
      };
    }
    case "feedbackSubmissionAccepted": {
      const submittedIds = new Set(action.submittedIds);
      return {
        ...state,
        drafts: state.drafts.filter(
          (draft) => !submittedIds.has(entityId(draft)),
        ),
        sent: state.sent.concat(action.sent),
        reviewerRevision: action.reviewerRevision,
        agent: {
          ...state.agent,
          requests: state.agent.requests.concat(action.requests),
          connected: action.agentConnected,
        },
        submittingIds: state.submittingIds.filter(
          (id) => !submittedIds.has(id),
        ),
      };
    }
    case "feedbackSubmissionFailed": {
      const failedIds = new Set(action.ids);
      const submitErrors = { ...state.submitErrors };
      for (const id of action.ids) submitErrors[id] = action.message;
      return {
        ...state,
        submittingIds: state.submittingIds.filter((id) => !failedIds.has(id)),
        submitErrors,
      };
    }
    case "durableSnapshotReplaced":
      return {
        ...state,
        drafts: action.drafts,
        sent: action.sent,
        activeDraft: action.activeDraft,
        resolvedCommentIds: action.resolvedCommentIds,
        reviewerRevision: action.reviewerRevision,
      };
    case "durableSaveConflicted":
      return {
        ...state,
        drafts: action.drafts,
        reviewerRevision: action.reviewerRevision,
        submitErrors: { ...state.submitErrors, ...action.errors },
      };
    case "reviewerRevisionChanged":
      return { ...state, reviewerRevision: action.revision };
    case "agentExchangeUpdated":
      return { ...state, agent: action.agent };
    case "progressEventsObserved":
      return { ...state, progressEvents: action.events };
    case "sourceRevisionChanged":
      return { ...state, sourceRevision: action.revision };
    case "threadResolved":
      return {
        ...state,
        resolvedCommentIds: appendUnique({
          values: state.resolvedCommentIds,
          value: action.id,
        }),
      };
    case "threadReopened":
      return {
        ...state,
        resolvedCommentIds: state.resolvedCommentIds.filter(
          (id) => id !== action.id,
        ),
      };
    case "resolutionsReplaced":
      return { ...state, resolvedCommentIds: action.ids };
  }
};

/** Creates the replaceable subscription shell around the pure reducer. */
export const createReviewStateStore = (
  initial: ReviewState,
): ReviewStateStore => {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch: (action) => {
      const next = reduceReviewState({ state, action });
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
