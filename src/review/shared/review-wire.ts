// Owns the loopback review runtime's browser-safe JSON contract. Server
// encoders and browser decoders meet here so transport changes cannot drift.

import { isStoredCommentTarget, type ReviewComment } from "./comment.js";
import {
  CHANGE_SET_ID,
  CONTENT_DIGEST,
  PLACE_ID_LIMIT,
  SNAPSHOT_DIGEST,
  type ChangeVerdict,
  type ChangeVerdictState,
} from "./change-verdict.js";
import {
  decodeAgentModelIdentity,
  type AgentModelIdentity,
} from "./agent-model.js";
import {
  projectRosterForBrowser,
  type AttachedAgent,
  type RosterAgent,
} from "./agent-primacy.js";
import type { TerminalAgentRequest } from "./agent-request-state.js";
import { isProgressStepCode, type ProgressStepCode } from "./progress-code.js";
import {
  type ReviewInput,
  type ReviewInputContract,
  type ReviewInputState,
} from "./input-contract.js";
import type { ApprovalHistoryItem, ApprovalSummary } from "./approval.js";
import { APPROVAL_ID } from "./approval.js";

export type ReviewSnapshot = {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly sent: ReadonlyArray<ReviewComment>;
  readonly resolvedCommentIds: ReadonlyArray<string>;
  /**
   * The store content this snapshot was read from, named so a later write can
   * be conditional on it. An empty version means the reader has no claim to
   * make, and a write carrying it is refused rather than applied blindly.
   */
  readonly version: string;
};

/**
 * The code a refused conditional drafts write carries. A status alone cannot
 * name this refusal, because a read-only replaced session refuses with 409 too
 * and the browser must answer the two differently.
 */
export const STALE_REVIEW_STATE_CODE = "stale-review-state";

export type StagedDecisionAnswer = {
  readonly decisionId: string;
  readonly optionId: string;
  readonly optionTitle: string;
  readonly prompt: string;
  readonly answeredAt: string;
  readonly premiseSnapshot: string;
  // The digest of the decision this answered, stamped by the server from the
  // compiled plan. An answer is current only while it still matches, so the
  // reviewer's confirmation can never migrate onto edited content.
  readonly decisionDigest: string;
};

export type ReviewState = {
  readonly answers: ReadonlyArray<StagedDecisionAnswer>;
  // Decisions the plan still asks that hold an answer to content they no longer
  // have. The reader gave that answer and deserves to be told it stopped
  // applying, which a card cannot work out for itself: from the browser's side
  // a masked answer and an unanswered decision look identical.
  readonly supersededDecisionIds: ReadonlyArray<string>;
  // Monotonic across every accepted write to the answers store. The browser
  // applies a response only when this is newer than the last one it applied,
  // so an in-flight read can no longer land on top of a completed write.
  readonly revision: number;
  /** Present only while an approval is in force. */
  readonly approval?: ApprovalSummary;
};

export type AgentOutcome = {
  readonly commentId: string;
  readonly state:
    "answered" | "changed" | "warning" | "needs-input" | "declined";
  readonly message: string;
  /** One scannable line, published exactly when the state is "warning". */
  readonly summary?: string;
  readonly changeTargets: ReadonlyArray<string>;
};

export type AgentRequest = TerminalAgentRequest & {
  readonly requestId: string;
  readonly premiseSnapshot: string;
  readonly baselineSnapshot?: string;
  readonly claimedAt?: string;
  readonly claimedBy?: string;
  /**
   * The roster identity of the agent that holds the claim.
   *
   * Distinct from `claimedBy`, which is a pickup token: the token identifies a
   * turn, while this identifies the connector the roster draws a card for. Any
   * surface that names who did something needs this one, because the token
   * matches no card.
   */
  readonly claimedByConnection?: string;
  readonly claimedModel?: AgentModelIdentity;
  readonly claimExpiresAtMs?: number;
  readonly createdAt: string;
  readonly kind: "feedback" | "reply" | "chat" | "push" | "approval";
  readonly body?: string;
  readonly commentId?: string;
  /**
   * The change this message is about, where the reviewer wrote it while
   * reviewing one rather than the thread as a whole. Browser-safe: it is a
   * block id the reader can already point at.
   */
  readonly aboutBlockId?: string;
  readonly commentIds: ReadonlyArray<string>;
  readonly origin?: "prompt" | "about";
  readonly threadId?: string;
  readonly targetLabel?: string;
};

export type AgentResponse = {
  readonly requestId: string;
  readonly resultSnapshot: string;
  readonly createdAt: string;
  readonly kind: "feedback" | "reply" | "chat" | "push" | "approval";
  readonly outcomes: ReadonlyArray<AgentOutcome>;
  readonly message?: string;
  readonly summary?: string;
  /**
   * Present exactly when an approval answer refused to acknowledge. The status
   * projection reads it as the refusal itself, so it is declared here rather
   * than left to survive on the decoder's structural fit alone.
   */
  readonly hardStop?: string;
};

export type AgentPresence = {
  readonly connected: boolean;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  /** Which model is running the attached connector, claim or no claim. */
  readonly model?: AgentModelIdentity;
  /**
   * Which agent on the roster this record is about.
   *
   * The store has always written it; the browser was not given it, so the card
   * drawn from this record could not say which of two attached agents it was
   * describing - and the roster below it, drawing from a different record, drew
   * that agent a second time. Carrying it lets the two surfaces agree on who
   * they are each talking about, or notice that they do not (BIG-171).
   */
  readonly writerId?: string;
  readonly updatedAtMs?: number;
  /** When the agent's own loop reported the session ending, if it did. */
  readonly endedAtMs?: number;
  /**
   * When the reviewer disconnected this agent, if they did.
   *
   * It is carried only while the directive still addresses the agent the
   * presence record names, so a disconnect answered by one agent never reports
   * itself against the next one to attach (BIG-190).
   */
  readonly disconnectRequestedAtMs?: number;
};

export type BrowserConnectionEvent = {
  readonly eventId?: string;
  readonly connected: boolean;
  readonly at: string;
  readonly reason?: string;
};

export type AgentSnapshot = {
  readonly currentSnapshot: string;
  readonly presence: AgentPresence;
  /** Every agent attached to this review, primary first-come order. */
  readonly agents: ReadonlyArray<RosterAgent>;
  readonly requests: ReadonlyArray<AgentRequest>;
  readonly responses: ReadonlyArray<AgentResponse>;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  readonly plan: string;
  readonly agentCommand: string;
  readonly recoveryPrompt: string;
};

export type ProgressEvent = {
  readonly requestId?: string;
  readonly atMs?: number;
  readonly seq: number;
  readonly stepCode: ProgressStepCode;
  readonly step: string;
  readonly state: "waiting" | "live" | "done" | "failed";
  readonly detail?: string;
};

export type DiffRun = {
  readonly op: "same" | "del" | "ins";
  readonly text: string;
};

// The meaning-bearing presentation facts the renderer stamped for one block,
// carried per diff side so the lens replays each side from its own snapshot
// instead of sniffing the live document. Only a fact that changes what the plan
// asserts belongs here - a list's ordering or a picture's source and
// alternative words. Styling and
// other reproducible presentation must never join this contract.
// Mirrored by hand across the reviewShared tier boundary; reviewShared may
// import nothing - keep this in sync with src/render/markdown/block-identity.ts.
export type BlockPresentation =
  | { readonly aspect: "list"; readonly isOrdered: boolean }
  | { readonly aspect: "image"; readonly source: string; readonly alt: string };

export type DiffLocation = {
  readonly status: "changed" | "added" | "removed";
  readonly scope: string;
  readonly oldBlockId?: string;
  readonly newBlockId?: string;
  readonly beforeBlockId?: string;
  readonly afterBlockId?: string;
  readonly kind: string;
  readonly isComponentRoot: boolean;
  readonly ownerId?: string;
  readonly label: string;
  readonly section: string;
  readonly oldText: string;
  readonly newText: string;
  readonly oldEvidence?: string;
  readonly newEvidence?: string;
  readonly oldPresentation?: BlockPresentation;
  readonly newPresentation?: BlockPresentation;
  readonly oldTableHeaders?: ReadonlyArray<string>;
  readonly newTableHeaders?: ReadonlyArray<string>;
  readonly isTableHeader?: boolean;
  readonly runs: ReadonlyArray<DiffRun>;
  /**
   * Trusted inert markup the engine replays for a block whose change no words
   * can evidence. A picture is the only such block: everything a component
   * owns is answered by `view` instead.
   */
  readonly oldView?: string;
  readonly newView?: string;
  /** Trusted inert component-owned markup for the diff-state root. */
  readonly view?: string;
};

export type DiffPlace = {
  readonly placeId: string;
  /**
   * What this place shows, independent of the revision it was minted under. A
   * verdict carried onto a later round compares this with what it was decided
   * over, which is how a change that moved again reads as re-opened rather
   * than as one nobody has seen.
   */
  readonly contentDigest: string;
  readonly status: "changed" | "added" | "removed";
  readonly label: string;
  readonly section: string;
  readonly note: "reworded" | "rewritten" | "replaced" | "added" | "removed";
  readonly locationIndexes: ReadonlyArray<number>;
  /**
   * The change sets that declared the blocks in this place, where the runtime
   * could name them. It is what lets a thread say whose work the rest of the
   * changes in view belong to instead of counting them anonymously; a place
   * whose blocks nobody declared carries none.
   */
  readonly ownerChangeSetIds?: ReadonlyArray<string>;
};

export type SnapshotDiff = {
  readonly from: string;
  readonly to: string;
  readonly locations: ReadonlyArray<DiffLocation>;
  readonly places: ReadonlyArray<DiffPlace>;
};

export type RuntimeSession = {
  readonly plan: string;
  readonly authoritative: boolean;
  readonly mode: "review" | "auto-accept";
  readonly armedAtMs?: number;
  readonly latestReviewUrl?: string;
  readonly restartCommand?: string;
  /**
   * How long this runtime's oldest stalled write has been stuck, present only
   * while one is. Every route the page polls is a read, and reads keep
   * answering through a runtime that has stopped accepting changes, so this is
   * the only fact that can tell the reader the session went one-way.
   */
  readonly writesStalledMs?: number;
  /** How long this session survives with nobody reading and nobody working. */
  readonly idleTimeoutMs?: number;
  /** When it ends unless something touches it. Absent when nothing expires. */
  readonly expiresAtMs?: number;
  /** Present only while an approval is in force. Polled so staleness is live. */
  readonly approval?: ApprovalSummary;
};

export type ReviewSnapshotSource = ReviewSnapshot;

export type ReviewStateSource = ReviewState;

export type ChangeVerdictStateSource = ChangeVerdictState;

export type AgentSnapshotSource = {
  readonly currentSnapshot: string;
  readonly presence: unknown;
  readonly agents: ReadonlyArray<AttachedAgent>;
  readonly requests: ReadonlyArray<unknown>;
  readonly responses: ReadonlyArray<unknown>;
  readonly connectionLog: ReadonlyArray<unknown>;
  readonly plan: string;
  readonly agentCommand: string;
  readonly recoveryPrompt: string;
};

/** What the agent snapshot looks like once it is safe to serve. */
export type AgentSnapshotWire = Omit<AgentSnapshotSource, "agents"> & {
  readonly agents: ReadonlyArray<RosterAgent>;
};

export type RuntimeSessionSource = {
  readonly sessionId: string;
  readonly planId: string;
  readonly plan: string;
  readonly authoritative: boolean;
  readonly mode: "review" | "auto-accept";
  readonly armedAtMs?: number;
  readonly latestReviewUrl?: string;
  readonly restartCommand?: string;
  readonly writesStalledMs?: number;
  readonly idleTimeoutMs?: number;
  readonly expiresAtMs?: number;
  readonly approval?: ApprovalSummary;
};

export const isReviewWireRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isWireTimestamp = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

/** Recognizes the bounded comment identity needed by browser persistence. */
export const isReviewCommentValue = (
  value: unknown,
): value is ReviewComment => {
  if (!isReviewWireRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.premiseSnapshot === "string" &&
    isStoredCommentTarget(value.target)
  );
};

// A slide-anchored target carries a copy of its slide for the agent's brief.
// The browser is reading that slide already, so sending the copy back to it
// would grow the bootstrap by one slide per comment for no reader-visible gain.
// The server keeps the copy: it re-mints it from the block map for a new
// target and preserves it for one it already accepted, so a comment that
// returns from the browser without it loses nothing.
const withoutSlideCopy = (comment: ReviewComment): ReviewComment => {
  if (
    comment.target.type === "document" ||
    comment.target.slideText === undefined
  ) {
    return comment;
  }
  const {
    slideText: _slideText,
    isSlideTextExcerpt: _excerpt,
    slideSubHeadings: _subHeadings,
    ...target
  } = comment.target;
  return { ...comment, target };
};

/**
 * Strips the same slide copy from the comments a pending request carries.
 *
 * A request holds the comments that produced it, so the copy would otherwise
 * reach the browser here too - on every poll rather than once at load - and the
 * browser projection keeps only the comment ids. The agent reads the exchange
 * from the store, never through this encoder, so what it is handed is untouched.
 */
export const encodeAgentRequests = (
  requests: ReadonlyArray<unknown>,
): ReadonlyArray<unknown> =>
  requests.map((request) => {
    if (!isReviewWireRecord(request)) return request;
    /*
    An approval carries the canonical-source contract the agent has to satisfy:
    the reviewer's absolute plan path, the digest to verify it against, and the
    decisions recorded with it. Reading that contract is the agent's job and
    checking it is the server's, and the browser projection keeps none of it -
    so the page is not handed the reviewer's filesystem path on every poll to
    render the covering message it does keep.
    */
    if (request.kind === "approval") {
      const {
        planPath: _planPath,
        pinnedSnapshot: _pinnedSnapshot,
        recordedAnswers: _recordedAnswers,
        unansweredDecisions: _unansweredDecisions,
        ...browserSafe
      } = request;
      return browserSafe;
    }
    if (!Array.isArray(request.comments)) return request;
    return {
      ...request,
      comments: request.comments.map((comment) =>
        isReviewCommentValue(comment) ? withoutSlideCopy(comment) : comment,
      ),
    };
  });

/** Encodes the server-owned comment snapshot for transport. */
export const encodeReviewSnapshot = (
  value: ReviewSnapshotSource,
): ReviewSnapshotSource => ({
  ...value,
  drafts: value.drafts.map(withoutSlideCopy),
  sent: value.sent.map(withoutSlideCopy),
});

/**
 * Decodes comments while dropping malformed local or transport values. Fields
 * this contract no longer names are dropped, so state a runtime of another
 * vintage left behind loads as the fields this one understands.
 */
export const decodeReviewSnapshot = (value: unknown): ReviewSnapshot => {
  if (!isReviewWireRecord(value)) {
    return { drafts: [], sent: [], resolvedCommentIds: [], version: "" };
  }
  return {
    drafts: Array.isArray(value.drafts)
      ? value.drafts.filter(isReviewCommentValue)
      : [],
    sent: Array.isArray(value.sent)
      ? value.sent.filter(isReviewCommentValue)
      : [],
    resolvedCommentIds: Array.isArray(value.resolvedCommentIds)
      ? value.resolvedCommentIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    version: typeof value.version === "string" ? value.version : "",
  };
};

/**
 * A record's write count as a reader may use it. Every store advances this by
 * whole steps from zero, so a value that is not a whole count is not a write
 * this build can order against - and accepting one would be worse than
 * refusing it: a fractional revision sits above the legitimate write that
 * follows it, and would silently discard every later response until the count
 * climbed past it. Anything unusable decodes to -1, which is older than any
 * accepted write and can therefore never displace applied state.
 */
const storedRevision = (candidate: unknown): number =>
  typeof candidate === "number" &&
  Number.isSafeInteger(candidate) &&
  candidate >= 0
    ? candidate
    : -1;

/** Encodes the change verdicts a review has recorded. */
export const encodeChangeVerdicts = (
  value: ChangeVerdictStateSource,
): ChangeVerdictStateSource => value;

/**
 * Decodes recorded verdicts while dropping malformed transport entries.
 * An unusable revision decodes to -1 for the same reason the answers store
 * does: it is older than any accepted write, so a body this build cannot read
 * can never displace state the page already applied.
 */
export const decodeChangeVerdicts = (value: unknown): ChangeVerdictState => {
  if (!isReviewWireRecord(value) || !Array.isArray(value.decided)) {
    return { decided: [], revision: -1 };
  }
  return {
    revision: storedRevision(value.revision),
    decided: value.decided.flatMap((entry): ReadonlyArray<ChangeVerdict> =>
      isReviewWireRecord(entry) &&
      typeof entry.changeSetId === "string" &&
      CHANGE_SET_ID.test(entry.changeSetId) &&
      typeof entry.from === "string" &&
      SNAPSHOT_DIGEST.test(entry.from) &&
      typeof entry.to === "string" &&
      SNAPSHOT_DIGEST.test(entry.to) &&
      typeof entry.placeId === "string" &&
      entry.placeId !== "" &&
      entry.placeId.length <= PLACE_ID_LIMIT &&
      (entry.verdict === "accepted" || entry.verdict === "rejected") &&
      typeof entry.decidedAt === "string" &&
      (entry.actor === undefined ||
        entry.actor === "reviewer" ||
        entry.actor === "auto-accept") &&
      (entry.contentDigest === undefined ||
        (typeof entry.contentDigest === "string" &&
          CONTENT_DIGEST.test(entry.contentDigest)))
        ? [
            {
              changeSetId: entry.changeSetId,
              from: entry.from,
              to: entry.to,
              placeId: entry.placeId,
              verdict: entry.verdict,
              decidedAt: entry.decidedAt,
              ...(entry.actor === undefined ? {} : { actor: entry.actor }),
              ...(typeof entry.contentDigest === "string"
                ? { contentDigest: entry.contentDigest }
                : {}),
            },
          ]
        : [],
    ),
  };
};

/** What caused the change set a committed revision belongs to. */
export type ChangeSetProvenance = "feedback" | "reply" | "chat" | "push";

/**
 * One change set as the committed revision log folds it: the baseline and
 * provenance stay where the set's first committed revision put them, while the
 * result and commit time advance with every later revision.
 */
export type CommittedChangeSet = {
  readonly changeSetId: string;
  readonly provenance: ChangeSetProvenance;
  readonly baseSnapshot: string;
  readonly resultSnapshot: string;
  readonly committedAt: string;
};

/** The change sets one plan's committed revision log describes. */
export type CommittedChangeSetState = {
  readonly changeSets: ReadonlyArray<CommittedChangeSet>;
};

// A change set is keyed by an ordinary comment thread's short id or by an
// immutable transaction's request id, so the wire accepts both widths.

// Neither of the reviewer's own writes ever reaches a browser as a change set,
// because neither proposes anything, which is why the four agent kinds are the
// whole of what a change set may arrive as.
const CHANGE_SET_PROVENANCE: ReadonlySet<string> = new Set<ChangeSetProvenance>(
  ["feedback", "reply", "chat", "push"],
);

/** Encodes the committed change sets a review has folded. */
export const encodeCommittedChangeSets = (
  value: CommittedChangeSetState,
): CommittedChangeSetState => value;

/**
 * Decodes the committed change sets, or says it could not.
 *
 * A body this build cannot read is reported as unreadable rather than as an
 * empty list, because the two mean opposite things to a reader: one says the
 * fold could not be fetched, the other says no thread has changed the plan.
 * Within a readable body, an entry this build cannot place is dropped alone,
 * so one malformed set never hides the sets beside it.
 */
export const decodeCommittedChangeSets = (
  value: unknown,
): CommittedChangeSetState | undefined => {
  if (!isReviewWireRecord(value) || !Array.isArray(value.changeSets)) {
    return undefined;
  }
  return {
    changeSets: value.changeSets.flatMap(
      (entry): ReadonlyArray<CommittedChangeSet> =>
        isReviewWireRecord(entry) &&
        typeof entry.changeSetId === "string" &&
        CHANGE_SET_ID.test(entry.changeSetId) &&
        typeof entry.provenance === "string" &&
        CHANGE_SET_PROVENANCE.has(entry.provenance) &&
        typeof entry.baseSnapshot === "string" &&
        SNAPSHOT_DIGEST.test(entry.baseSnapshot) &&
        typeof entry.resultSnapshot === "string" &&
        SNAPSHOT_DIGEST.test(entry.resultSnapshot) &&
        isWireTimestamp(entry.committedAt)
          ? [
              {
                changeSetId: entry.changeSetId,
                provenance: entry.provenance as ChangeSetProvenance,
                baseSnapshot: entry.baseSnapshot,
                resultSnapshot: entry.resultSnapshot,
                committedAt: entry.committedAt,
              },
            ]
          : [],
    ),
  };
};

/** Encodes the review's derived input contract for transport. */
export const encodeReviewInputContract = (
  value: ReviewInputContract,
): ReviewInputContract => value;

const INPUT_STATES: ReadonlySet<string> = new Set<ReviewInputState>([
  "answered",
  "unanswered",
  "stale",
]);

/**
 * Decodes the input contract, or says it could not.
 *
 * A body this build cannot read is reported as unreadable rather than as an
 * empty contract, because the two mean opposite things to a reader: one says
 * nobody could answer what the review needs, the other says the review needs
 * nothing. A revision it cannot order on is unreadable for the same reason -
 * the guard that drops older responses cannot hold a body it cannot place, and
 * the first read would otherwise slip past it and present as a definite answer.
 */
export const decodeReviewInputContract = (
  value: unknown,
): ReviewInputContract | undefined => {
  if (!isReviewWireRecord(value) || !Array.isArray(value.inputs)) {
    return undefined;
  }
  const revision = storedRevision(value.revision);
  if (revision < 0) return undefined;
  return {
    revision,
    inputs: value.inputs.flatMap((input): ReadonlyArray<ReviewInput> =>
      isReviewWireRecord(input) &&
      typeof input.inputId === "string" &&
      typeof input.label === "string" &&
      typeof input.isCritical === "boolean" &&
      typeof input.state === "string" &&
      INPUT_STATES.has(input.state) &&
      typeof input.detail === "string"
        ? [
            {
              inputId: input.inputId,
              label: input.label,
              isCritical: input.isCritical,
              state: input.state as ReviewInputState,
              detail: input.detail,
            },
          ]
        : [],
    ),
  };
};

/** Encodes the durable browser-safe facts gathered during plan review. */
export const encodeReviewState = (
  value: ReviewStateSource,
): ReviewStateSource => value;

/**
 * Decodes staged answers while dropping malformed transport entries. A body
 * without a usable revision decodes to -1, which is older than any accepted
 * write, so an unreadable response can never displace applied state.
 */
export const decodeReviewState = (value: unknown): ReviewState => {
  if (!isReviewWireRecord(value) || !Array.isArray(value.answers)) {
    return { answers: [], supersededDecisionIds: [], revision: -1 };
  }
  const approval = decodeApprovalSummary(value.approval);
  return {
    revision: storedRevision(value.revision),
    supersededDecisionIds: Array.isArray(value.supersededDecisionIds)
      ? value.supersededDecisionIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    ...(approval === undefined ? {} : { approval }),
    answers: value.answers.flatMap(
      (answer): ReadonlyArray<StagedDecisionAnswer> =>
        isReviewWireRecord(answer) &&
        typeof answer.decisionId === "string" &&
        typeof answer.optionId === "string" &&
        typeof answer.optionTitle === "string" &&
        typeof answer.prompt === "string" &&
        typeof answer.answeredAt === "string" &&
        typeof answer.premiseSnapshot === "string" &&
        typeof answer.decisionDigest === "string"
          ? [
              {
                decisionId: answer.decisionId,
                optionId: answer.optionId,
                optionTitle: answer.optionTitle,
                prompt: answer.prompt,
                answeredAt: answer.answeredAt,
                premiseSnapshot: answer.premiseSnapshot,
                decisionDigest: answer.decisionDigest,
              },
            ]
          : [],
    ),
  };
};

/** Encodes the derived approval summary the browser paints from. */
export const encodeApprovalSummary = (
  value: ApprovalSummary,
): ApprovalSummary => value;

/**
 * Decodes the approval log the popover lists. A malformed item is dropped
 * rather than shown, and an absent array reads as no history: a history the
 * page cannot parse must not take the approved state down with it.
 */
const decodeApprovalHistory = (
  value: unknown,
): ReadonlyArray<ApprovalHistoryItem> => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ReadonlyArray<ApprovalHistoryItem> => {
    if (
      !isReviewWireRecord(item) ||
      typeof item.approvalId !== "string" ||
      !APPROVAL_ID.test(item.approvalId) ||
      typeof item.at !== "string" ||
      Number.isNaN(Date.parse(item.at)) ||
      typeof item.pinnedSnapshot !== "string" ||
      !SNAPSHOT_DIGEST.test(item.pinnedSnapshot) ||
      (item.revokedAt !== undefined &&
        (typeof item.revokedAt !== "string" ||
          Number.isNaN(Date.parse(item.revokedAt))))
    ) {
      return [];
    }
    const revokedAt = item.revokedAt;
    return [
      {
        approvalId: item.approvalId,
        at: item.at,
        pinnedSnapshot: item.pinnedSnapshot,
        ...(typeof revokedAt === "string" ? { revokedAt } : {}),
      },
    ];
  });
};

/** Decodes an approval summary, dropping a malformed body rather than guessing. */
export const decodeApprovalSummary = (
  value: unknown,
): ApprovalSummary | undefined => {
  if (!isReviewWireRecord(value)) return undefined;
  if (
    typeof value.approvalId !== "string" ||
    !APPROVAL_ID.test(value.approvalId) ||
    typeof value.at !== "string" ||
    Number.isNaN(Date.parse(value.at)) ||
    typeof value.pinnedSnapshot !== "string" ||
    !SNAPSHOT_DIGEST.test(value.pinnedSnapshot) ||
    (value.status !== "approved" && value.status !== "stale") ||
    typeof value.message !== "string" ||
    typeof value.delivered !== "boolean" ||
    !isReviewWireRecord(value.openItemCounts)
  ) {
    return undefined;
  }
  const counts = value.openItemCounts;
  if (
    typeof counts.changeSetsAccepted !== "number" ||
    typeof counts.changeSetsTotal !== "number" ||
    typeof counts.decisionsAnswered !== "number" ||
    typeof counts.decisionsTotal !== "number" ||
    typeof counts.requestsCanceled !== "number"
  ) {
    return undefined;
  }
  return {
    approvalId: value.approvalId,
    at: value.at,
    pinnedSnapshot: value.pinnedSnapshot,
    status: value.status,
    message: value.message,
    delivered: value.delivered,
    history: decodeApprovalHistory(value.history),
    openItemCounts: {
      changeSetsAccepted: counts.changeSetsAccepted,
      changeSetsTotal: counts.changeSetsTotal,
      decisionsAnswered: counts.decisionsAnswered,
      decisionsTotal: counts.decisionsTotal,
      requestsCanceled: counts.requestsCanceled,
    },
  };
};

export const emptyAgentSnapshot = (): AgentSnapshot => ({
  currentSnapshot: "",
  presence: { connected: false, state: "waiting" },
  agents: [],
  requests: [],
  responses: [],
  connectionLog: [],
  plan: "",
  agentCommand: "",
  recoveryPrompt: "",
});

/**
 * Encodes the runtime-owned exchange in the shape consumed by the browser.
 *
 * The roster is projected rather than passed through. What the browser needs
 * from a roster record is who an agent is, what it is, and whether it is still
 * here; what it does not need - and must not be given - is the pickup token
 * that fences publication, or the fields whose reading is the server's job.
 */
export const encodeAgentSnapshot = (
  value: AgentSnapshotSource,
  { nowMs }: { readonly nowMs: number },
): AgentSnapshotWire => ({
  ...value,
  agents: projectRosterForBrowser({ agents: value.agents, nowMs }),
  requests: encodeAgentRequests(value.requests),
});

/** Decodes the agent exchange while preserving only browser-safe facts. */
export const decodeAgentSnapshot = (value: unknown): AgentSnapshot => {
  if (!isReviewWireRecord(value)) return emptyAgentSnapshot();
  const requests = Array.isArray(value.requests)
    ? value.requests.flatMap((request): ReadonlyArray<AgentRequest> => {
        if (
          !isReviewWireRecord(request) ||
          typeof request.requestId !== "string" ||
          typeof request.premiseSnapshot !== "string" ||
          typeof request.createdAt !== "string" ||
          (request.kind !== "feedback" &&
            request.kind !== "reply" &&
            request.kind !== "chat" &&
            request.kind !== "push" &&
            request.kind !== "approval") ||
          (request.kind === "push" &&
            ((request.origin !== "prompt" && request.origin !== "about") ||
              typeof request.body !== "string" ||
              request.body.trim() === "" ||
              request.body.length > 4000 ||
              typeof request.threadId !== "string" ||
              !/^[a-f0-9]{16}$/u.test(request.threadId)))
        ) {
          return [];
        }
        const rawClaim = [
          request.baselineSnapshot,
          request.claimedAt,
          request.claimedBy,
          request.claimExpiresAtMs,
        ];
        const hasAnyClaim = rawClaim.some((field) => field !== undefined);
        const hasCompleteClaim =
          typeof request.baselineSnapshot === "string" &&
          /^[a-f0-9]{16,64}$/.test(request.baselineSnapshot) &&
          isWireTimestamp(request.claimedAt) &&
          typeof request.claimedBy === "string" &&
          /^[a-f0-9]{16}$/.test(request.claimedBy) &&
          typeof request.claimExpiresAtMs === "number" &&
          Number.isSafeInteger(request.claimExpiresAtMs) &&
          request.claimExpiresAtMs > 0;
        const claimedByConnection =
          typeof request.claimedByConnection === "string" &&
          /^[a-f0-9]{16}$/.test(request.claimedByConnection)
            ? request.claimedByConnection
            : undefined;
        const claimedModel = decodeAgentModelIdentity(request.claimedModel);
        const answeredAt = isWireTimestamp(request.answeredAt)
          ? request.answeredAt
          : undefined;
        const canceledAt = isWireTimestamp(request.canceledAt)
          ? request.canceledAt
          : undefined;
        if (
          (hasAnyClaim && !hasCompleteClaim) ||
          (request.claimedByConnection !== undefined &&
            (claimedByConnection === undefined || !hasCompleteClaim)) ||
          (request.claimedModel !== undefined &&
            (claimedModel === undefined || !hasCompleteClaim)) ||
          (request.answeredAt !== undefined && answeredAt === undefined) ||
          (request.canceledAt !== undefined && canceledAt === undefined) ||
          (answeredAt !== undefined && canceledAt !== undefined) ||
          (answeredAt !== undefined && !hasCompleteClaim)
        ) {
          return [];
        }
        const pushOrigin =
          request.origin === "prompt" || request.origin === "about"
            ? request.origin
            : undefined;
        const pushThreadId =
          typeof request.threadId === "string" ? request.threadId : undefined;
        return [
          {
            requestId: request.requestId,
            premiseSnapshot: request.premiseSnapshot,
            createdAt: request.createdAt,
            kind: request.kind,
            ...(hasCompleteClaim
              ? {
                  baselineSnapshot: request.baselineSnapshot as string,
                  claimedAt: request.claimedAt as string,
                  claimedBy: request.claimedBy as string,
                  claimExpiresAtMs: request.claimExpiresAtMs as number,
                  ...(claimedByConnection === undefined
                    ? {}
                    : { claimedByConnection }),
                  ...(claimedModel === undefined ? {} : { claimedModel }),
                }
              : {}),
            ...(answeredAt === undefined ? {} : { answeredAt }),
            ...(canceledAt === undefined ? {} : { canceledAt }),
            ...(typeof request.body === "string"
              ? { body: request.body }
              : typeof request.message === "string"
                ? { body: request.message }
                : {}),
            ...(typeof request.commentId === "string"
              ? { commentId: request.commentId }
              : {}),
            ...(typeof request.aboutBlockId === "string"
              ? { aboutBlockId: request.aboutBlockId }
              : {}),
            ...(request.kind === "push" &&
            pushOrigin !== undefined &&
            pushThreadId !== undefined
              ? { origin: pushOrigin, threadId: pushThreadId }
              : {}),
            commentIds:
              request.kind === "push" && pushThreadId !== undefined
                ? [pushThreadId]
                : Array.isArray(request.comments)
                  ? request.comments.flatMap(
                      (comment): ReadonlyArray<string> =>
                        isReviewWireRecord(comment) &&
                        typeof comment.id === "string"
                          ? [comment.id]
                          : [],
                    )
                  : [],
            ...(Array.isArray(request.comments) &&
            isReviewWireRecord(request.comments[0]) &&
            isReviewWireRecord(request.comments[0].target)
              ? {
                  targetLabel:
                    typeof request.comments[0].target.section === "string"
                      ? request.comments[0].target.section
                      : typeof request.comments[0].target.label === "string"
                        ? request.comments[0].target.label
                        : "Whole plan",
                }
              : {}),
          },
        ];
      })
    : [];
  const responses = Array.isArray(value.responses)
    ? value.responses.flatMap((response): ReadonlyArray<AgentResponse> => {
        if (
          !isReviewWireRecord(response) ||
          typeof response.requestId !== "string" ||
          typeof response.resultSnapshot !== "string" ||
          typeof response.createdAt !== "string" ||
          (response.kind !== "feedback" &&
            response.kind !== "reply" &&
            response.kind !== "chat" &&
            response.kind !== "push" &&
            response.kind !== "approval")
        ) {
          return [];
        }
        const outcomes = Array.isArray(response.outcomes)
          ? response.outcomes.flatMap(
              (outcome): ReadonlyArray<AgentOutcome> => {
                if (
                  !isReviewWireRecord(outcome) ||
                  typeof outcome.commentId !== "string" ||
                  typeof outcome.message !== "string" ||
                  (outcome.state !== "answered" &&
                    outcome.state !== "changed" &&
                    outcome.state !== "warning" &&
                    outcome.state !== "needs-input" &&
                    outcome.state !== "declined")
                ) {
                  return [];
                }
                return [
                  {
                    commentId: outcome.commentId,
                    state: outcome.state,
                    message: outcome.message,
                    ...(typeof outcome.summary === "string"
                      ? { summary: outcome.summary }
                      : {}),
                    changeTargets: Array.isArray(outcome.changeTargets)
                      ? outcome.changeTargets.filter(
                          (target): target is string =>
                            typeof target === "string",
                        )
                      : [],
                  },
                ];
              },
            )
          : [];
        return [
          {
            requestId: response.requestId,
            resultSnapshot: response.resultSnapshot,
            createdAt: response.createdAt,
            kind: response.kind,
            outcomes,
            ...(typeof response.message === "string"
              ? { message: response.message }
              : {}),
            ...(typeof response.summary === "string"
              ? { summary: response.summary }
              : {}),
            ...(typeof response.hardStop === "string"
              ? { hardStop: response.hardStop }
              : {}),
          },
        ];
      })
    : [];
  const presence = isReviewWireRecord(value.presence)
    ? {
        connected: value.presence.connected === true,
        state:
          value.presence.state === "working"
            ? ("working" as const)
            : ("waiting" as const),
        ...(typeof value.presence.requestId === "string"
          ? { requestId: value.presence.requestId }
          : {}),
        ...(() => {
          const model = decodeAgentModelIdentity(value.presence.model);
          return model === undefined ? {} : { model };
        })(),
        ...(typeof value.presence.writerId === "string" &&
        value.presence.writerId !== ""
          ? { writerId: value.presence.writerId }
          : {}),
        ...(typeof value.presence.updatedAtMs === "number"
          ? { updatedAtMs: value.presence.updatedAtMs }
          : {}),
        ...(typeof value.presence.endedAtMs === "number"
          ? { endedAtMs: value.presence.endedAtMs }
          : {}),
        ...(typeof value.presence.disconnectRequestedAtMs === "number"
          ? { disconnectRequestedAtMs: value.presence.disconnectRequestedAtMs }
          : {}),
      }
    : { connected: false, state: "waiting" as const };
  /*
  An agent whose record does not decode disappears rather than taking the
  roster with it: a reviewer must still see the agents that are fine. The role
  is required, because a record that cannot say whether it owns the plan is
  exactly the ambiguity this surface exists to remove.
  */
  const agents = Array.isArray(value.agents)
    ? value.agents.flatMap((agent): ReadonlyArray<RosterAgent> => {
        if (
          !isReviewWireRecord(agent) ||
          typeof agent.writerId !== "string" ||
          agent.writerId === "" ||
          (agent.role !== "primary" && agent.role !== "observer") ||
          typeof agent.attachedAtMs !== "number" ||
          !Number.isFinite(agent.attachedAtMs) ||
          typeof agent.signalAtMs !== "number" ||
          !Number.isFinite(agent.signalAtMs) ||
          // Membership is answered by the server or not at all. A record that
          // cannot say whether its agent is still here would be drawn as one
          // that is, which is the ambiguity this surface exists to remove.
          typeof agent.attached !== "boolean"
        ) {
          return [];
        }
        const model = decodeAgentModelIdentity(agent.model);
        return [
          {
            writerId: agent.writerId,
            role: agent.role,
            attachedAtMs: agent.attachedAtMs,
            signalAtMs: agent.signalAtMs,
            attached: agent.attached,
            ...(typeof agent.requestedPrimacyAtMs === "number" &&
            Number.isFinite(agent.requestedPrimacyAtMs)
              ? { requestedPrimacyAtMs: agent.requestedPrimacyAtMs }
              : {}),
            ...(model === undefined ? {} : { model }),
          },
        ];
      })
    : [];
  return {
    currentSnapshot:
      typeof value.currentSnapshot === "string" ? value.currentSnapshot : "",
    presence,
    agents,
    requests,
    responses,
    connectionLog: Array.isArray(value.connectionLog)
      ? value.connectionLog.flatMap(
          (event): ReadonlyArray<BrowserConnectionEvent> =>
            isReviewWireRecord(event) &&
            typeof event.connected === "boolean" &&
            typeof event.at === "string"
              ? [
                  {
                    connected: event.connected,
                    at: event.at,
                    ...(typeof event.eventId === "string"
                      ? { eventId: event.eventId }
                      : {}),
                    ...(typeof event.reason === "string"
                      ? { reason: event.reason }
                      : {}),
                  },
                ]
              : [],
        )
      : [],
    plan: typeof value.plan === "string" ? value.plan : "",
    agentCommand:
      typeof value.agentCommand === "string" ? value.agentCommand : "",
    recoveryPrompt:
      typeof value.recoveryPrompt === "string" ? value.recoveryPrompt : "",
  };
};

/** Encodes mailbox-owned progress without presentation-specific projection. */
export const encodeProgress = ({
  events,
}: {
  readonly events: ReadonlyArray<ProgressEvent>;
}): { readonly events: ReadonlyArray<ProgressEvent> } => ({ events });

/** Decodes progress and drops unknown semantic codes or states. */
export const decodeProgress = (
  value: unknown,
): ReadonlyArray<ProgressEvent> => {
  if (!isReviewWireRecord(value) || !Array.isArray(value.events)) return [];
  return value.events.flatMap((event): ReadonlyArray<ProgressEvent> => {
    if (
      !isReviewWireRecord(event) ||
      typeof event.seq !== "number" ||
      !isProgressStepCode(event.stepCode) ||
      typeof event.step !== "string" ||
      (event.state !== "waiting" &&
        event.state !== "live" &&
        event.state !== "done" &&
        event.state !== "failed")
    ) {
      return [];
    }
    return [
      {
        seq: event.seq,
        stepCode: event.stepCode,
        step: event.step,
        state: event.state,
        ...(typeof event.requestId === "string"
          ? { requestId: event.requestId }
          : {}),
        ...(typeof event.atMs === "number" ? { atMs: event.atMs } : {}),
        ...(typeof event.detail === "string" ? { detail: event.detail } : {}),
      },
    ];
  });
};

const isUsableTimeValue = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Encodes the server's browser-safe session-authority projection. */
export const encodeRuntimeSession = (
  value: RuntimeSessionSource,
): RuntimeSessionSource => value;

/** Decodes session authority only for the page's own session identity. */
export const decodeRuntimeSession = ({
  value,
  sessionId,
}: {
  readonly value: unknown;
  readonly sessionId: string;
}): RuntimeSession | null => {
  if (
    !isReviewWireRecord(value) ||
    value.sessionId !== sessionId ||
    typeof value.plan !== "string"
  ) {
    return null;
  }
  const approval = decodeApprovalSummary(value.approval);
  const mode = value.mode === "auto-accept" ? "auto-accept" : "review";
  return {
    plan: value.plan,
    // A malformed payload must withhold authority, not grant it: `!== false`
    // read a missing field, a null, and the string "false" as authoritative.
    authoritative: value.authoritative === true,
    mode,
    ...(mode === "auto-accept" && isUsableTimeValue(value.armedAtMs)
      ? { armedAtMs: value.armedAtMs }
      : {}),
    ...(typeof value.latestReviewUrl === "string"
      ? { latestReviewUrl: value.latestReviewUrl }
      : {}),
    ...(typeof value.restartCommand === "string" &&
    value.restartCommand.trim() !== ""
      ? { restartCommand: value.restartCommand }
      : {}),
    // A stall is only ever reported as a positive age. Anything else is not a
    // smaller stall, it is an absent one, and must not raise the banner.
    ...(typeof value.writesStalledMs === "number" &&
    Number.isFinite(value.writesStalledMs) &&
    value.writesStalledMs > 0
      ? { writesStalledMs: value.writesStalledMs }
      : {}),
    // A lifetime fact the page cannot trust is worse than none: dropping it
    // leaves the reader with no promise instead of a wrong one.
    ...(isUsableTimeValue(value.idleTimeoutMs)
      ? { idleTimeoutMs: value.idleTimeoutMs }
      : {}),
    ...(isUsableTimeValue(value.expiresAtMs)
      ? { expiresAtMs: value.expiresAtMs }
      : {}),
    ...(approval === undefined ? {} : { approval }),
  };
};

/** Encodes one complete snapshot diff for browser change surfaces. */
export const encodeSnapshotDiff = (value: SnapshotDiff): SnapshotDiff => value;

// Normalizes one per-side presentation fact. An unknown aspect or an
// out-of-vocabulary value decodes to undefined so the browser renders its
// neutral fallback; coercing to "note" or "unordered" here would reintroduce
// the silent downgrade this fact exists to remove.
const decodeBlockPresentation = (
  value: unknown,
): BlockPresentation | undefined => {
  if (!isReviewWireRecord(value)) return undefined;
  if (value.aspect === "list" && typeof value.isOrdered === "boolean") {
    return { aspect: "list", isOrdered: value.isOrdered };
  }
  if (
    value.aspect === "image" &&
    typeof value.source === "string" &&
    typeof value.alt === "string"
  ) {
    return { aspect: "image", source: value.source, alt: value.alt };
  }
  return undefined;
};

/** Decodes the bounded snapshot-diff vocabulary used by the browser. */
export const decodeSnapshotDiff = (value: unknown): SnapshotDiff | null => {
  if (
    !isReviewWireRecord(value) ||
    typeof value.from !== "string" ||
    typeof value.to !== "string" ||
    !Array.isArray(value.locations) ||
    !Array.isArray(value.places) ||
    value.locations.some(
      (location) =>
        !isReviewWireRecord(location) ||
        typeof location.isComponentRoot !== "boolean",
    )
  ) {
    return null;
  }
  const locations = value.locations.flatMap(
    (location): ReadonlyArray<DiffLocation> => {
      if (
        !isReviewWireRecord(location) ||
        (location.status !== "changed" &&
          location.status !== "added" &&
          location.status !== "removed") ||
        typeof location.label !== "string" ||
        typeof location.section !== "string" ||
        typeof location.scope !== "string" ||
        typeof location.kind !== "string" ||
        typeof location.isComponentRoot !== "boolean" ||
        typeof location.oldText !== "string" ||
        typeof location.newText !== "string" ||
        !Array.isArray(location.runs)
      ) {
        return [];
      }
      const runs = location.runs.flatMap((run): ReadonlyArray<DiffRun> => {
        if (
          !isReviewWireRecord(run) ||
          (run.op !== "same" && run.op !== "del" && run.op !== "ins") ||
          typeof run.text !== "string"
        ) {
          return [];
        }
        return [{ op: run.op, text: run.text }];
      });
      const oldPresentation = decodeBlockPresentation(location.oldPresentation);
      const newPresentation = decodeBlockPresentation(location.newPresentation);
      return [
        {
          status: location.status,
          scope: location.scope,
          kind: location.kind,
          isComponentRoot: location.isComponentRoot,
          ...(typeof location.ownerId === "string"
            ? { ownerId: location.ownerId }
            : {}),
          label: location.label,
          section: location.section,
          oldText: location.oldText,
          newText: location.newText,
          ...(typeof location.oldEvidence === "string"
            ? { oldEvidence: location.oldEvidence }
            : {}),
          ...(typeof location.newEvidence === "string"
            ? { newEvidence: location.newEvidence }
            : {}),
          ...(oldPresentation === undefined ? {} : { oldPresentation }),
          ...(newPresentation === undefined ? {} : { newPresentation }),
          ...(Array.isArray(location.oldTableHeaders) &&
          location.oldTableHeaders.every((entry) => typeof entry === "string")
            ? { oldTableHeaders: location.oldTableHeaders }
            : {}),
          ...(Array.isArray(location.newTableHeaders) &&
          location.newTableHeaders.every((entry) => typeof entry === "string")
            ? { newTableHeaders: location.newTableHeaders }
            : {}),
          ...(location.isTableHeader === true ? { isTableHeader: true } : {}),
          ...(typeof location.oldBlockId === "string"
            ? { oldBlockId: location.oldBlockId }
            : {}),
          ...(typeof location.newBlockId === "string"
            ? { newBlockId: location.newBlockId }
            : {}),
          ...(typeof location.beforeBlockId === "string"
            ? { beforeBlockId: location.beforeBlockId }
            : {}),
          ...(typeof location.afterBlockId === "string"
            ? { afterBlockId: location.afterBlockId }
            : {}),
          ...(typeof location.oldView === "string"
            ? { oldView: location.oldView }
            : {}),
          ...(typeof location.newView === "string"
            ? { newView: location.newView }
            : {}),
          ...(typeof location.view === "string" ? { view: location.view } : {}),
          runs,
        },
      ];
    },
  );
  if (locations.length !== value.locations.length) return null;
  const places = value.places.flatMap((place): ReadonlyArray<DiffPlace> => {
    if (
      !isReviewWireRecord(place) ||
      typeof place.placeId !== "string" ||
      typeof place.contentDigest !== "string" ||
      !CONTENT_DIGEST.test(place.contentDigest) ||
      (place.status !== "changed" &&
        place.status !== "added" &&
        place.status !== "removed") ||
      typeof place.label !== "string" ||
      typeof place.section !== "string" ||
      (place.note !== "reworded" &&
        place.note !== "rewritten" &&
        place.note !== "replaced" &&
        place.note !== "added" &&
        place.note !== "removed") ||
      !Array.isArray(place.locationIndexes)
    ) {
      return [];
    }
    const locationIndexes = place.locationIndexes.filter(
      (index): index is number =>
        typeof index === "number" &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < locations.length,
    );
    if (locationIndexes.length !== place.locationIndexes.length) return [];
    const ownerChangeSetIds = Array.isArray(place.ownerChangeSetIds)
      ? place.ownerChangeSetIds.filter(
          (id): id is string =>
            typeof id === "string" && CHANGE_SET_ID.test(id),
        )
      : [];
    return [
      {
        placeId: place.placeId,
        contentDigest: place.contentDigest,
        status: place.status,
        label: place.label,
        section: place.section,
        note: place.note,
        locationIndexes,
        ...(ownerChangeSetIds.length === 0 ? {} : { ownerChangeSetIds }),
      },
    ];
  });
  return { from: value.from, to: value.to, locations, places };
};
