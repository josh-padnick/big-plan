// Mounts Big Plan's typed React review interaction island over the inert,
// server-rendered plan. React owns only review chrome; authored content stays
// server-rendered and readable when this island is unavailable.
//
// The consistency model for the reviewer's own state - drafts, resolved ids,
// and the comment text no comment holds yet - is one loop. Every write is
// conditional on the version this browser last read, so a write prepared
// against content the store has moved past is refused rather than applied; a
// refusal is the fact that tells an unsynchronized newer edit from a stale
// superseded one. On refusal the browser re-reads and merges against the base
// it recorded per comment at the last agreed point, and hands back any comment
// both sides changed instead of picking a side. Everything not yet agreed -
// including comment text with no runtime home - is mirrored into a per-tab
// recovery snapshot, so a reload gives back what was on screen without making
// browser tabs reconcile with one another behind the runtime's back.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CIRCLE_QUESTION_MARK_ICON } from "../../icons/lucide/circle-question-mark.js";
import { CIRCLE_X_ICON } from "../../icons/lucide/circle-x.js";
import { HOURGLASS_ICON } from "../../icons/lucide/hourglass.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { MESSAGES_SQUARE_ICON } from "../../icons/lucide/messages-square.js";
import { MAXIMIZE_2_ICON } from "../../icons/lucide/maximize-2.js";
import { MINIMIZE_2_ICON } from "../../icons/lucide/minimize-2.js";
import { PENCIL_ICON } from "../../icons/lucide/pencil.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { attributeDiffPlaces } from "../shared/change-attribution.js";
import {
  AGENT_STALL_MS,
  agentHasEverConnected,
  deriveAgentHealth,
  deriveCurrentAgentActivity,
  type CurrentAgentActivity,
  heldWorkQuiet,
  projectAgentConnectionState,
  selectClaimedAgentRequest,
  type AgentStatus,
} from "../shared/agent-status.js";
import { selectAgentModelIdentity } from "../shared/agent-model.js";
import type { CommentTarget, ReviewComment } from "../shared/comment.js";
import { boundQuote, QUOTE_LIMIT } from "../shared/comment.js";
import { parseReviewerMarkdown } from "../shared/reviewer-markdown.js";
import { REVIEW_POLL_INTERVAL_MS } from "../shared/review-polling.js";
import { reconcilePendingCancellations } from "../shared/cancel-pending.js";
import { stackThreadPositions, threadLeft } from "../shared/thread-layout.js";
import { isRendered, measureThreadAnchor } from "./thread-anchor.browser.js";
import {
  clearThreadOpenOverlay,
  isThreadOpen,
  setThreadOpen,
  toggleThreadOpen,
  type ThreadKind,
  type ThreadOpenState,
  type ThreadSurface,
} from "../shared/thread-open-state.js";
import {
  projectCommentThreads,
  projectLatestAgentStatus,
  projectRequestActivity,
  projectRequestDelivery,
  projectRequestStatus,
  queuedRequestsAhead,
  requestCommentIds,
  selectOpenFeedbackBatches,
  selectThreadsAwaitingAgent,
  type CommentThreadProjection,
  type RequestDelivery,
  type ThreadGroup,
  type ThreadRuntime,
} from "../shared/thread-projection.js";
import {
  decodeAgentSnapshot as parseAgentSnapshot,
  decodeSnapshotDiff as parseSnapshotDiff,
  decodeProgress as parseProgress,
  decodeReviewSnapshot as parseSnapshot,
  decodeRuntimeSession as parseRuntimeSession,
  emptyAgentSnapshot,
  isReviewCommentValue as isComment,
  isReviewWireRecord as isRecord,
  STALE_REVIEW_STATE_CODE,
  type AgentRequest,
  type AgentResponse,
  type AgentSnapshot,
  type SnapshotDiff,
  type ProgressEvent,
  type ReviewSnapshot,
  type RuntimeSession,
  type StagedDecisionAnswer,
} from "../shared/review-wire.js";
import {
  AGENT_STATUS_LABEL,
  AGENT_STATUS_TRIGGER_ID,
  AgentStatusTrigger,
} from "./agent-status.browser.js";
import { AgentSurface } from "./agent-surface.browser.js";
import { ChatSurface } from "./chat-surface.browser.js";
import { InputsSurface } from "./inputs-surface.browser.js";
import {
  batchSectionTone,
  CommentsSurface,
  type CommentsSurfaceBatch,
} from "./comments-surface.browser.js";
import {
  AgentChangeDigest,
  MessageTurn,
  ReviewerMessagePreview,
  RequestStatusStrip,
  type MessageActivity,
  type MessageSurface,
} from "./agent-message.browser.js";
import { Icon } from "./icon.browser.js";
import { renderReviewerNode } from "./message-markdown-view.browser.js";
import { ComposeImages } from "./compose-images.browser.js";
import { InlineComments } from "./inline-comments.browser.js";
import {
  deriveReviewCommentSubmitAvailability,
  type ReviewCommentSubmitAvailability,
} from "./review-comment-submit.js";
import { useDiffTour } from "./diff-tour.browser.js";
import {
  displayedStandIn,
  foundElement,
  liveBlock,
  liveDecisionFigure,
  liveFlowAnchor,
  livePictures,
} from "./live-target.browser.js";
import {
  agentProjectionForReviewPoll,
  INITIAL_REVIEW_POLL_HEALTH,
  reviewPollIsOffline,
  reviewRuntimeAcceptsWrites,
  reviewRuntimeDownSinceMs,
  reviewRuntimeIsDown,
  transitionReviewPollHealth,
  type ReviewPollHealth,
  type ReviewPollResult,
} from "./review-poll-health.js";
import { reviewEndReason, type ReviewEndReason } from "./review-expiry.js";
import {
  reviewWriteAvailability,
  reviewWriteBlock,
  reviewWriteRefusal,
  type ReviewWriteAvailability,
} from "./review-write-availability.js";
import { RESOLVED_THREAD_NEW_WORK_ERROR } from "../shared/resolved-thread-work.js";
import {
  isReviewRuntimeRefusal,
  isReviewRuntimeUnavailable,
  isTerminalReviewRuntimeRefusal,
  reviewRuntimeRefusalStatus,
} from "./review-runtime-request.js";
import { createRuntimeSessionOrder } from "./runtime-session-order.js";
import {
  mergeLiveReviewRecovery,
  mergeReviewStateAfterHydration,
  refreshReviewRecoveryConflicts,
  repliesForSentComments,
  resolveReviewRecoveryConflict,
  resumeLiveReviewRecovery,
  reviewRecoveryBase,
  reviewRecoveryBaseAfterConflictAnswers,
} from "./review-recovery-merge.js";
import type {
  ReviewRecoveryBase,
  ReviewRecoveryConflict,
  ReviewRecoveryReconciliation,
  ReviewRecoveryState,
} from "./review-recovery-merge.js";
import {
  claimLiveRecoveryOwner,
  clearLiveReviewRecovery,
  EMPTY_RECOVERED_COMPOSER,
  mergeRecoveredComposerAfterHydration,
  persistedReviewFingerprint,
  readLiveReviewRecovery,
  writeLiveReviewRecovery,
  type RecoveredComposer,
  type StoredLiveReviewRecovery,
} from "./review-recovery-storage.browser.js";
import { useArticleVersion } from "./use-article-version.browser.js";
import {
  requestJson,
  runtimeIdentity,
  type RuntimeIdentity,
} from "./review-runtime-client.browser.js";
import { applyAnswersRecord } from "./answers-record.browser.js";
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Textarea,
  Toaster,
  Tooltip,
  toast,
  WorkingMark,
} from "./ui.browser.js";

const BODY_LIMIT = 4000;
const LONG_COMMENT = 180;
const PROSE_KINDS = new Set(["heading", "paragraph", "list", "blockquote"]);
const TABLE_PRECISION_KINDS = new Set([
  "table-cell",
  "table-column",
  "table-row",
]);
// Chrome the renderer derives from the plan's own structure rather than from
// anything an author wrote. There is no text here to change, so a comment on
// it could never be acted on; feedback belongs on the section it points to.
const DERIVED_KINDS = new Set(["table-of-contents"]);

type SentDeleteKind = "reverted" | "canceled" | "abandoned" | "queued";

/**
 * One sent thread's pending delete. `abandonedClaim` rides along because the
 * confirmation is what carries the full explanation, and a thread that is
 * reverted or canceled is confirmed under that wording while still owing the
 * reader why the control came back at all.
 */
type PendingSentDelete = {
  readonly kind: SentDeleteKind;
  readonly comment: ReviewComment;
  readonly abandonedClaim: boolean;
};

type PendingDelete =
  | { readonly kind: "comment"; readonly comment: ReviewComment }
  | PendingSentDelete
  | { readonly kind: "all"; readonly count: number };

const ABANDONED_CLAIM_REASON =
  "The agent that picked this up has reported nothing for far longer than a turn takes, and no agent is connected, so its claim has expired.";
const ABANDONED_CLAIM_CONSEQUENCE =
  "If that agent comes back, its answer will no longer be accepted.";

/**
 * Adds the abandonment explanation to a confirmation whose wording is chosen
 * by an earlier state. The reader is told why the control came back and what
 * happens if the agent returns, whichever wording the dialog is under.
 */
const withAbandonedClaimNote = ({
  description,
  abandonedClaim,
}: {
  readonly description: string;
  readonly abandonedClaim: boolean;
}): string =>
  abandonedClaim
    ? `${description} ${ABANDONED_CLAIM_REASON} ${ABANDONED_CLAIM_CONSEQUENCE}`
    : description;

/**
 * Which confirmation one sent thread's delete earns. A comment released by an
 * abandoned claim gets its own, because the queued wording promises the agent
 * never picked it up and here it did (BIG-120).
 */
const sentDeleteKind = ({
  thread,
  currentSnapshot,
}: {
  readonly thread: CommentThreadProjection<AgentRequest, AgentResponse>;
  readonly currentSnapshot: string;
}): SentDeleteKind =>
  thread.latestChanged?.baselineSnapshot === currentSnapshot
    ? "reverted"
    : thread.latestCanceled
      ? "canceled"
      : thread.deleteUnlockedByAbandonedClaim
        ? "abandoned"
        : "queued";

type PendingRevert = {
  readonly requestId: string;
  readonly commentId: string;
};

// The server owns the answer time and the digest of the decision that was
// answered, so a mutation carries neither.
type DecisionInputMutation =
  | {
      readonly op: "stage";
      readonly answer: Omit<
        StagedDecisionAnswer,
        "answeredAt" | "decisionDigest"
      >;
    }
  | { readonly op: "retract"; readonly decisionId: string };

/**
 * Whether this page may write to the review record. It starts unknown, because
 * the session response has not arrived yet, and that window is real: a confirm
 * made in it is held rather than guessed at, so it is neither posted from a
 * session that turns out to be read-only nor quietly demoted to a note in a
 * session that turns out to be writable.
 */
type ReviewAuthority = "unknown" | "writable" | "read-only";

type DecisionPersistenceState = "pending" | "saved" | "failed" | "reading";

type PendingDecisionInput = {
  readonly mutation: DecisionInputMutation;
  readonly failures: number;
};

type DecisionAnsweredDetail = {
  readonly decision: string;
  readonly question: string;
  readonly optionId: string;
  readonly option: string;
  readonly proposal: string;
};

const decisionInputId = (mutation: DecisionInputMutation): string =>
  mutation.op === "stage" ? mutation.answer.decisionId : mutation.decisionId;

const decisionToastId = (decisionId: string): string =>
  `decision-persistence-${decisionId}`;

type ExternalFeedbackItem = {
  readonly kind?: string;
  readonly anchor?: string;
  readonly field?: string;
  readonly before?: string;
  readonly after?: string;
  readonly body?: string;
  readonly reason?: string;
  readonly consequence?: string;
};

type ExternalFeedbackPayload = {
  readonly source: "flow-diagram" | "decision";
  readonly anchor?: string | null;
  readonly items: ReadonlyArray<ExternalFeedbackItem>;
  readonly submit?: "batch" | "now";
};

type BigPlanFeedbackWindow = Window & {
  bigPlan?: {
    feedback?: {
      // The id comes back so a component can hold on to the one comment it
      // raised, rather than raising a second one it cannot tell apart.
      readonly add: (payload: ExternalFeedbackPayload) => string | null;
    };
  };
};

type ComposeState = {
  readonly target: CommentTarget;
  readonly premiseSnapshot: string;
  readonly top: number;
  readonly left: number;
};

type SelectionControlState = {
  readonly target: Extract<CommentTarget, { readonly type: "selection" }>;
  readonly top: number;
  readonly left: number;
};

type FeedbackTab = "comments" | "chat" | "inputs";
// Inputs is a live-runtime tab because its whole content is the runtime's
// derived contract; a document opened without one has nothing to show there.
const LIVE_FEEDBACK_TABS: ReadonlyArray<FeedbackTab> = [
  "comments",
  "chat",
  "inputs",
];
const STATIC_FEEDBACK_TABS: ReadonlyArray<FeedbackTab> = ["comments", "chat"];

/**
 * Which body the one fixed sidebar is showing. Diagnosis replaces the feedback
 * it would otherwise block rather than adding a surface beside it, so these are
 * alternatives in one slot. Each toolbar control owns its own view: pressing
 * the pressed one closes the sidebar, and neither ever opens the other's body.
 */
type SidebarView = "feedback" | "agent";

/** Closing the feedback sidebar has to put focus back here, from wherever it closed. */
const FEEDBACK_TRIGGER_ID = "review-feedback-trigger";

/*
Every state's badge is written copy, because the badge is user-facing and a
state name is not. The record is exhaustive over the union, so a state added
later has to be given words here rather than leaking its identifier - which is
how "offline" and "errored" came to sit in lowercase beside "Offline".
*/
const AGENT_STATE_BADGE_LABEL: Record<CurrentAgentActivity["state"], string> = {
  working: "Working",
  waiting: "Queued",
  stalled: "Warning",
  errored: "Error",
  disconnected: "Offline",
  offline: "Unreachable",
  idle: "Connected",
  "never-connected": "",
};

// Both toolbar controls read as buttons rather than links: a transparent
// ground with a real border at rest, and a pressed ground when their view is
// open. The pressed look is neutral, not accent - it says "this is the open
// one", which is not the kind of thing that should shout in colour.
const TOOLBAR_CONTROL_CLASS =
  "inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border border-edge bg-transparent px-2 py-1 text-xs text-muted shadow-none hover:border-edge-strong hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:inset-shadow-pressed aria-expanded:border-edge-strong aria-expanded:bg-raised aria-expanded:text-ink aria-expanded:inset-shadow-pressed wide:min-h-8";
const FEEDBACK_TAB_CLASS =
  "relative inline-flex min-h-8 min-w-0 cursor-pointer items-center justify-start gap-1.5 rounded-none border-0 bg-transparent px-2 py-1.5 text-xs font-semibold text-muted after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-transparent after:content-[''] hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent aria-selected:text-ink aria-selected:after:bg-accent max-sm:text-2xs [&>svg]:size-3.5 [&>svg]:shrink-0 [&>span]:min-w-5 [&>span]:justify-center [&>span]:bg-[var(--annotation-bg)] [&>span]:text-2xs [&>span]:text-[var(--annotation-c)]";
const WIDE_QUERY = "(min-width: 80rem)";
const MODIFIER_SHORTCUT = /Mac|iPhone|iPad/u.test(navigator.platform)
  ? "⌘+Enter"
  : "Ctrl+Enter";
const APPLE_PLATFORM = /Mac|iPhone|iPad/u.test(navigator.platform);
const NEW_COMMENT_SHORTCUT = APPLE_PLATFORM ? "⌃+⌘+C" : "Ctrl+Alt+C";
const isNewCommentShortcut = (event: globalThis.KeyboardEvent): boolean =>
  event.key.toLocaleLowerCase() === "c" &&
  (APPLE_PLATFORM
    ? event.ctrlKey && event.metaKey && !event.altKey
    : event.ctrlKey && event.altKey && !event.metaKey);
type StagedCardSurface = "rail" | "thread";
type UnsavedInputChange = (key: string, hasUnsavedInput: boolean) => void;
type SelectionTarget = Extract<CommentTarget, { readonly type: "selection" }>;

type FloatingRect = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

type FloatingPosition = {
  readonly top: number;
  readonly left: number;
};

const rootElement = document.documentElement;

/**
 * True while a first-class component is still batching feedback notes of its
 * own. A diagram collects notes locally and hands them over only when the
 * reviewer submits the batch from the diagram itself, so the review island
 * cannot be told about them; it watches for the one marker the diagram paints
 * per commented element, skipping snapshot copies inside a What-changed lens.
 */
const hasComponentBatchNotes = (): boolean =>
  Array.from(
    document.querySelectorAll<HTMLElement>("[data-flow-comment-marker]"),
  ).some((marker) => marker.closest("[data-review-diff-lens]") === null);

// Watches the document for component-batched notes while the Comments tab is
// visible, so the tab can explain where those notes are submitted from.
const useComponentBatchNotes = (isWatching: boolean): boolean => {
  const [hasNotes, setHasNotes] = useState(false);
  useEffect(() => {
    if (!isWatching) return undefined;
    let frame = 0;
    const measure = () => setHasNotes(hasComponentBatchNotes());
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [isWatching]);
  return isWatching && hasNotes;
};

const ThreadIconButton = ({
  label,
  icon,
  onClick,
  disabled = false,
  tone = "neutral",
}: {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly tone?: "danger" | "neutral" | "positive";
}) => {
  const hoverClass =
    tone === "danger"
      ? "hover:border-danger hover:bg-[var(--callout-danger-bg)] hover:text-danger hover:shadow-raised focus-visible:border-danger focus-visible:bg-[var(--callout-danger-bg)] focus-visible:text-danger"
      : tone === "positive"
        ? "hover:border-accent hover:bg-accent-wash hover:text-accent hover:shadow-raised focus-visible:border-accent focus-visible:bg-accent-wash focus-visible:text-accent"
        : "hover:bg-surface hover:text-ink hover:shadow-raised focus-visible:bg-surface focus-visible:text-ink";
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={`inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent p-0 leading-none text-muted transition-[color,background-color,border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent active:inset-shadow-pressed disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:text-subtle disabled:shadow-none [&>svg]:size-3.5 ${hoverClass}`}
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
      >
        <Icon icon={icon} />
      </button>
    </Tooltip>
  );
};

/** Finds the initial viewport slot for a document-anchored composer. */
const floatingComposerPosition = ({
  preferred,
  width,
  height,
  obstacles,
  chrome,
}: {
  readonly preferred: FloatingPosition;
  readonly width: number;
  readonly height: number;
  readonly obstacles: ReadonlyArray<FloatingRect>;
  /** Fixed bars painted above the composer, which no slot may sit under. */
  readonly chrome: ReadonlyArray<FloatingRect>;
}): FloatingPosition => {
  const edge = 24;
  const gap = 12;
  const left = Math.max(
    edge,
    Math.min(preferred.left, window.innerWidth - width - edge),
  );
  // The viewport's own top is not the first free pixel: fixed chrome sits
  // above it, so the floor is whichever is lower - the reading edge, or the
  // bottom of the chrome that would otherwise cover the composer.
  //
  // Only chrome raises the floor. Every other obstacle is scored by actual
  // overlap, so a tall thread near the top would otherwise push a composer
  // below it even when the two never meet horizontally.
  const chromeBottom = chrome.reduce(
    (lowest, bar) => Math.max(lowest, bar.bottom + gap),
    edge,
  );
  const clampTop = (top: number) =>
    Math.max(chromeBottom, Math.min(top, window.innerHeight - height - edge));
  const candidates = [
    clampTop(preferred.top),
    ...obstacles.flatMap((obstacle) => [
      clampTop(obstacle.bottom + gap),
      clampTop(obstacle.top - height - gap),
    ]),
  ];
  const score = (top: number) => {
    const right = left + width;
    const bottom = top + height;
    return obstacles.reduce((total, obstacle) => {
      const overlapWidth = Math.max(
        0,
        Math.min(right, obstacle.right + gap) -
          Math.max(left, obstacle.left - gap),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(bottom, obstacle.bottom + gap) -
          Math.max(top, obstacle.top - gap),
      );
      return total + overlapWidth * overlapHeight;
    }, 0);
  };
  const top = candidates.reduce((best, candidate) => {
    const candidateScore = score(candidate);
    const bestScore = score(best);
    if (candidateScore !== bestScore)
      return candidateScore < bestScore ? candidate : best;
    return Math.abs(candidate - preferred.top) < Math.abs(best - preferred.top)
      ? candidate
      : best;
  });
  return { top, left };
};

/** Formats the compact freshness label used by contextual thread cards. */
const threadTime = (createdAt: string): string => {
  const elapsed = Math.max(0, Date.now() - Date.parse(createdAt));
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000)
    return `${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 2_592_000_000)
    return `${Math.floor(elapsed / 86_400_000)}d ago`;
  if (elapsed < 31_536_000_000)
    return `${Math.floor(elapsed / 2_592_000_000)}mo ago`;
  return `${Math.floor(elapsed / 31_536_000_000)}y ago`;
};

const bootstrapSnapshot = (): string => {
  try {
    const value: unknown = JSON.parse(
      rootElement.getAttribute("data-review-bootstrap") ?? "{}",
    );
    return isRecord(value) && typeof value.currentSnapshot === "string"
      ? value.currentSnapshot
      : "";
  } catch {
    return "";
  }
};

const localStorageKey = (planId: string): string =>
  `big-plan:review:drafts:${planId}`;

const archivedChatStorageKey = (planId: string): string =>
  `big-plan:review:archived-chat:${planId}`;

const readArchivedChatRequestIds = (planId: string): ReadonlySet<string> => {
  try {
    const raw = localStorage.getItem(archivedChatStorageKey(planId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
};

const writeArchivedChatRequestIds = (
  planId: string,
  requestIds: ReadonlySet<string>,
): void => {
  try {
    localStorage.setItem(
      archivedChatStorageKey(planId),
      JSON.stringify([...requestIds]),
    );
  } catch {
    // Browser-only presentation preferences are best effort.
  }
};

const readLocalDrafts = (planId: string): ReadonlyArray<ReviewComment> => {
  try {
    const raw = localStorage.getItem(localStorageKey(planId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isComment) : [];
  } catch {
    return [];
  }
};

const writeLocalDrafts = (
  planId: string,
  drafts: ReadonlyArray<ReviewComment>,
): void => {
  try {
    localStorage.setItem(localStorageKey(planId), JSON.stringify(drafts));
  } catch {
    // Offline browser persistence is best effort; visible status stays honest.
  }
};

const sameReviewComment = (
  left: ReviewComment,
  right: ReviewComment,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const STALE_SUBMISSION_STATUS =
  "The review changed before submission. Review the latest comments and send again.";
const RECOVERY_CONFLICT_STATUS = "Two versions of a comment need your choice.";

/**
 * An unresolved conflict pauses reviewer-state writes, but the pause itself is
 * not permission to raise the conflict prompt: only a reviewer-initiated write
 * may answer this rejection by opening it, while background persistence lets
 * it pass silently.
 */
class RecoveryConflictPauseError extends Error {
  constructor() {
    super(RECOVERY_CONFLICT_STATUS);
    this.name = "RecoveryConflictPauseError";
  }
}

const isRecoveryConflictPause = (error: unknown): boolean =>
  error instanceof RecoveryConflictPauseError;
const RECOVERED_TEXT_COPY_FAILED_STATUS =
  "The recovered comment text could not be copied. Select and copy it from the notice.";
const LIVE_RECOVERY_UNAVAILABLE_STATUS =
  "Browser recovery is unavailable. The live review remains usable, but browser-only drafts cannot be recovered after a reload.";

const emptyReviewRecoveryReconciliation = (): ReviewRecoveryReconciliation => ({
  base: { draftBodies: new Map(), resolvedCommentIds: new Set() },
  conflicts: [],
  runtime: null,
});

/** Places the composer beside its target, at a vertical position it is given. */
const composePlacement = ({
  target,
  top,
}: {
  readonly target: CommentTarget;
  readonly top: number;
}): { readonly top: number; readonly left: number } => {
  const targetRect = targetElement(target)?.getBoundingClientRect();
  const composerWidth = 17 * 16;
  const edge = 24;
  const overlap = 12;
  const viewportWidth = document.documentElement.clientWidth;
  return {
    top: window.scrollY + Math.max(56, Math.min(top, window.innerHeight - 360)),
    left: Math.max(
      edge + window.scrollX,
      Math.min(
        (targetRect?.right ?? viewportWidth) + window.scrollX - overlap,
        window.scrollX + viewportWidth - composerWidth - edge,
      ),
    ),
  };
};

/**
 * The one place a merge cannot decide: this comment was changed here and in
 * the review session while the two were apart. Both versions are shown, and
 * neither is applied until the reviewer says which one to keep.
 */
const RecoveryConflictDialog = ({
  conflict,
  onKeep,
  onDismiss,
}: {
  readonly conflict: ReviewRecoveryConflict | undefined;
  readonly onKeep: (keep: "local" | "runtime") => void;
  readonly onDismiss: () => void;
}) => {
  if (conflict === undefined) return null;
  const description =
    conflict.kind === "resolution"
      ? `This thread was ${conflict.localResolved ? "resolved" : "unresolved"} in the recovered review and ${conflict.runtimeResolved ? "resolved" : "unresolved"} in the review session. Keep one state.`
      : conflict.kind === "sent"
        ? "This comment was sent in the review session while you kept editing it here. Keep the submitted version, or stage your edit as new feedback."
        : conflict.runtimeBody === null
          ? "You changed this comment here, and it was deleted in the review session. Keep your version, or let the deletion stand."
          : conflict.localBody === null
            ? "You deleted this comment here, and it was changed in the review session. Keep the deletion, or take the version from the review session."
            : "This comment was changed here and in the review session while the two were apart. Keep one of them.";
  return (
    <AlertDialog
      open
      tone="neutral"
      title="Two versions of this comment"
      description={description}
      cancelLabel={
        conflict.kind === "resolution"
          ? `Keep ${conflict.localResolved ? "resolved" : "unresolved"}`
          : conflict.kind === "sent"
            ? "Stage mine as new feedback"
            : conflict.localBody === null
              ? "Keep the deletion"
              : "Keep mine"
      }
      actionLabel={
        conflict.kind === "resolution"
          ? "Use the review session's state"
          : conflict.kind === "sent"
            ? "Keep submitted version"
            : conflict.runtimeBody === null
              ? "Delete it"
              : "Use the review session's version"
      }
      onCancel={() => onKeep("local")}
      onAction={() => onKeep("runtime")}
      onDismiss={onDismiss}
    >
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3">
        <div>
          <p className="m-0 text-2xs font-semibold text-subtle uppercase">
            Yours
          </p>
          <p className="m-0 mt-1 border border-edge bg-surface p-2 text-sm text-ink [overflow-wrap:anywhere]">
            {conflict.kind === "resolution"
              ? conflict.localResolved
                ? "Resolved"
                : "Unresolved"
              : (conflict.localBody ?? "Deleted here.")}
          </p>
        </div>
        <div>
          <p className="m-0 text-2xs font-semibold text-subtle uppercase">
            {conflict.kind === "sent"
              ? "Submitted in the review session"
              : "In the review session"}
          </p>
          <p className="m-0 mt-1 border border-edge bg-surface p-2 text-sm text-ink [overflow-wrap:anywhere]">
            {conflict.kind === "resolution"
              ? conflict.runtimeResolved
                ? "Resolved"
                : "Unresolved"
              : (conflict.runtimeBody ?? "Deleted there.")}
          </p>
        </div>
      </div>
    </AlertDialog>
  );
};

/**
 * The one place a runtime failure interrupts reading, whatever the failure.
 * Its action and link are independent and may appear together.
 */
const RuntimeAlertBanner = ({
  scope,
  heading,
  detail,
  link,
  action,
}: {
  readonly scope: string;
  readonly heading: string;
  readonly detail: string;
  readonly link?: {
    readonly href: string;
    readonly label: string;
  };
  readonly action?: {
    readonly label: string;
    readonly onAct: () => void;
    readonly enabled: boolean;
  };
}) => (
  <div
    className="fixed top-14 right-3 left-3 z-50 mx-auto flex max-w-2xl min-w-0 flex-wrap items-start gap-3 rounded-lg border border-[var(--callout-danger-c)] bg-[var(--callout-danger-bg)] p-3 text-sm text-[var(--callout-danger-c)] shadow-floating"
    role="alert"
    aria-live="assertive"
    {...{ [scope]: "" }}
  >
    <Icon icon={CIRCLE_X_ICON} />
    <div className="min-w-0 flex-1">
      <strong className="block text-ink">{heading}</strong>
      <p className="m-0 mt-1 text-xs text-ink [overflow-wrap:anywhere]">
        {detail}
      </p>
    </div>
    {link === undefined && action === undefined ? null : (
      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 max-sm:basis-full">
        {link === undefined ? null : (
          <a
            className="shrink-0 rounded-md border border-[var(--callout-danger-c)] bg-transparent px-2 py-1 text-xs font-semibold text-[var(--callout-danger-c)] hover:bg-[var(--callout-danger-c)] hover:text-[var(--callout-danger-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
          </a>
        )}
        {action === undefined ? null : (
          <button
            type="button"
            className="shrink-0 cursor-pointer rounded-md border border-[var(--callout-danger-c)] bg-transparent px-2 py-1 text-xs font-semibold text-[var(--callout-danger-c)] hover:bg-[var(--callout-danger-c)] hover:text-[var(--callout-danger-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-[var(--callout-danger-c)]"
            onClick={action.onAct}
            disabled={!action.enabled}
          >
            {action.label}
          </button>
        )}
      </div>
    )}
  </div>
);

// The page says only what this tab can defend: it lost contact and, when known,
// the deadline it last received has passed. Recovery stays non-destructive
// because starting a runtime seizes custody and could make a live review and
// its agent read-only, so this banner never proposes it.
const ServerGoneBanner = ({
  canRefresh,
  onRefresh,
  endReason,
  latestReviewUrl,
}: {
  readonly canRefresh: boolean;
  readonly onRefresh: () => void;
  readonly endReason: ReviewEndReason;
  readonly latestReviewUrl: string | undefined;
}) => {
  const unsavedInputWarning = canRefresh
    ? ""
    : " Keep this tab open because the latest review input has not reached the local review server.";
  const refreshAction = {
    label: "Refresh",
    onAct: onRefresh,
    enabled: canRefresh,
  };
  const replacementLink =
    latestReviewUrl === undefined
      ? undefined
      : { href: latestReviewUrl, label: "Open latest review" };
  const contactDetail =
    endReason.kind === "deadline-passed"
      ? `The deadline this tab last knew has since passed.${
          replacementLink === undefined
            ? " Refresh to try reconnecting."
            : " A newer review session for this plan was recorded at the linked address."
        }`
      : "This tab lost contact with the local review server. Refresh to try reconnecting.";
  return (
    <RuntimeAlertBanner
      scope="data-review-server-gone"
      heading="This tab lost contact with this review session"
      detail={`${contactDetail}${unsavedInputWarning} This is separate from the agent connection.`}
      action={refreshAction}
      {...(replacementLink === undefined ? {} : { link: replacementLink })}
    />
  );
};

// The failure this exists for answers reads perfectly: the server is up, so
// nothing else on the page looks wrong, and a reviewer would keep writing
// comments that can no longer be saved. Refreshing cannot help, because the
// runtime itself has to be restarted.
const WritesStalledBanner = () => (
  <RuntimeAlertBanner
    scope="data-review-writes-stalled"
    heading="This review session has stopped accepting changes"
    detail="The local review server is still answering, but a change it started never finished, so nothing new can be saved. Keep this tab open, then stop the review runtime and start it again on this plan to continue."
  />
);

type CachedSnapshotDiff =
  | { readonly state: "pending"; readonly value: Promise<SnapshotDiff> }
  | { readonly state: "ready"; readonly value: SnapshotDiff };
const snapshotDiffCache = new Map<string, CachedSnapshotDiff>();

const snapshotDiffKey = (
  identity: RuntimeIdentity,
  from: string,
  to: string,
): string => `${identity.planId}:${identity.sessionId}:${from}:${to}`;

const cachedSnapshotDiff = (
  identity: RuntimeIdentity,
  from: string,
  to: string,
): Promise<SnapshotDiff> => {
  const key = snapshotDiffKey(identity, from, to);
  const cached = snapshotDiffCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached.value);
  const pending = requestJson({
    path: `/api/snapshot-diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    identity,
  })
    .then((value) => {
      const parsed = parseSnapshotDiff(value);
      if (parsed === null) throw new Error("The snapshot diff is unavailable");
      snapshotDiffCache.set(key, { state: "ready", value: parsed });
      return parsed;
    })
    .catch((error: unknown) => {
      snapshotDiffCache.delete(key);
      throw error;
    });
  snapshotDiffCache.set(key, { state: "pending", value: pending });
  return pending;
};

const readySnapshotDiff = (
  identity: RuntimeIdentity,
  from: string,
  to: string,
): SnapshotDiff | null => {
  const cached = snapshotDiffCache.get(snapshotDiffKey(identity, from, to));
  return cached?.state === "ready" ? cached.value : null;
};

const randomId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
};

const blockIdentity = (block: HTMLElement) => ({
  blockId: block.dataset.blockId ?? "",
  kind: block.dataset.blockKind ?? "block",
  label: block.dataset.blockLabel ?? "This block",
  ...(block.dataset.blockSection === undefined
    ? {}
    : { section: block.dataset.blockSection }),
});

const targetForBlock = (
  block: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> => ({
  type: "block",
  ...blockIdentity(block),
});

const targetForSlide = (
  slide: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> | null => {
  const firstBlock = slide.querySelector<HTMLElement>("[data-block-id]");
  if (firstBlock === null) {
    return null;
  }
  return {
    type: "block",
    ...blockIdentity(firstBlock),
    kind: "slide",
    label:
      firstBlock.dataset.blockSection ??
      firstBlock.dataset.blockLabel ??
      "Slide",
  };
};

const targetForReviewContainer = (
  container: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> | null =>
  container.matches("[data-quick-summary]")
    ? targetForBlock(container)
    : targetForSlide(container);

const targetLabel = (
  target: CommentTarget,
  includeSlideReference = false,
): string => {
  let label: string;
  if (target.type === "document") label = "Whole plan";
  else if (target.type === "selection")
    label = `Selected text${
      target.imageBlockIds === undefined || target.imageBlockIds.length === 0
        ? ""
        : " and image"
    } in ${target.label}`;
  else if (target.kind === "table" || target.kind === "data-table")
    label = [target.section, "Table"].filter(Boolean).join(" · ");
  else label = target.label;

  if (!includeSlideReference || target.type === "document") return label;
  const directContainer = targetElement(target)?.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  const reviewContainer =
    directContainer ??
    (target.section === undefined
      ? null
      : (Array.from(
          document.querySelectorAll<HTMLElement>("[data-slide]"),
        ).find((slide) => {
          const heading = slide
            .querySelector<HTMLElement>(
              ":scope > [data-collapse-header] h2, :scope > [data-collapse-header] h3",
            )
            ?.textContent?.trim();
          return heading === target.section;
        }) ?? null));
  if (reviewContainer?.matches("[data-quick-summary]") === true) {
    return "Quick summary";
  }
  const kicker = reviewContainer
    ?.querySelector<HTMLElement>("[data-slide-kicker]")
    ?.textContent?.trim();
  const slideReference = kicker?.match(/^(\d+(?:\.\d+)*)\s*\//u)?.[1];
  const slideTitle = reviewContainer
    ?.querySelector<HTMLElement>(
      ":scope > [data-collapse-header] h2, :scope > [data-collapse-header] h3",
    )
    ?.textContent?.trim();
  if (slideTitle === undefined || slideTitle === "") return label;
  const combinedSubSlideTitle =
    slideReference === undefined
      ? undefined
      : slideTitle.match(/^(\d+(?:\.\d+)*)\s*\/\s*(.+)$/u);
  const combinedReference = combinedSubSlideTitle?.[1];
  const combinedTitle = combinedSubSlideTitle?.[2];
  if (combinedReference === slideReference && combinedTitle !== undefined) {
    return `${slideReference} · ${combinedTitle}`;
  }
  return slideReference === undefined
    ? slideTitle
    : `${slideReference} · ${slideTitle}`;
};

const parentElementFor = (node: Node): Element | null =>
  node instanceof Element ? node : node.parentElement;

const SELECTION_BLOCK_SELECTOR =
  '[data-block-id]:not([data-block-kind="part"])';

const selectionBoundaryBlock = ({
  container,
  offset,
  edge,
}: {
  readonly container: Node;
  readonly offset: number;
  readonly edge: "start" | "end";
}): HTMLElement | null => {
  const direct = parentElementFor(container)?.closest<HTMLElement>(
    SELECTION_BLOCK_SELECTOR,
  );
  if (direct !== null && direct !== undefined) return direct;
  if (!(container instanceof Element) || container.childNodes.length === 0) {
    return null;
  }
  const childIndex =
    edge === "start"
      ? Math.min(offset, container.childNodes.length - 1)
      : Math.max(0, Math.min(offset - 1, container.childNodes.length - 1));
  const child = container.childNodes[childIndex];
  if (child === undefined) return null;
  const childElement = parentElementFor(child);
  if (childElement?.matches(SELECTION_BLOCK_SELECTOR) === true) {
    return childElement as HTMLElement;
  }
  const descendants = Array.from(
    childElement?.querySelectorAll<HTMLElement>(SELECTION_BLOCK_SELECTOR) ?? [],
  );
  return edge === "start"
    ? (descendants[0] ?? null)
    : (descendants.at(-1) ?? null);
};

const selectionOffsetWithin = ({
  block,
  container,
  offset,
  edge,
}: {
  readonly block: HTMLElement;
  readonly container: Node;
  readonly offset: number;
  readonly edge: "start" | "end";
}): number => {
  if (block !== container && !block.contains(container)) {
    return edge === "start" ? 0 : (block.textContent?.length ?? 0);
  }
  const before = document.createRange();
  before.selectNodeContents(block);
  if (edge === "start") before.setEnd(container, offset);
  else before.setEnd(container, offset);
  return before.toString().length;
};

const authoredImagesIntersecting = (range: Range): ReadonlyArray<HTMLElement> =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-block-kind="image"][data-authored-prose]',
    ),
  ).filter((image) => {
    try {
      return range.intersectsNode(image);
    } catch {
      return false;
    }
  });

const selectionRect = (
  range: Range,
  images: ReadonlyArray<HTMLElement>,
): DOMRect => {
  const rects = [
    range.getBoundingClientRect(),
    ...images.map((image) => image.getBoundingClientRect()),
  ];
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
};

const selectionControlState = (): SelectionControlState | null => {
  const selection = window.getSelection();
  if (
    selection === null ||
    selection.rangeCount !== 1 ||
    selection.isCollapsed
  ) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const startBlock = selectionBoundaryBlock({
    container: range.startContainer,
    offset: range.startOffset,
    edge: "start",
  });
  const endBlock = selectionBoundaryBlock({
    container: range.endContainer,
    offset: range.endOffset,
    edge: "end",
  });
  const startReviewContainer = startBlock?.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  const endReviewContainer = endBlock?.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  if (
    startBlock == null ||
    endBlock == null ||
    (startBlock !== endBlock &&
      (startReviewContainer == null ||
        startReviewContainer !== endReviewContainer)) ||
    startBlock.closest("#big-plan-review-root") !== null
  ) {
    return null;
  }
  const images = authoredImagesIntersecting(range);
  const text = selection.toString();
  const imageEvidence = images
    .map((image) => `[Image: ${image.dataset.blockLabel ?? "Image"}]`)
    .join("\n");
  const selected = [text, imageEvidence]
    .filter((part) => part.trim() !== "")
    .join("\n");
  if (selected.trim() === "") return null;
  // Length never withdraws the affordance. The block and offsets below are the
  // address of the highlight; the quote is only the copy carried into the
  // agent's brief, so an outsized selection keeps its whole range and stores a
  // marked excerpt instead of being dropped without telling the reviewer.
  const { quote, isQuoteExcerpt } = boundQuote(selected);
  const start = selectionOffsetWithin({
    block: startBlock,
    container: range.startContainer,
    offset: range.startOffset,
    edge: "start",
  });
  const end = selectionOffsetWithin({
    block: endBlock,
    container: range.endContainer,
    offset: range.endOffset,
    edge: "end",
  });
  const rect = selectionRect(range, images);
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    target: {
      type: "selection",
      ...blockIdentity(startBlock),
      ...(startBlock === endBlock
        ? {}
        : { endBlockId: endBlock.dataset.blockId ?? "" }),
      ...(images.length === 0
        ? {}
        : {
            imageBlockIds: images
              .map((image) => image.dataset.blockId)
              .filter((id): id is string => id !== undefined),
          }),
      start,
      end,
      quote,
      isQuoteExcerpt,
    },
    top: Math.max(8, rect.top - 44),
    left: Math.max(8, Math.min(window.innerWidth - 132, rect.left)),
  };
};

const blockCommentLabel = (block: HTMLElement): string =>
  block.dataset.blockKind === "code" ||
  block.dataset.blockKind?.startsWith("code-") === true
    ? "Comment on this code snippet"
    : `Comment on ${block.dataset.blockLabel ?? "this component"}`;

const selectionCommentLabel = (target: SelectionTarget): string =>
  `Comment on selected text${
    target.imageBlockIds === undefined || target.imageBlockIds.length === 0
      ? ""
      : " and image"
  }`;

// Decoration, geometry, and containment callers treat an absent target as a
// no-op, so this keeps the nullable shape while the resolver owns the query.
// The callers that owe the reader an explanation when a target is gone say so
// themselves; jumpTo is the one that does.
const targetElement = (target: CommentTarget): HTMLElement | null => {
  if (target.type === "document") return document.querySelector("main");
  const block = foundElement(liveBlock(target.blockId));
  return target.type === "block" && target.kind === "slide"
    ? (block?.closest<HTMLElement>("[data-slide]") ?? block)
    : block;
};

const targetAssociationElements = (
  target: CommentTarget,
): ReadonlySet<HTMLElement> => {
  const element = targetElement(target);
  if (element === null) return new Set();
  const isImageTarget = target.type === "block" && target.kind === "image";
  if (
    target.type === "block" &&
    !isImageTarget &&
    element.matches("[data-authored-prose]")
  ) {
    return new Set();
  }
  const owningContainer = element.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  const elements = new Set<HTMLElement>();
  if (
    target.type !== "selection" &&
    !(
      element.matches("[data-authored-prose]") &&
      owningContainer !== null &&
      !isImageTarget
    )
  ) {
    elements.add(element);
  }
  if (target.type === "selection") {
    for (const imageId of target.imageBlockIds ?? []) {
      const image = foundElement(liveBlock(imageId));
      if (image !== null) elements.add(image);
    }
  }
  if (owningContainer !== null) elements.add(owningContainer);
  return elements;
};

const targetAddress = (target: CommentTarget): string => {
  if (target.type === "document") return "document";
  if (target.type === "selection") {
    return `selection:${target.blockId}:${target.start}:${target.endBlockId ?? target.blockId}:${target.end}`;
  }
  return `block:${target.blockId}`;
};

type HighlightRegistry = {
  set(name: string, value: unknown): void;
  delete(name: string): void;
};

const selectionRange = (
  target: Extract<CommentTarget, { readonly type: "selection" }>,
): Range | null => {
  const startBlock = targetElement(target);
  const endBlock =
    target.endBlockId === undefined
      ? startBlock
      : foundElement(liveBlock(target.endBlockId));
  if (startBlock === null || endBlock === null) return null;
  const textPoint = (
    block: HTMLElement,
    targetOffset: number,
  ): { readonly node: Text; readonly offset: number } | null => {
    if (targetOffset < 0) return null;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let node = walker.nextNode();
    while (node !== null) {
      if (!(node instanceof Text)) {
        node = walker.nextNode();
        continue;
      }
      const length = node.data.length;
      if (targetOffset <= consumed + length) {
        return { node, offset: Math.max(0, targetOffset - consumed) };
      }
      consumed += length;
      node = walker.nextNode();
    }
    return null;
  };
  const start = textPoint(startBlock, target.start);
  const end = textPoint(endBlock, target.end);
  if (start === null || end === null) return null;
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
};

const selectionTargetResolves = (target: SelectionTarget): boolean => {
  const range = selectionRange(target);
  if (range === null) return false;
  const images: Array<HTMLElement> = [];
  for (const imageId of target.imageBlockIds ?? []) {
    const image = foundElement(liveBlock(imageId));
    if (
      image === null ||
      image.dataset.blockKind !== "image" ||
      !range.intersectsNode(image)
    ) {
      return false;
    }
    images.push(image);
  }
  const imageEvidence = images
    .map((image) => `[Image: ${image.dataset.blockLabel ?? "Image"}]`)
    .join("\n");
  const selected = [range.toString(), imageEvidence]
    .filter((part) => part.trim() !== "")
    .join("\n");
  return target.isQuoteExcerpt
    ? selected.startsWith(target.quote)
    : selected === target.quote;
};

const targetHighlightRange = (target: CommentTarget): Range | null => {
  if (target.type === "selection") return selectionRange(target);
  if (target.type !== "block") return null;
  const element = targetElement(target);
  if (element === null || !element.matches("[data-authored-prose]")) {
    return null;
  }
  const range = document.createRange();
  if (target.kind === "image") {
    range.selectNode(element);
  } else {
    range.selectNodeContents(element);
  }
  return range;
};

const setSelectionHighlights = (
  targets: ReadonlyArray<SelectionTarget>,
  activeTarget: CommentTarget | null,
): void => {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry })
    .highlights;
  registry?.delete("big-plan-review-selection");
  registry?.delete("big-plan-review-selection-active");
  const HighlightClass = (
    window as unknown as {
      Highlight?: new (...ranges: ReadonlyArray<Range>) => unknown;
    }
  ).Highlight;
  if (registry === undefined || HighlightClass === undefined) return;
  const ranges = targets
    .map((target) => selectionRange(target))
    .filter((range): range is Range => range !== null);
  if (ranges.length > 0)
    registry.set("big-plan-review-selection", new HighlightClass(...ranges));
  const activeRange =
    activeTarget === null ? null : targetHighlightRange(activeTarget);
  if (activeRange !== null)
    registry.set(
      "big-plan-review-selection-active",
      new HighlightClass(activeRange),
    );
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

const parseDecisionAnsweredDetail = (
  value: unknown,
): DecisionAnsweredDetail | null =>
  isRecord(value) &&
  typeof value.decision === "string" &&
  typeof value.question === "string" &&
  typeof value.optionId === "string" &&
  typeof value.option === "string" &&
  typeof value.proposal === "string"
    ? {
        decision: value.decision,
        question: value.question,
        optionId: value.optionId,
        option: value.option,
        proposal: value.proposal,
      }
    : null;

// The only place plan DOM is replaced. Swapping the article detaches every
// node the shell scripts wired at load, so the swap and its announcement stay
// one ritual: replace the reading surface, then dispatch
// "bigplan:article-replaced" so each shell script re-wires the live article.
const replacePlanArticle = (nextDocument: Document): void => {
  const nextArticle = nextDocument.querySelector("article");
  const currentArticle = document.querySelector("article");
  if (nextArticle === null || currentArticle === null) {
    throw new Error("The revised plan did not contain its reading surface");
  }
  currentArticle.replaceWith(document.importNode(nextArticle, true));
  document.dispatchEvent(new CustomEvent("bigplan:article-replaced"));
};

const MarkdownBody = ({
  body,
  className = "",
}: {
  readonly body: string;
  readonly className?: string;
}) => (
  <div className={className}>
    {parseReviewerMarkdown(body).map((node, index) =>
      renderReviewerNode(node, String(index)),
    )}
  </div>
);

/** Finds chrome owned by one block without borrowing controls from a nested block. */
const ownedDescendant = (
  block: HTMLElement,
  selector: string,
): HTMLElement | null =>
  Array.from(block.querySelectorAll<HTMLElement>(selector)).find(
    (element) => element.closest<HTMLElement>("[data-block-id]") === block,
  ) ?? null;

// A comment control that stands alone - floating beside a card, hovering over
// a block, or sitting by itself in a component header - rests at the quieter
// comment-rest colour. Only a control mounted beside other controls in a real
// control bar keeps the shared muted control colour.
const isStandaloneCommentHost = (host: HTMLElement): boolean =>
  host.dataset.reviewToolbarHost === undefined ||
  host.dataset.reviewToolbarInline !== undefined ||
  host.dataset.reviewToolbarOverlay !== undefined;

const useBlockHosts = () => {
  const [hosts, setHosts] = useState<
    ReadonlyArray<{
      readonly block: HTMLElement;
      readonly host: HTMLSpanElement;
    }>
  >([]);
  useEffect(() => {
    const mount = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-block-id]:not([data-block-kind="part"])',
        ),
      )
        .filter(
          (block) =>
            block.dataset.blockKind !== "image" &&
            !PROSE_KINDS.has(block.dataset.blockKind ?? "") &&
            !TABLE_PRECISION_KINDS.has(block.dataset.blockKind ?? "") &&
            !DERIVED_KINDS.has(block.dataset.blockKind ?? "") &&
            block.closest("[data-quick-summary]") === null &&
            // A figure that already offers its own whole-figure comment owns
            // that affordance, and its notes join the batch the reader submits
            // from the figure. Portaling a second control here would put two
            // comment icons in one toolbar and split one figure's feedback
            // across two mechanisms.
            ownedDescendant(block, "[data-flow-figure-comment]") === null,
        )
        .map((block) => {
          const host = document.createElement("span");
          if (
            block.dataset.blockKind === "data-table" ||
            block.dataset.blockKind === "table"
          ) {
            const tableActions = ownedDescendant(block, ".figure-action-group");
            if (tableActions === null) {
              host.dataset.reviewAnchorHost = "";
              block.append(host);
            } else {
              host.dataset.reviewToolbarHost = "";
              // An action group with no other control leaves the comment
              // standing alone rather than joining a control bar.
              if (tableActions.childElementCount === 0) {
                host.dataset.reviewToolbarInline = "";
              }
              tableActions.prepend(host);
            }
          } else {
            const plainCodeFigure = block.parentElement?.matches(".code-figure")
              ? block.parentElement
              : null;
            const plainCodeActions =
              plainCodeFigure?.querySelector<HTMLElement>(
                ".figure-control-bar",
              );
            const plainCodeCopy =
              plainCodeActions?.querySelector<HTMLElement>("[data-copy-code]");
            const copyControl = ownedDescendant(
              block,
              "[data-copy-source], [data-copy-code]",
            );
            const actionGroup = ownedDescendant(
              block,
              ".figure-action-group, .figure-control-bar",
            );
            const inlineHeader = ownedDescendant(
              block,
              ".file-tree-header, .callout-header",
            );
            const overlayHeader = ownedDescendant(
              block,
              ".decision-zone-question",
            );
            if (plainCodeActions !== undefined && plainCodeActions !== null) {
              host.dataset.reviewToolbarHost = "";
              if (plainCodeCopy === undefined || plainCodeCopy === null) {
                plainCodeActions.prepend(host);
              } else {
                plainCodeCopy.after(host);
              }
            } else if (copyControl !== null) {
              host.dataset.reviewToolbarHost = "";
              copyControl.before(host);
            } else if (actionGroup !== null) {
              host.dataset.reviewToolbarHost = "";
              // An action group with no other control leaves the comment
              // standing alone rather than joining a control bar.
              if (actionGroup.childElementCount === 0) {
                host.dataset.reviewToolbarInline = "";
              }
              actionGroup.prepend(host);
            } else if (inlineHeader !== null) {
              host.dataset.reviewToolbarHost = "";
              host.dataset.reviewToolbarInline = "";
              inlineHeader.append(host);
            } else if (overlayHeader !== null) {
              host.dataset.reviewToolbarHost = "";
              host.dataset.reviewToolbarOverlay = "";
              overlayHeader.append(host);
            } else {
              host.dataset.reviewAnchorHost = "";
              block.append(host);
            }
          }
          return { block, host };
        });
    let article = document.querySelector("article");
    let mounted = mount();
    setHosts(mounted);
    const observer = new MutationObserver(() => {
      const nextArticle = document.querySelector("article");
      if (nextArticle === article) return;
      mounted.forEach(({ host }) => host.remove());
      article = nextArticle;
      mounted = mount();
      setHosts(mounted);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mounted.forEach(({ host }) => host.remove());
    };
  }, []);
  return hosts;
};

// A picture's comment affordance lives in the margin between the picture and
// the edge of the card it sits on, centred in that gap. Pinned to the picture
// it reads as part of the artwork; pinned to the card edge it reads as page
// chrome; centred it reads as what it is - this picture's control, in the
// page's own margin. The card is the canvas edge the captain measured against,
// and the reading column is the fallback for a picture outside one.
const CANVAS_SELECTOR = "[data-slide], article";

const placeImageHost = ({
  block,
  host,
  parent,
}: {
  readonly block: HTMLElement;
  readonly host: HTMLSpanElement;
  readonly parent: HTMLElement;
}): void => {
  if (block.getClientRects().length === 0) return;
  const parentRect = parent.getBoundingClientRect();
  const imageRect = block.getBoundingClientRect();
  const canvas = block.closest<HTMLElement>(CANVAS_SELECTOR);
  const canvasRight =
    canvas === null ? imageRect.right : canvas.getBoundingClientRect().right;
  const hostWidth = host.offsetWidth;
  const margin = (canvasRight - imageRect.right - hostWidth) / 2;
  host.style.left = `${imageRect.right - parentRect.left + margin}px`;
  host.style.top = `${imageRect.top - parentRect.top}px`;
};

const useImageHosts = () => {
  const [hosts, setHosts] = useState<
    ReadonlyArray<{
      readonly block: HTMLElement;
      readonly host: HTMLSpanElement;
    }>
  >([]);
  useEffect(() => {
    const mounted: Array<{
      readonly block: HTMLElement;
      readonly host: HTMLSpanElement;
      readonly parent: HTMLElement;
      readonly originalPosition: string;
    }> = [];
    const frameHandles: Array<number> = [];
    const resize = new ResizeObserver(() => {
      for (const { block, host, parent } of mounted) {
        placeImageHost({ block, host, parent });
      }
    });
    const mount = () => {
      const next = livePictures().filter(
        (candidate) => candidate.dataset.reviewImageMounted === undefined,
      );
      for (const block of next) {
        const parent = block.parentElement;
        if (parent === null) continue;
        const host = document.createElement("span");
        host.dataset.reviewImageHost = "";
        block.dataset.reviewImageMounted = "";
        const originalPosition = parent.style.position;
        if (getComputedStyle(parent).position === "static") {
          parent.style.position = "relative";
        }
        block.after(host);
        mounted.push({ block, host, parent, originalPosition });
        resize.observe(block);
        resize.observe(parent);
        frameHandles.push(
          requestAnimationFrame(() => placeImageHost({ block, host, parent })),
        );
      }
      setHosts(mounted);
    };
    let article = document.querySelector("article");
    mount();
    const observer = new MutationObserver(() => {
      const nextArticle = document.querySelector("article");
      if (nextArticle === article) return;
      mounted.splice(0).forEach(({ block, host, parent, originalPosition }) => {
        host.remove();
        delete block.dataset.reviewImageMounted;
        parent.style.position = originalPosition;
      });
      article = nextArticle;
      mount();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      resize.disconnect();
      frameHandles.forEach((frame) => cancelAnimationFrame(frame));
      mounted.forEach(({ block, host, parent, originalPosition }) => {
        host.remove();
        delete block.dataset.reviewImageMounted;
        parent.style.position = originalPosition;
      });
    };
  }, []);
  return hosts;
};

const useReviewContainerHosts = () => {
  const [hosts, setHosts] = useState<
    ReadonlyArray<{
      readonly container: HTMLElement;
      readonly host: HTMLSpanElement;
    }>
  >([]);
  useEffect(() => {
    const mount = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-slide], [data-quick-summary]",
        ),
      )
        .filter(
          (container) =>
            !container.matches("[data-quick-summary]") ||
            container.closest("[data-slide]") === null,
        )
        .map((container) => {
          const host = document.createElement("span");
          host.dataset.reviewSlideHost = "";
          const collapseHeader = container.querySelector<HTMLElement>(
            ":scope > [data-collapse-header]",
          );
          if (collapseHeader === null) container.append(host);
          else collapseHeader.prepend(host);
          container.dataset.reviewSlideSelectable = "";
          return { container, host };
        });
    const unmount = (
      mounted: ReadonlyArray<{
        readonly container: HTMLElement;
        readonly host: HTMLSpanElement;
      }>,
    ) =>
      mounted.forEach(({ container, host }) => {
        host.remove();
        delete container.dataset.reviewSlideSelectable;
        delete container.dataset.reviewSlideSelected;
      });
    let article = document.querySelector("article");
    let mounted = mount();
    setHosts(mounted);
    const observer = new MutationObserver(() => {
      const nextArticle = document.querySelector("article");
      if (nextArticle === article) return;
      unmount(mounted);
      article = nextArticle;
      mounted = mount();
      setHosts(mounted);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      unmount(mounted);
    };
  }, []);
  return hosts;
};

const useFeedbackHost = (): HTMLSpanElement | null => {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);

  useEffect(() => {
    const settings = document.querySelector<HTMLElement>(
      "[data-preferences-control]",
    );
    if (settings === null || settings.parentElement === null) return;
    const legacyControl = settings.parentElement.querySelector<HTMLElement>(
      "[data-comment-draft-control]",
    );
    if (legacyControl !== null) legacyControl.hidden = true;
    const next = document.createElement("span");
    next.dataset.reviewFeedbackHost = "";
    settings.before(next);
    setHost(next);
    return () => {
      next.remove();
      if (legacyControl !== null) legacyControl.hidden = false;
    };
  }, []);

  return host;
};

const useWide = (): boolean => {
  const [isWide, setIsWide] = useState(
    () => window.matchMedia(WIDE_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setIsWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isWide;
};

const useInlineComposeHost = (
  compose: ComposeState | null,
  isOpen: boolean,
): HTMLDivElement | null => {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const isNarrow = !useWide();
  // The host sits after the block being commented on, so a refresh that
  // replaces that block takes the open composer with it unless the host is
  // placed again beside the block's live copy.
  const articleVersion = useArticleVersion();
  useEffect(() => {
    if ((!isOpen && !isNarrow) || compose === null) {
      setHost(null);
      return;
    }
    const anchor = targetElement(compose.target);
    if (anchor === null) {
      setHost(null);
      return;
    }
    const next = document.createElement("div");
    next.dataset.reviewComposeInline = "";
    anchor.after(next);
    setHost(next);
    return () => {
      next.remove();
    };
  }, [articleVersion, compose, isNarrow, isOpen]);
  return host;
};

// A block-targeted comment normally sits level with the top of its block, which
// is right for a comment about the block. A component that raised the comment
// from one control inside itself knows better: it nominates that control, and
// the thread sits beside the thing the reader was actually looking at. The
// comment's target is unchanged - this moves where the thread is drawn, not
// what it points at.
const threadAnchorElement = (comment: ReviewComment): HTMLElement | null => {
  const nominated = document.querySelector<HTMLElement>(
    `[data-review-thread-anchor="${CSS.escape(comment.id)}"]`,
  );
  if (nominated !== null && isRendered(nominated)) {
    return nominated;
  }
  return targetElement(comment.target);
};

// A thread hangs off the card its target sits in, not off the target itself,
// so one comment on a paragraph and another on the slide around it line up in
// the same column.
const threadAnchorContainer = (target: HTMLElement): HTMLElement =>
  target.closest<HTMLElement>("[data-slide], [data-quick-summary]") ??
  target.parentElement ??
  target;

// Whether the spot the thread remembers is still occupied. A lens hides the
// block it replays but renders its copy in the same spot, so the remembered
// distance still describes where that content sits. A collapse leaves nothing
// behind at all: the card shrinks to its header, and the distance then names a
// gap below the card rather than a place inside it.
const targetHoldsItsPlace = (target: HTMLElement): boolean =>
  isRendered(target) || displayedStandIn(target) !== null;

const useThreadHosts = (
  comments: ReadonlyArray<ReviewComment>,
  isOpen: boolean,
): ReadonlyMap<string, HTMLDivElement> => {
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLDivElement>>(
    new Map(),
  );
  const isWide = useWide();
  // Outlives the effect on purpose. The effect re-runs whenever the comment
  // list gets a fresh identity, which routine agent polling causes, and a
  // distance measured before a collapse must not be thrown away by a re-run
  // that happens while the target is hidden and cannot be measured again.
  const targetOffsetsRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!isWide) {
      setHosts(new Map());
      return;
    }
    const mounted = new Map<string, HTMLDivElement>();
    const targetOffsets = targetOffsetsRef.current;
    const live = new Set(comments.map((comment) => comment.id));
    for (const id of targetOffsets.keys()) {
      if (!live.has(id)) targetOffsets.delete(id);
    }
    for (const comment of comments) {
      const anchor = threadAnchorElement(comment);
      if (anchor === null) continue;
      const host = document.createElement("div");
      host.dataset.reviewThreadFor = comment.id;
      host.dataset.reviewThreadSide = "";
      // A thread has no place on the page until a positioning pass measures
      // one, and an absolutely positioned host without coordinates does not
      // wait quietly for that pass: it takes its static position, which is the
      // page's left edge below the end of the article - the one place a thread
      // must never appear. The hosts are appended here and positioned in the
      // next frame, so hidden until placed is what keeps that gap invisible.
      // The positioning pass reveals a host in the same task that gives it
      // coordinates, so a placed thread is never seen anywhere else.
      host.hidden = true;
      document.body.append(host);
      mounted.set(comment.id, host);
    }
    const position = () => {
      const viewportWidth = document.documentElement.clientWidth;
      const edge = 24;
      const feedbackSidebarWidth = isOpen
        ? Math.min(22 * 16, viewportWidth)
        : 0;
      const threadTopInset = 12;
      const threadWidth = 17 * 16;
      const diffThreadGap = 12;
      // A slide thread keeps its base overlap onto the card's right edge so it
      // still reads as attached to that card. It only needs the vertical
      // clearance below to stay clear of the comment control that now shares
      // that gutter; pushing it sideways as well would detach it from the card.
      const slideThreadOverlap = -12;
      const slideCommentControlClearance = 44;
      const positionItems: Array<{
        readonly id: string;
        readonly desiredTop: number;
        readonly height: number;
      }> = [];
      const anchorRects = new Map<
        string,
        { readonly right: number; readonly top: number }
      >();
      const rightThreadOffsets = new Map<string, number>();
      for (const comment of comments) {
        const host = mounted.get(comment.id);
        const target = threadAnchorElement(comment);
        if (host === undefined || target === null) continue;
        const container = threadAnchorContainer(target);
        const anchor = measureThreadAnchor(container, {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        });
        if ("missing" in anchor) {
          // Nothing on the page to sit beside. Drawing the card anyway would
          // mean inventing coordinates, and the invented ones land in the left
          // margin, which is the one place a thread must never appear.
          host.hidden = true;
          continue;
        }
        host.hidden = false;
        /*
        Where the target sits inside its card, recorded on every pass that can
        see both boxes rather than once when the thread is mounted. A target
        can be hidden at mount - a card the reader left collapsed, say - and
        first become measurable during an ordinary positioning pass, and a
        distance recorded only at mount would leave that thread stuck level
        with the card top for as long as the document stays open.

        The distance is deliberately remembered rather than re-measured
        whenever the thread moves. A lens re-renders the block in place, and
        re-measuring against the copy would move the thread off the words it is
        attached to; holding the distance is what keeps it still. That is why
        the recording is gated on the target itself being laid out, which a
        lens-replaced or collapsed target is not. The anchor rect is the
        opposite case and is never remembered: it describes the whole page's
        layout, which a collapse or a reflow invalidates.

        Recording from a target that is not on screen would store the
        difference between two all-zero rects, which reads back as a real
        measurement of zero, so a hidden target leaves the last real
        measurement standing rather than replacing it.

        For the same reason the distance is not applied once nothing occupies
        the place it measures. A collapse hides the body but keeps the card, so
        the card still measures while the distance inside it names a gap that
        has closed, and adding it would draw the thread below the collapsed
        card beside unrelated content. Level with the card is the whole answer
        until the target is back, and the distance is still here to put the
        thread beside it again.
        */
        if (anchor.element === container && isRendered(target)) {
          targetOffsets.set(
            comment.id,
            target.getBoundingClientRect().top -
              container.getBoundingClientRect().top,
          );
        }
        const anchorRect = anchor.measured;
        const cardHeight = Math.max(
          1,
          host.firstElementChild?.getBoundingClientRect().height ?? 1,
        );
        const isSlideAnchor = anchor.element.matches(
          "[data-slide], [data-quick-summary]",
        );
        // The offset places the thread level with the target inside the card,
        // so it only applies when the card itself is what got measured and the
        // target still holds its place inside it. A collapsed anchor is
        // represented by an ancestor row instead, and that row's top is the
        // whole answer.
        const targetOffset =
          anchor.element === container && targetHoldsItsPlace(target)
            ? (targetOffsets.get(comment.id) ?? 0)
            : 0;
        const desiredTop =
          anchorRect.top +
          targetOffset +
          (isSlideAnchor ? slideCommentControlClearance : threadTopInset);
        positionItems.push({
          id: comment.id,
          desiredTop,
          height: cardHeight,
        });
        anchorRects.set(comment.id, anchorRect);
        rightThreadOffsets.set(
          comment.id,
          isSlideAnchor ? slideThreadOverlap : diffThreadGap,
        );
      }
      for (const { id, top } of stackThreadPositions({
        items: positionItems,
        gap: 8,
      })) {
        const host = mounted.get(id);
        const anchorRect = anchorRects.get(id);
        if (host === undefined || anchorRect === undefined) continue;
        host.style.top = `${top}px`;
        host.style.left = `${threadLeft({
          anchorRight: anchorRect.right,
          anchorOffset: rightThreadOffsets.get(id) ?? diffThreadGap,
          threadWidth,
          viewportWidth,
          sidebarWidth: feedbackSidebarWidth,
          scrollX: window.scrollX,
          pageMargin: edge,
        })}px`;
      }
    };
    const frame = requestAnimationFrame(position);
    const observer = new ResizeObserver(position);
    for (const host of mounted.values()) observer.observe(host);
    for (const comment of comments) {
      const target = targetElement(comment.target);
      if (target !== null) {
        observer.observe(target);
        observer.observe(threadAnchorContainer(target));
      }
    }
    window.addEventListener("resize", position, { passive: true });
    const readingLayout = document.querySelector<HTMLElement>(
      "[data-reading-layout]",
    );
    readingLayout?.addEventListener("transitionend", position);
    const mutations = new MutationObserver(() => {
      const lens = document.querySelector<HTMLElement>(
        "[data-review-diff-lens]",
      );
      if (lens !== null) observer.observe(lens);
      position();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    setHosts(mounted);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", position);
      readingLayout?.removeEventListener("transitionend", position);
      for (const host of mounted.values()) host.remove();
    };
  }, [comments, isOpen, isWide]);

  return hosts;
};

const CommentComposer = ({
  compose,
  body,
  inline,
  submitRightAway,
  identity,
  writeAvailability,
  submitAvailability,
  onCancel,
  onBodyChange,
  onSave,
  onSubmitRightAwayChange,
  onShowAgent,
}: {
  readonly compose: ComposeState;
  readonly body: string;
  readonly inline: boolean;
  readonly submitRightAway: boolean;
  readonly identity: RuntimeIdentity | null;
  readonly writeAvailability: ReviewWriteAvailability;
  readonly submitAvailability: ReviewCommentSubmitAvailability;
  readonly onCancel: () => void;
  readonly onBodyChange: (body: string) => void;
  readonly onSave: (body: string, submitRightAway: boolean) => void;
  readonly onSubmitRightAwayChange: (submitRightAway: boolean) => void;
  readonly onShowAgent: () => void;
}) => {
  const canSubmitRightAway = submitAvailability.state === "available";
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition>({
    top: compose.top,
    left: compose.left,
  });
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inline) return;
    const frame = requestAnimationFrame(() => {
      const rect = composerRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const visible = (node: HTMLElement) => node.getBoundingClientRect();
      const laidOut = (rect: DOMRect) => rect.width > 0 && rect.height > 0;
      const obstacles = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-review-thread-side], button[aria-label^="Comment on"]',
        ),
        visible,
      ).filter(laidOut);
      // The shell's own fixed bars are kept apart from those. They are painted
      // above the composer and are not part of the review island, so a slot
      // chosen without them looks free and lands underneath the header - but
      // they set a floor rather than competing for space by overlap.
      const chrome = Array.from(
        document.querySelectorAll<HTMLElement>("[data-shell-chrome]"),
        visible,
      ).filter(laidOut);
      const next = floatingComposerPosition({
        preferred: {
          top: compose.top - window.scrollY,
          left: compose.left - window.scrollX,
        },
        width: rect.width,
        height: rect.height,
        obstacles,
        chrome,
      });
      setFloatingPosition({
        top: next.top + window.scrollY,
        left: next.left + window.scrollX,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [compose.left, compose.top, inline]);
  const save = () =>
    body.trim() !== "" &&
    (!submitRightAway || canSubmitRightAway) &&
    onSave(body.trim(), submitRightAway);
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (body.trim() === "") onCancel();
      else setCloseConfirmOpen(true);
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };
  const style: CSSProperties = {
    ...(inline
      ? {}
      : {
          top: `${floatingPosition.top}px`,
          left: `${floatingPosition.left}px`,
        }),
  };
  return (
    <>
      <Card
        ref={composerRef}
        className={
          inline
            ? `review-comment-composer-inline relative z-auto mb-6 w-full max-w-lg border border-edge bg-paper! p-3 text-ink shadow-floating ${compose.target.type === "block" && compose.target.kind === "slide" ? "-mt-4" : "mt-2"}`
            : "review-comment-composer-floating absolute z-30 w-[min(17rem,calc(100vw-2rem))] border border-edge bg-paper! p-3 text-ink shadow-floating"
        }
        style={style}
        role="dialog"
        aria-label={`Comment on ${targetLabel(compose.target)}`}
        data-review-associated={
          compose.target.type === "selection" ? "true" : undefined
        }
      >
        <p className="review-compose-title m-0 mb-2 text-xs font-semibold text-muted">
          Add a comment
        </p>
        <ComposeImages
          identity={identity}
          writeAvailability={writeAvailability}
          autoFocus
          label="Add a comment"
          textareaClassName="bg-input!"
          placeholder="What should the agent change here?"
          body={body}
          maxLength={BODY_LIMIT}
          onBodyChange={onBodyChange}
          onKeyDown={handleKeyDown}
        />
        {(compose.target.type === "selection" ||
          compose.target.type === "lines") &&
        compose.target.isQuoteExcerpt ? (
          // The whole highlight stays the comment's target; only the copy sent
          // with it is trimmed, and the reviewer is told so rather than
          // discovering it in the agent's reply.
          <p className="review-compose-excerpt mt-1 mb-0 text-2xs text-subtle">
            The agent gets the first {QUOTE_LIMIT.toLocaleString()} characters
            of this highlight as a quote, and the whole highlight as the target.
          </p>
        ) : null}
        <p className="review-compose-hint mt-1 mb-0 text-2xs text-subtle">
          Escape closes · {MODIFIER_SHORTCUT} adds
        </p>
        <div className="mt-2 block">
          <button
            type="button"
            className="group inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            role="switch"
            aria-checked={submitRightAway}
            onClick={() => onSubmitRightAwayChange(!submitRightAway)}
          >
            <span
              className="relative h-5 w-8 rounded-full border border-edge bg-surface inset-shadow-well after:absolute after:top-1/2 after:left-1 after:size-3 after:-translate-y-1/2 after:rounded-full after:bg-muted after:transition-transform group-aria-checked:border-accent group-aria-checked:bg-accent-soft group-aria-checked:after:translate-x-3 group-aria-checked:after:bg-accent"
              aria-hidden="true"
            />
            Submit right away
          </button>
          <div className="mt-2 flex items-center justify-end gap-1">
            <Button variant="outline" size="compact" onClick={onCancel}>
              Cancel
            </Button>
            <Tooltip label={MODIFIER_SHORTCUT} placement="below" asChild>
              <Button
                size="micro"
                disabled={
                  body.trim() === "" || (submitRightAway && !canSubmitRightAway)
                }
                onClick={save}
              >
                {submitRightAway ? "Submit Now" : "Add Comment"}
              </Button>
            </Tooltip>
          </div>
          {submitRightAway && submitAvailability.state === "unavailable" ? (
            <button
              type="button"
              className="mt-2 ml-auto block cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-danger underline underline-offset-[0.16em] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              onClick={onShowAgent}
            >
              {submitAvailability.label}
            </button>
          ) : null}
        </div>
      </Card>
      <AlertDialog
        open={closeConfirmOpen}
        title="Close this comment?"
        description="Your text will be lost."
        cancelLabel="Keep editing"
        actionLabel="Close comment"
        onCancel={() => setCloseConfirmOpen(false)}
        onAction={() => {
          setCloseConfirmOpen(false);
          onCancel();
        }}
      />
    </>
  );
};

const CommentCardHeader = ({
  target,
  surface,
  metaClassName,
  targetClassName,
  actionsClassName,
  onJump,
  onHeaderClick,
  onTargetClick,
  children,
}: {
  readonly target: CommentTarget;
  readonly surface: StagedCardSurface;
  readonly metaClassName: string;
  readonly targetClassName: string;
  readonly actionsClassName: string;
  readonly onJump: () => void;
  readonly onHeaderClick?: () => void;
  readonly onTargetClick?: () => void;
  readonly children: ReactNode;
}) => (
  <div
    className={`review-comment-meta ${metaClassName} flex min-w-0 items-center gap-2 ${surface === "thread" ? "-mx-3 -mt-3 mb-3 rounded-t-lg border-b border-edge bg-comment-toolbar!" : "border-b border-edge bg-comment-toolbar"} ${onHeaderClick === undefined ? "" : "cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--comment-toolbar-c)_94%,var(--ink-c))]!"}`}
    style={{ padding: "3px 5px" }}
    onClick={onHeaderClick}
  >
    <button
      type="button"
      className={`${targetClassName} min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 pl-0.5 text-left leading-normal focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${onHeaderClick === undefined ? "hover:underline" : ""} ${surface === "thread" ? "text-2xs font-medium text-subtle" : "text-xs font-semibold text-muted"}`}
      onClick={(event) => {
        event.stopPropagation();
        (onTargetClick ?? onHeaderClick ?? onJump)();
      }}
      title={
        onTargetClick === undefined && onHeaderClick !== undefined
          ? "Minimize comment"
          : `Go to ${targetLabel(target, true)}`
      }
    >
      {targetLabel(target, true)}
    </button>
    <div
      className={`${actionsClassName} ml-auto flex shrink-0 items-center gap-1`}
    >
      {children}
    </div>
  </div>
);

const ContextualCommentSummary = ({
  className = "",
  status,
  statusIcon,
  statusIconLabel,
  statusSpinner = false,
  statusClassName = "",
  body,
  associated,
  onExpand,
  onAssociate,
  threadGroup,
  commentId,
  children,
}: {
  readonly className?: string;
  readonly status: string;
  readonly statusIcon?: LucideIcon;
  readonly statusIconLabel?: string;
  readonly statusSpinner?: boolean;
  readonly statusClassName?: string;
  readonly body: string;
  readonly associated: boolean;
  readonly onExpand: () => void;
  readonly onAssociate: (active: boolean) => void;
  readonly threadGroup?: string;
  readonly commentId?: string;
  readonly children: ReactNode;
}) => (
  <Card
    className={`review-contextual-summary group/contextual mt-2 flex w-full max-w-[17rem] cursor-pointer items-center gap-2 border border-edge bg-raised! transition-shadow data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-lifted ${className}`}
    density="dense"
    elevation="floating"
    onPointerEnter={() => onAssociate(true)}
    onPointerLeave={(event) => {
      if (!event.currentTarget.contains(document.activeElement))
        onAssociate(false);
    }}
    onFocus={() => onAssociate(true)}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget))
        onAssociate(false);
    }}
    onClick={(event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      if (target !== null && target.closest("button") !== null) return;
      onExpand();
    }}
    data-review-comment-ui=""
    data-review-associated={associated ? "true" : undefined}
    data-review-sent-thread={threadGroup}
    data-review-comment-id={commentId}
  >
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-semibold normal-case [&>svg]:size-3 ${statusClassName}`}
      role={statusIcon === undefined && !statusSpinner ? undefined : "img"}
      aria-label={statusIconLabel ?? status}
    >
      {statusSpinner ? (
        <WorkingMark className="size-2.5" />
      ) : statusIcon === undefined ? null : (
        <Icon icon={statusIcon} />
      )}
      {status}
    </span>
    <button
      type="button"
      className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-xs text-ink hover:underline hover:underline-offset-[0.16em] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      aria-label={`Expand comment: ${body}`}
      aria-expanded="false"
      onClick={onExpand}
    >
      {body}
    </button>
    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/contextual:opacity-100 group-focus-within/contextual:opacity-100">
      {children}
    </div>
  </Card>
);

const CompactRailComment = ({
  target,
  body,
  associated,
  status,
  queuePosition,
  onExpand,
  onAssociate,
  threadGroup,
  commentId,
  children,
}: {
  readonly target: CommentTarget;
  readonly body: string;
  readonly associated: boolean;
  readonly status: "Queued" | "Staged" | "Working";
  readonly queuePosition?: number;
  readonly onExpand: () => void;
  readonly onAssociate: (active: boolean) => void;
  readonly threadGroup?: ThreadGroup;
  readonly commentId?: string;
  readonly children: ReactNode;
}) => (
  <Card
    className="group/compact w-full max-w-none overflow-hidden border border-edge bg-comment-body! p-0! transition-shadow data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-raised"
    density="dense"
    elevation="none"
    data-review-comment-ui=""
    data-review-sent-thread={threadGroup}
    data-review-comment-id={commentId}
    data-review-associated={associated ? "true" : undefined}
    onPointerEnter={() => onAssociate(true)}
    onPointerLeave={(event) => {
      if (!event.currentTarget.contains(document.activeElement))
        onAssociate(false);
    }}
    onFocus={() => onAssociate(true)}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget))
        onAssociate(false);
    }}
  >
    <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
      <button
        type="button"
        className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5 border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-expanded="false"
        aria-label={`Expand ${status.toLocaleLowerCase()} comment: ${body}`}
        onClick={onExpand}
      >
        <Icon icon={CHEVRON_RIGHT_ICON} />
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-1.5 text-2xs text-subtle">
            {queuePosition === undefined ? null : (
              <span className="shrink-0 font-semibold">#{queuePosition}</span>
            )}
            <span className="min-w-0 truncate font-medium text-muted">
              {targetLabel(target, true)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink">{body}</span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/compact:opacity-100 group-focus-within/compact:opacity-100">
        {children}
      </div>
    </div>
  </Card>
);

const StagedCard = ({
  comment,
  surface,
  associated,
  collapsed,
  expanded,
  compactExpanded = false,
  onCollapse,
  onExpandCompact,
  onCollapseCompact,
  onExpandBody,
  onMinimizeBody,
  onUpdate,
  onDelete,
  onJump,
  onSubmit,
  submitAvailability,
  onShowAgent,
  onAssociate,
  identity,
  currentSnapshot,
  onStatus,
  unsavedInputKey,
  onUnsavedInputChange,
  resolved = false,
  onResolve,
  compact = false,
}: {
  readonly comment: ReviewComment;
  readonly surface: StagedCardSurface;
  readonly associated: boolean;
  readonly collapsed: boolean;
  readonly expanded: boolean;
  readonly compactExpanded?: boolean;
  readonly onCollapse?: () => void;
  readonly onExpandCompact?: () => void;
  readonly onCollapseCompact?: () => void;
  readonly onExpandBody: () => void;
  readonly onMinimizeBody: () => void;
  readonly onUpdate: (body: string) => void;
  readonly onDelete: () => void;
  readonly onJump: () => void;
  readonly onSubmit: () => void;
  readonly submitAvailability: ReviewCommentSubmitAvailability;
  readonly onShowAgent: () => void;
  readonly onAssociate: (target: CommentTarget | null) => void;
  readonly identity: RuntimeIdentity | null;
  readonly currentSnapshot: string;
  readonly onStatus: (message: string) => void;
  readonly unsavedInputKey: string;
  readonly onUnsavedInputChange: UnsavedInputChange;
  readonly resolved?: boolean;
  readonly onResolve?: () => void;
  readonly compact?: boolean;
}) => {
  const canSubmit = submitAvailability.state === "available";
  const setAssociated = (active: boolean) => {
    onAssociate(active ? comment.target : null);
  };
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const saveEdit = () => {
    const nextBody = editBody.trim();
    if (nextBody === "") return;
    onUpdate(nextBody);
    setIsEditing(false);
  };
  useEffect(() => {
    if (isEditing) editRef.current?.focus();
  }, [isEditing]);
  const hasUnsavedEdit = isEditing && editBody !== comment.body;
  useEffect(() => {
    onUnsavedInputChange(unsavedInputKey, hasUnsavedEdit);
    return () => onUnsavedInputChange(unsavedInputKey, false);
  }, [hasUnsavedEdit, onUnsavedInputChange, unsavedInputKey]);
  if (collapsed) {
    return (
      <ContextualCommentSummary
        className={`review-staged-collapsed-${surface}`}
        status="Staged"
        statusIcon={PENCIL_ICON}
        statusClassName="bg-[var(--annotation-bg)] text-[var(--annotation-c)]"
        body={comment.body}
        associated={associated}
        onExpand={() => onCollapse?.()}
        onAssociate={setAssociated}
      >
        <ThreadIconButton
          label="Delete staged comment"
          icon={TRASH_2_ICON}
          onClick={onDelete}
          tone="danger"
        />
      </ContextualCommentSummary>
    );
  }
  if (surface === "rail" && compact && !compactExpanded) {
    return (
      <CompactRailComment
        target={comment.target}
        body={comment.body}
        associated={associated}
        status="Staged"
        onExpand={() => onExpandCompact?.()}
        onAssociate={setAssociated}
      >
        <ThreadIconButton
          label="Edit staged comment"
          icon={PENCIL_ICON}
          onClick={() => {
            setEditBody(comment.body);
            setIsEditing(true);
            onExpandCompact?.();
          }}
        />
        <ThreadIconButton
          label="Delete staged comment"
          icon={TRASH_2_ICON}
          onClick={onDelete}
          tone="danger"
        />
      </CompactRailComment>
    );
  }
  const long = comment.body.length > LONG_COMMENT;
  const visibleBody =
    long && !expanded
      ? `${comment.body.slice(0, LONG_COMMENT).trimEnd()}…`
      : comment.body;
  if (surface === "rail") {
    return (
      <Card
        className="review-staged-card w-full max-w-none overflow-hidden border border-edge bg-comment-body! p-0! shadow-raised transition-shadow data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-lifted"
        density="dense"
        elevation="none"
        onPointerEnter={() => setAssociated(true)}
        onPointerLeave={(event) => {
          if (!event.currentTarget.contains(document.activeElement))
            setAssociated(false);
        }}
        onFocus={() => setAssociated(true)}
        onBlur={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setAssociated(false);
        }}
        data-review-comment-ui=""
        data-review-associated={associated ? "true" : undefined}
        data-review-surface="rail"
      >
        <CommentCardHeader
          target={comment.target}
          surface="rail"
          metaClassName="review-staged-meta"
          targetClassName="review-staged-target"
          actionsClassName="review-staged-actions"
          onJump={onJump}
        >
          {resolved && onResolve !== undefined ? (
            <ThreadIconButton
              label="Unresolve thread"
              icon={CHECK_ICON}
              onClick={onResolve}
            />
          ) : null}
          {!resolved && (compactExpanded || (expanded && long)) ? (
            <ThreadIconButton
              label="Minimize comment"
              icon={MINIMIZE_2_ICON}
              onClick={() => {
                if (compactExpanded) onCollapseCompact?.();
                else onMinimizeBody();
              }}
            />
          ) : null}
          {!resolved ? (
            <>
              <ThreadIconButton
                label="Edit staged comment"
                icon={PENCIL_ICON}
                onClick={() => {
                  setEditBody(comment.body);
                  setIsEditing(true);
                }}
              />
              <ThreadIconButton
                label="Delete staged comment"
                icon={TRASH_2_ICON}
                onClick={onDelete}
                tone="danger"
              />
            </>
          ) : null}
        </CommentCardHeader>
        {isEditing ? (
          <div className="p-3">
            <Textarea
              ref={editRef}
              className="bg-input!"
              aria-label="Edit comment"
              value={editBody}
              maxLength={BODY_LIMIT}
              onChange={(event) => setEditBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditBody(comment.body);
                  setIsEditing(false);
                } else if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault();
                  saveEdit();
                }
              }}
            />
            <p className="mt-1 text-2xs text-muted">
              Escape cancels · {MODIFIER_SHORTCUT} saves
            </p>
            <div className="mt-2 flex justify-end gap-1">
              <Button
                variant="outline"
                size="compact"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
              <Button
                size="micro"
                disabled={editBody.trim() === ""}
                onClick={saveEdit}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-3">
            <MarkdownBody
              body={visibleBody}
              className={`review-staged-body [overflow-wrap:anywhere] text-sm text-ink [&_p]:m-0 [&_p+p]:mt-2 ${expanded ? "" : "line-clamp-3"}`}
            />
            <StalePremiseNotice
              comment={comment}
              identity={identity}
              currentSnapshot={currentSnapshot}
              onStatus={onStatus}
              onResolve={!resolved ? onResolve : undefined}
              thread={{ label: comment.body, onOpen: onJump }}
            />
            {long && !expanded ? (
              <button
                type="button"
                className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={onExpandBody}
              >
                … more
              </button>
            ) : null}
            <div className="mt-3 flex min-w-0 items-center justify-between gap-2 text-xs text-muted">
              <time dateTime={comment.createdAt}>
                {threadTime(comment.createdAt)}
              </time>
              {resolved && onResolve !== undefined ? (
                <Button variant="outline" size="micro" onClick={onResolve}>
                  Unresolve
                </Button>
              ) : (
                <Button
                  variant="accentOutline"
                  size="micro"
                  disabled={!canSubmit}
                  onClick={onSubmit}
                >
                  Send this
                </Button>
              )}
            </div>
            {!resolved && submitAvailability.state === "unavailable" ? (
              <button
                type="button"
                className="mt-2 ml-auto block cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-danger underline underline-offset-[0.16em] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                onClick={onShowAgent}
              >
                {submitAvailability.label}
              </button>
            ) : null}
          </div>
        )}
      </Card>
    );
  }
  return (
    <Card
      className="review-staged-card w-full max-w-[17rem] border border-edge bg-comment-body! transition-shadow data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-lifted"
      density="compact"
      elevation="floating"
      onPointerEnter={() => setAssociated(true)}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement))
          setAssociated(false);
      }}
      onFocus={() => setAssociated(true)}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setAssociated(false);
      }}
      data-review-comment-ui=""
      data-review-associated={associated ? "true" : undefined}
      data-review-surface={surface}
    >
      <CommentCardHeader
        target={comment.target}
        surface={surface}
        metaClassName="review-staged-meta"
        targetClassName="review-staged-target"
        actionsClassName="review-staged-actions"
        onJump={onJump}
        onHeaderClick={onCollapse}
      >
        <ThreadIconButton
          label="Minimize staged comment"
          icon={MINIMIZE_2_ICON}
          onClick={onCollapse}
        />
        <ThreadIconButton
          label="Edit staged comment"
          icon={PENCIL_ICON}
          onClick={() => {
            setEditBody(comment.body);
            setIsEditing(true);
          }}
        />
        <ThreadIconButton
          label="Delete staged comment"
          icon={TRASH_2_ICON}
          onClick={onDelete}
          tone="danger"
        />
      </CommentCardHeader>
      {isEditing ? (
        <>
          <Textarea
            ref={editRef}
            className="mt-2 bg-input!"
            aria-label="Edit comment"
            value={editBody}
            maxLength={BODY_LIMIT}
            onChange={(event) => setEditBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditBody(comment.body);
                setIsEditing(false);
              } else if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey)
              ) {
                event.preventDefault();
                saveEdit();
              }
            }}
          />
          <p className="mt-1 text-2xs text-muted">
            Escape cancels · {MODIFIER_SHORTCUT} saves
          </p>
          <div className="mt-2 flex justify-end gap-1">
            <Button
              variant="outline"
              size="compact"
              onClick={() => setIsEditing(false)}
            >
              Cancel
            </Button>
            <Tooltip label={MODIFIER_SHORTCUT} placement="below" asChild>
              <Button
                size="micro"
                disabled={editBody.trim() === ""}
                onClick={saveEdit}
              >
                Save
              </Button>
            </Tooltip>
          </div>
        </>
      ) : (
        <>
          <MarkdownBody
            body={visibleBody}
            className="review-staged-body mt-2 [overflow-wrap:anywhere] text-xs text-ink [&_p]:m-0 [&_p+p]:mt-2"
          />
          <StalePremiseNotice
            comment={comment}
            identity={identity}
            currentSnapshot={currentSnapshot}
            onStatus={onStatus}
            onResolve={onResolve}
            thread={{ label: comment.body, onOpen: onJump }}
          />
          <p className="mt-2 mb-0 text-xs text-muted">
            <time dateTime={comment.createdAt}>
              {threadTime(comment.createdAt)}
            </time>
          </p>
        </>
      )}
      {!isEditing && long && !expanded ? (
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent px-0 py-1 text-xs font-semibold text-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={onExpandBody}
        >
          … more
        </button>
      ) : null}
      {isEditing ? null : (
        <div className="mt-2 flex items-center justify-end">
          <Button
            variant="accentOutline"
            size="micro"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            Submit Now
          </Button>
        </div>
      )}
      {!isEditing && submitAvailability.state === "unavailable" ? (
        <button
          type="button"
          className="mt-2 ml-auto block cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-danger underline underline-offset-[0.16em] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          onClick={onShowAgent}
        >
          {submitAvailability.label}
        </button>
      ) : null}
    </Card>
  );
};

const ChangeAttachment = ({
  identity,
  request,
  response,
  changeTargets,
  currentSnapshot,
  onStatus,
  onResolve,
  onRevert,
  canRevert,
  thread,
  onKeepChatting,
}: {
  readonly identity: RuntimeIdentity;
  readonly request: AgentRequest;
  readonly response: AgentResponse;
  readonly changeTargets?: ReadonlyArray<string>;
  readonly currentSnapshot: string;
  readonly onStatus: (message: string) => void;
  readonly onResolve?: () => void;
  readonly onRevert?: () => void;
  readonly canRevert?: boolean;
  readonly thread?: {
    readonly label: string;
    readonly onOpen: () => void;
  };
  readonly onKeepChatting?: () => void;
}) => {
  const from = request.baselineSnapshot ?? request.premiseSnapshot;
  const to = response.resultSnapshot;
  const [diff, setDiff] = useState<SnapshotDiff | null>(() =>
    readySnapshotDiff(identity, from, to),
  );
  const [isLoading, setIsLoading] = useState(false);
  const load = useCallback(async () => {
    if (isLoading || diff !== null) return;
    setIsLoading(true);
    try {
      setDiff(await cachedSnapshotDiff(identity, from, to));
    } catch (error) {
      onStatus(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [diff, from, identity, isLoading, onStatus, to]);
  useEffect(() => {
    void load();
  }, [load]);
  const attributed =
    diff === null || changeTargets === undefined
      ? undefined
      : attributeDiffPlaces({ diff, changeTargets });
  return (
    <AgentChangeDigest
      diff={diff}
      placeIds={attributed?.placeIds}
      spilloverCount={attributed?.spilloverCount}
      isSuperseded={
        currentSnapshot !== "" && currentSnapshot !== response.resultSnapshot
      }
      isLoading={isLoading}
      onLoad={() => void load()}
      onResolve={onResolve}
      onRevert={onRevert}
      canRevert={canRevert}
      thread={thread}
      onKeepChatting={onKeepChatting}
    />
  );
};

const StalePremiseNotice = ({
  comment,
  identity,
  currentSnapshot,
  onStatus,
  onResolve,
  thread,
}: {
  readonly comment: ReviewComment;
  readonly identity: RuntimeIdentity | null;
  readonly currentSnapshot: string;
  readonly onStatus: (message: string) => void;
  readonly onResolve?: () => void;
  readonly thread?: {
    readonly label: string;
    readonly onOpen: () => void;
  };
}) => {
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const blockIds = useMemo(
    () =>
      comment.target.type === "document"
        ? []
        : [
            comment.target.blockId,
            ...(comment.target.type === "selection" &&
            comment.target.endBlockId !== undefined
              ? [comment.target.endBlockId]
              : []),
          ],
    [comment.target],
  );
  useEffect(() => {
    if (identity === null || comment.premiseSnapshot === currentSnapshot) {
      setDiff(null);
      return;
    }
    let current = true;
    void requestJson({
      path: `/api/snapshot-diff?from=${encodeURIComponent(comment.premiseSnapshot)}&to=${encodeURIComponent(currentSnapshot)}`,
      identity,
    })
      .then((value) => {
        const parsed = parseSnapshotDiff(value);
        if (current && parsed !== null) setDiff(parsed);
      })
      .catch((error: unknown) => {
        if (current) onStatus(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, [blockIds, comment.premiseSnapshot, currentSnapshot, identity, onStatus]);
  if (diff === null) return null;
  const attributed =
    blockIds.length === 0
      ? {
          placeIds: diff.places.map((place) => place.placeId),
          spilloverCount: 0,
        }
      : attributeDiffPlaces({ diff, changeTargets: blockIds });
  const changedOutsideTarget =
    blockIds.length > 0 && attributed.placeIds.length === 0;
  const placeIds = changedOutsideTarget
    ? diff.places.map((place) => place.placeId)
    : attributed.placeIds;
  return (
    <div className="mt-2 rounded-md bg-[var(--callout-warning-bg)] p-2 text-[var(--callout-warning-ink)]">
      <Badge
        tone="secondary"
        className="bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]"
      >
        Plan changed since this comment
      </Badge>
      <p className="mt-1 mb-0 text-2xs">
        {changedOutsideTarget
          ? "The plan changed outside this comment's target. Review the premise-to-current changes before sending it."
          : "This compares the plan when you commented with the current plan."}
      </p>
      {placeIds.length > 0 ? (
        <AgentChangeDigest
          diff={diff}
          placeIds={placeIds}
          spilloverCount={
            changedOutsideTarget ? undefined : attributed.spilloverCount
          }
          isSuperseded
          isLoading={false}
          onLoad={() => undefined}
          actionLabel="Review premise → current"
          thread={thread}
          onResolve={onResolve}
        />
      ) : null}
      {onResolve === undefined ? null : (
        <Button
          variant="outline"
          size="micro"
          className="mt-2"
          onClick={onResolve}
        >
          Mark addressed
        </Button>
      )}
    </div>
  );
};

const SentThread = ({
  comment,
  surface,
  associated,
  selected,
  identity,
  thread,
  expanded,
  resolved,
  onToggle,
  onResolve,
  onJump,
  onAssociate,
  onReplySent,
  onShowAgent,
  onCancelRequest,
  onDelete,
  onRevert,
  currentSnapshot,
  reply,
  onReplyChange,
  isReplying,
  onReply,
  writeAvailability,
  compact = false,
  queuePosition,
  suppressPendingStatus = false,
}: {
  readonly comment: ReviewComment;
  readonly surface: StagedCardSurface;
  readonly associated: boolean;
  readonly selected: boolean;
  readonly identity: RuntimeIdentity | null;
  readonly thread: CommentThreadProjection<AgentRequest, AgentResponse>;
  readonly expanded: boolean;
  readonly resolved: boolean;
  readonly onToggle: () => void;
  readonly onResolve: () => void;
  readonly onJump: () => void;
  readonly onAssociate: (target: CommentTarget | null) => void;
  readonly onReplySent: (message: string) => void;
  readonly onShowAgent: () => void;
  readonly onCancelRequest: (requestId: string) => void;
  readonly onDelete: () => void;
  readonly onRevert: (requestId: string, commentId: string) => void;
  readonly currentSnapshot: string;
  /**
   * Reply text is owned above this card, because one thread can be on screen
   * twice - in the rail and inline - and because unsent reply text is part of
   * what a reload must give back.
   */
  readonly reply: string;
  readonly onReplyChange: (body: string) => void;
  readonly isReplying: boolean;
  readonly onReply: (body: string) => void;
  /** Whether a reply, delete, revert, or cancel from this thread can land. */
  readonly writeAvailability: ReviewWriteAvailability;
  readonly compact?: boolean;
  readonly queuePosition?: number;
  readonly suppressPendingStatus?: boolean;
}) => {
  const {
    exchanges,
    latestExchange,
    latestChanged,
    latestStatus,
    latestPending,
    latestCanceled,
    canDeleteQueued,
    canDeleteCanceled,
    deleteUnlockedByAbandonedClaim,
    group,
  } = thread;
  useEffect(() => {
    if (
      identity === null ||
      latestChanged === undefined ||
      latestChanged.response === undefined
    )
      return;
    const from =
      latestChanged.request.baselineSnapshot ??
      latestChanged.request.premiseSnapshot;
    void cachedSnapshotDiff(
      identity,
      from,
      latestChanged.response.resultSnapshot,
    ).catch(() => undefined);
  }, [identity, latestChanged]);
  const outcome = latestExchange?.outcome;
  const targetPresent = targetElement(comment.target) !== null;
  const cardClass = `mt-2 min-w-0 w-full overflow-hidden border border-edge transition-shadow data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-lifted data-[review-selected=true]:outline-3 data-[review-selected=true]:outline-offset-1 data-[review-selected=true]:outline-[color-mix(in_srgb,var(--annotation-c)_45%,var(--bg))] ${group === "working" ? "border-[var(--callout-note-c)]!" : ""} ${surface === "rail" ? "max-w-none bg-comment-body! p-0! shadow-raised" : "max-w-[17rem] bg-comment-body!"}`;
  const associate = () => onAssociate(comment.target);
  const railFreshness = threadTime(
    latestExchange?.response?.createdAt ??
      latestExchange?.request.createdAt ??
      comment.createdAt,
  );
  const railState = resolved
    ? "Resolved"
    : group === "needs-input"
      ? outcome?.state === "warning"
        ? "Warning"
        : "Respond"
      : latestCanceled
        ? "Canceled"
        : group === "ready"
          ? outcome?.state === "changed"
            ? "Changed"
            : outcome?.state === "declined"
              ? "Declined"
              : "Ready"
          : group === "working"
            ? "Working"
            : "Queued";
  const railTime = railFreshness === "Just now" ? "just now" : railFreshness;
  const latestChangeWasReverted =
    latestChanged !== undefined &&
    latestChanged.baselineSnapshot === currentSnapshot;
  const canRevertLatestChange =
    latestChanged?.response?.resultSnapshot === currentSnapshot;
  // One label for every revert control in this thread. After a successful
  // revert the control stays visible in the still-open thread, so it must
  // say the revert happened rather than blame a newer plan change.
  const revertActionLabel = canRevertLatestChange
    ? "Revert response"
    : latestChangeWasReverted
      ? "Response reverted"
      : "Revert unavailable - the plan changed again";
  const canDeleteComment =
    canDeleteQueued || canDeleteCanceled || latestChangeWasReverted;
  // An affordance a pickup had taken away says why it is back, wherever it
  // appears. The rail and the summary card have room for the label alone, so
  // the label carries the reason and the expanded card explains it in full.
  const deleteKind = sentDeleteKind({ thread, currentSnapshot });
  const deleteCommentLabel =
    deleteKind === "reverted"
      ? "Delete comment"
      : deleteKind === "canceled"
        ? "Delete canceled comment"
        : deleteKind === "abandoned"
          ? "Delete comment - the agent that picked it up stopped reporting"
          : "Delete queued comment";

  // Every control in this thread that writes - replying, deleting, reverting,
  // and canceling - is held back by the same answer, so a reviewer is told the
  // session cannot take a change before acting rather than after.
  const replyBlock = reviewWriteBlock(writeAvailability);
  const [resolvedWorkError, setResolvedWorkError] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!resolved) setResolvedWorkError(null);
  }, [resolved]);
  const shownResolvedWorkError = resolved ? resolvedWorkError : null;
  const sendReply = (bodyOverride?: string) => {
    const body = (bodyOverride ?? reply).trim();
    if (identity === null || body === "") return;
    if (resolved) {
      setResolvedWorkError(RESOLVED_THREAD_NEW_WORK_ERROR);
      return;
    }
    setResolvedWorkError(null);
    onReply(body);
  };

  if (!expanded) {
    if (surface === "thread") {
      return (
        <ContextualCommentSummary
          status={
            resolved
              ? "Resolved"
              : latestCanceled
                ? "Canceled"
                : group === "working"
                  ? "Working"
                  : group === "ready"
                    ? "Ready for review"
                    : group === "needs-input"
                      ? "Respond"
                      : "Queued"
          }
          statusSpinner={group === "working"}
          statusIcon={
            resolved
              ? CHECK_ICON
              : group === "needs-input"
                ? MESSAGE_SQUARE_ICON
                : latestStatus?.stage === "blocked" ||
                    latestStatus?.stage === "offline"
                  ? TRIANGLE_ALERT_ICON
                  : latestCanceled
                    ? CIRCLE_X_ICON
                    : group === "ready"
                      ? CHECK_ICON
                      : group === "working"
                        ? undefined
                        : HOURGLASS_ICON
          }
          statusIconLabel={latestStatus?.headline}
          statusClassName={
            resolved
              ? "bg-surface text-muted"
              : latestStatus?.stage === "blocked" ||
                  latestStatus?.stage === "offline"
                ? "bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]"
                : latestCanceled
                  ? "bg-[var(--callout-danger-bg)] text-[var(--callout-danger-c)]"
                  : group === "ready"
                    ? "bg-accent-soft text-accent"
                    : group === "needs-input"
                      ? "bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]"
                      : group === "working"
                        ? "bg-[var(--callout-note-bg)] text-[var(--callout-note-c)]"
                        : "bg-surface text-muted"
          }
          body={comment.body}
          associated={associated}
          threadGroup={group}
          commentId={comment.id}
          onExpand={() => {
            onJump();
            onToggle();
          }}
          onAssociate={(active) => onAssociate(active ? comment.target : null)}
        >
          {canDeleteComment ? (
            <ThreadIconButton
              label={deleteCommentLabel}
              icon={TRASH_2_ICON}
              onClick={onDelete}
              tone="danger"
            />
          ) : null}
          {!latestPending ? (
            <ThreadIconButton
              label={resolved ? "Unresolve thread" : "Resolve thread"}
              icon={CHECK_ICON}
              onClick={onResolve}
            />
          ) : null}
          {latestChanged === undefined ? null : (
            <ThreadIconButton
              label={revertActionLabel}
              icon={ROTATE_CCW_ICON}
              disabled={!canRevertLatestChange}
              onClick={() =>
                latestChanged === undefined
                  ? undefined
                  : onRevert(latestChanged.request.requestId, comment.id)
              }
            />
          )}
        </ContextualCommentSummary>
      );
    }
    if (compact) {
      return (
        <CompactRailComment
          target={comment.target}
          body={comment.body}
          associated={associated}
          status={group === "working" ? "Working" : "Queued"}
          queuePosition={queuePosition}
          threadGroup={group}
          commentId={comment.id}
          onExpand={onToggle}
          onAssociate={(active) => onAssociate(active ? comment.target : null)}
        >
          {canDeleteComment ? (
            <ThreadIconButton
              label={deleteCommentLabel}
              icon={TRASH_2_ICON}
              onClick={onDelete}
              tone="danger"
            />
          ) : null}
        </CompactRailComment>
      );
    }
    return (
      <Card
        className={cardClass}
        density="dense"
        elevation="none"
        onPointerEnter={associate}
        onPointerLeave={(event) => {
          if (!event.currentTarget.contains(document.activeElement))
            onAssociate(null);
        }}
        onFocus={associate}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            onAssociate(null);
        }}
        data-review-sent-thread={group}
        data-review-comment-id={comment.id}
        data-review-comment-ui=""
        data-review-associated={associated ? "true" : undefined}
        data-review-selected={selected ? "true" : undefined}
      >
        <CommentCardHeader
          target={comment.target}
          surface={surface}
          metaClassName="review-thread-meta"
          targetClassName="review-sent-target"
          actionsClassName="review-thread-actions"
          onJump={onJump}
          onHeaderClick={onToggle}
          onTargetClick={onJump}
        >
          <ThreadIconButton
            label="Expand thread"
            icon={MAXIMIZE_2_ICON}
            onClick={onToggle}
          />
          {canDeleteComment ? (
            <ThreadIconButton
              label={deleteCommentLabel}
              icon={TRASH_2_ICON}
              onClick={onDelete}
              tone="danger"
            />
          ) : null}
          {latestChanged === undefined ? null : (
            <ThreadIconButton
              label={revertActionLabel}
              icon={ROTATE_CCW_ICON}
              disabled={!canRevertLatestChange}
              onClick={() =>
                latestChanged === undefined
                  ? undefined
                  : onRevert(latestChanged.request.requestId, comment.id)
              }
              tone="danger"
            />
          )}
          <ThreadIconButton
            label={resolved ? "Unresolve thread" : "Resolve thread"}
            icon={CHECK_ICON}
            onClick={onResolve}
            tone="positive"
          />
        </CommentCardHeader>
        <div className="p-3">
          <ReviewerMessagePreview body={comment.body} onExpand={onToggle} />
          <div className="review-sent-metadata mt-2 flex min-w-0 items-center justify-between gap-2 border-t border-edge pt-2 text-xs text-muted">
            <span className="flex min-w-0 items-baseline gap-1.5 truncate">
              <span className="font-medium">{railState}</span>
              <time className="review-sent-time text-2xs font-normal text-subtle">
                {railTime}
              </time>
            </span>
            {resolved ? (
              <button
                type="button"
                className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                onClick={onResolve}
              >
                Unresolve
              </button>
            ) : !latestPending ? (
              <button
                type="button"
                className="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                onClick={() => {
                  onJump();
                  onToggle();
                }}
              >
                {group === "needs-input" ? "Reply" : "Review"}
              </button>
            ) : (
              <button
                type="button"
                className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-muted hover:text-danger hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                onClick={() =>
                  onCancelRequest(latestExchange?.request.requestId ?? "")
                }
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cardClass}
      density={surface === "rail" ? "dense" : "compact"}
      elevation={surface === "rail" ? "none" : "floating"}
      onPointerEnter={associate}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement))
          onAssociate(null);
      }}
      onFocus={() => onAssociate(comment.target)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          onAssociate(null);
      }}
      data-review-sent-thread={group}
      data-review-comment-id={comment.id}
      data-review-comment-ui=""
      data-review-associated={associated ? "true" : undefined}
      data-review-selected={selected ? "true" : undefined}
    >
      <CommentCardHeader
        target={comment.target}
        surface={surface}
        metaClassName="review-thread-meta"
        targetClassName="review-sent-target"
        actionsClassName="review-thread-actions"
        onJump={onJump}
        onHeaderClick={onToggle}
        onTargetClick={surface === "rail" ? onJump : undefined}
      >
        <ThreadIconButton
          label="Minimize thread"
          icon={MINIMIZE_2_ICON}
          onClick={onToggle}
        />
        {canDeleteComment ? (
          <ThreadIconButton
            label={deleteCommentLabel}
            icon={TRASH_2_ICON}
            onClick={onDelete}
            tone="danger"
          />
        ) : null}
        {latestChanged === undefined ? null : (
          <ThreadIconButton
            label={revertActionLabel}
            icon={ROTATE_CCW_ICON}
            disabled={!canRevertLatestChange}
            onClick={() =>
              latestChanged === undefined
                ? undefined
                : onRevert(latestChanged.request.requestId, comment.id)
            }
            tone="danger"
          />
        )}
        <ThreadIconButton
          label={resolved ? "Unresolve thread" : "Resolve thread"}
          icon={CHECK_ICON}
          onClick={onResolve}
          tone="positive"
        />
      </CommentCardHeader>
      <div className={surface === "rail" ? "min-w-0 p-3" : ""}>
        {!targetPresent ? (
          <p className="mt-3 mb-0 rounded-md bg-[var(--callout-warning-bg)] p-2 text-xs text-[var(--callout-warning-ink)] [overflow-wrap:anywhere]">
            The part of the plan you commented on has since been changed. You
            can still review this thread, but won&apos;t see a full diff.
          </p>
        ) : null}
        {deleteUnlockedByAbandonedClaim ? (
          <p
            className="mt-3 mb-0 rounded-md bg-[var(--callout-warning-bg)] p-2 text-xs text-[var(--callout-warning-ink)] [overflow-wrap:anywhere]"
            data-review-abandoned-claim-unlock
          >
            {`${ABANDONED_CLAIM_REASON} You can delete this comment again. ${ABANDONED_CLAIM_CONSEQUENCE}`}
          </p>
        ) : null}
        <div
          className="mt-2 max-h-[30rem] w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto pr-1"
          data-review-thread-scroll=""
        >
          {exchanges.length === 0 ? (
            <MessageTurn
              role="user"
              surface="thread"
              body={comment.body}
              createdAt={comment.createdAt}
              delivery="Saved"
            />
          ) : (
            exchanges.map(
              ({
                request,
                response,
                outcome: requestOutcome,
                status: requestStatus,
                delivery,
                activity,
              }) => {
                const sharedConnectionState =
                  surface === "rail" &&
                  (requestStatus.stage === "blocked" ||
                    requestStatus.stage === "offline");
                return (
                  <div key={request.requestId}>
                    <MessageTurn
                      role="user"
                      surface="thread"
                      body={
                        request.kind === "feedback"
                          ? comment.body
                          : (request.body ?? "")
                      }
                      createdAt={request.createdAt}
                      delivery={delivery}
                    >
                      {response === undefined ? (
                        <StalePremiseNotice
                          comment={comment}
                          identity={identity}
                          currentSnapshot={currentSnapshot}
                          onStatus={onReplySent}
                        />
                      ) : null}
                    </MessageTurn>
                    {requestOutcome === undefined || response === undefined ? (
                      suppressPendingStatus ? null : sharedConnectionState ? (
                        <button
                          type="button"
                          className="mt-2 ml-auto block cursor-pointer border-0 bg-transparent p-0 text-2xs text-muted underline underline-offset-[0.16em] hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                          onClick={() => onCancelRequest(request.requestId)}
                        >
                          Cancel request
                        </button>
                      ) : (
                        <RequestStatusStrip
                          status={requestStatus}
                          activity={activity}
                          surface="thread"
                          commentCount={
                            request.kind === "feedback"
                              ? Math.max(1, requestCommentIds(request).length)
                              : 1
                          }
                          onShowAgent={onShowAgent}
                          onCancelRequest={() =>
                            onCancelRequest(request.requestId)
                          }
                        />
                      )
                    ) : (
                      <MessageTurn
                        role="agent"
                        surface="thread"
                        body={requestOutcome.message}
                        createdAt={response.createdAt}
                      >
                        <Badge
                          tone={
                            requestOutcome.state === "changed"
                              ? "statusAccent"
                              : requestOutcome.state === "warning" ||
                                  requestOutcome.state === "needs-input"
                                ? "statusWarning"
                                : "statusNeutral"
                          }
                          size="status"
                          className={
                            requestOutcome.state === "needs-input" ||
                            requestOutcome.state === "warning"
                              ? "mt-2 gap-1 bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]"
                              : "mt-2"
                          }
                        >
                          {/* The hazard glyph belongs with the word it
                              qualifies, not beside the action further down;
                              proximity is what makes the pair read as one
                              label. */}
                          {requestOutcome.state === "warning" ? (
                            <span
                              className="inline-flex [&>svg]:size-3.5"
                              aria-hidden="true"
                            >
                              <Icon icon={TRIANGLE_ALERT_ICON} />
                            </span>
                          ) : null}
                          {requestOutcome.state === "answered"
                            ? "Answered"
                            : requestOutcome.state === "changed"
                              ? "Changed"
                              : requestOutcome.state === "warning"
                                ? "Warning"
                                : requestOutcome.state === "needs-input"
                                  ? "Needs your answer"
                                  : "Declined"}
                        </Badge>
                        {/* The agent-authored one-line reason scans directly
                            under the badge as emphasized text, never a second
                            badge; the badge alone carries the hazard glyph. */}
                        {requestOutcome.state === "warning" &&
                        requestOutcome.summary !== undefined ? (
                          <p className="mt-1.5 text-xs text-[var(--callout-warning-c)]">
                            <em>{requestOutcome.summary}</em>
                          </p>
                        ) : null}
                        {requestOutcome.state === "warning" ? (
                          <div className="mt-2 flex items-center gap-2 border-t border-[color-mix(in_srgb,var(--callout-warning-c)_24%,transparent)] pt-2">
                            <Button
                              variant="accentOutline"
                              size="micro"
                              disabled={isReplying || latestPending}
                              onClick={() => void sendReply("Do it anyway.")}
                            >
                              {isReplying ? "Sending…" : "Do it anyway"}
                            </Button>
                          </div>
                        ) : null}
                        {requestOutcome.state === "changed" &&
                        identity !== null ? (
                          <ChangeAttachment
                            key={`${request.requestId}:${response.resultSnapshot}`}
                            identity={identity}
                            request={request}
                            response={response}
                            changeTargets={requestOutcome.changeTargets}
                            currentSnapshot={currentSnapshot}
                            onStatus={onReplySent}
                            onResolve={
                              latestChanged?.request.requestId ===
                              request.requestId
                                ? onResolve
                                : undefined
                            }
                            onRevert={
                              latestChanged?.request.requestId ===
                              request.requestId
                                ? () => onRevert(request.requestId, comment.id)
                                : undefined
                            }
                            canRevert={
                              latestChanged?.request.requestId ===
                                request.requestId && canRevertLatestChange
                            }
                            thread={{ label: comment.body, onOpen: onJump }}
                            onKeepChatting={() => {
                              onJump();
                              window.setTimeout(
                                () =>
                                  document
                                    .getElementById(`reply-${comment.id}`)
                                    ?.focus(),
                                0,
                              );
                            }}
                          />
                        ) : null}
                      </MessageTurn>
                    )}
                  </div>
                );
              },
            )
          )}
        </div>
        {identity === null ? null : (
          <div className="mt-3 border-t border-edge pt-3">
            {latestExchange?.response === undefined ? null : (
              <section
                className="mb-3 grid grid-cols-[minmax(0,1fr)] gap-2"
                data-review-thread-next-steps
              >
                <strong className="text-2xs font-bold uppercase tracking-caps text-subtle">
                  Next steps
                </strong>
                <div className="flex items-center gap-1">
                  <ThreadIconButton
                    label="Minimize thread"
                    icon={MINIMIZE_2_ICON}
                    onClick={onToggle}
                  />
                  {canDeleteComment ? (
                    <ThreadIconButton
                      label={deleteCommentLabel}
                      icon={TRASH_2_ICON}
                      onClick={onDelete}
                      tone="danger"
                    />
                  ) : null}
                  {latestChanged === undefined ? null : (
                    <ThreadIconButton
                      label={revertActionLabel}
                      icon={ROTATE_CCW_ICON}
                      disabled={!canRevertLatestChange}
                      onClick={() =>
                        latestChanged === undefined
                          ? undefined
                          : onRevert(
                              latestChanged.request.requestId,
                              comment.id,
                            )
                      }
                      tone="danger"
                    />
                  )}
                  <Button
                    variant="accentOutline"
                    size="micro"
                    aria-label={
                      resolved ? "Unresolve thread" : "Resolve thread"
                    }
                    onClick={onResolve}
                  >
                    <Icon icon={CHECK_ICON} />
                    {resolved ? "Unresolve thread" : "Resolve thread"}
                  </Button>
                </div>
              </section>
            )}
            <ComposeImages
              id={`reply-${comment.id}`}
              identity={identity}
              writeAvailability={writeAvailability}
              label="Reply to the agent"
              textareaClassName="mt-1 min-h-20"
              body={reply}
              maxLength={BODY_LIMIT}
              placeholder="Reply to the agent…"
              onBodyChange={onReplyChange}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void sendReply();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              {replyBlock === undefined &&
              shownResolvedWorkError === null ? null : (
                <span
                  className="text-2xs font-semibold text-danger"
                  role={shownResolvedWorkError === null ? undefined : "alert"}
                >
                  {shownResolvedWorkError ?? replyBlock?.label}
                </span>
              )}
              <Tooltip
                label={replyBlock?.cause ?? `Reply · ${MODIFIER_SHORTCUT}`}
              >
                <Button
                  size="compact"
                  disabled={
                    reply.trim() === "" ||
                    isReplying ||
                    replyBlock !== undefined
                  }
                  onClick={() => void sendReply()}
                >
                  {isReplying ? "Sending…" : "Reply"}
                </Button>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

const ChatExchange = ({
  request,
  response,
  delivery,
  identity,
  status,
  activity,
  onStatus,
  onShowAgent,
  onCancelRequest,
  currentSnapshot,
}: {
  readonly request: AgentRequest;
  readonly response: AgentResponse | undefined;
  readonly delivery: RequestDelivery;
  readonly identity: RuntimeIdentity;
  readonly status: AgentStatus;
  readonly activity: ReadonlyArray<MessageActivity>;
  readonly onStatus: (message: string) => void;
  readonly onShowAgent: () => void;
  readonly onCancelRequest: (requestId: string) => void;
  readonly currentSnapshot: string;
}) => {
  const hasChanges =
    response !== undefined &&
    (request.baselineSnapshot ?? request.premiseSnapshot) !==
      response.resultSnapshot;
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <MessageTurn
        role="user"
        surface="chat"
        body={request.body ?? ""}
        createdAt={request.createdAt}
        delivery={delivery}
      />
      {response === undefined ? (
        <div className="min-w-0 w-[calc(100%_-_1.5rem)] rounded-lg border border-dashed border-edge bg-paper px-2 py-2 text-muted">
          <RequestStatusStrip
            status={status}
            activity={activity}
            surface="chat"
            onShowAgent={onShowAgent}
            onCancelRequest={() => onCancelRequest(request.requestId)}
          />
        </div>
      ) : (
        <MessageTurn
          role="agent"
          surface="chat"
          body={response.message ?? ""}
          createdAt={response.createdAt}
        >
          {hasChanges ? (
            <ChangeAttachment
              key={`${request.requestId}:${response.resultSnapshot}`}
              identity={identity}
              request={request}
              response={response}
              currentSnapshot={currentSnapshot}
              onStatus={onStatus}
            />
          ) : null}
        </MessageTurn>
      )}
    </li>
  );
};

export const ReviewController = () => {
  const { closeTour } = useDiffTour();
  const identity = useMemo(runtimeIdentity, []);
  const initialSnapshot = useMemo(bootstrapSnapshot, []);
  const planId =
    identity?.planId ?? rootElement.getAttribute("data-plan-id") ?? "";
  const blockHosts = useBlockHosts();
  const imageHosts = useImageHosts();
  const reviewContainerHosts = useReviewContainerHosts();
  const feedbackHost = useFeedbackHost();
  const [drafts, setDrafts] = useState<ReadonlyArray<ReviewComment>>([]);
  const [sent, setSent] = useState<ReadonlyArray<ReviewComment>>([]);
  const [resolvedCommentIds, setResolvedCommentIds] = useState<
    ReadonlySet<string>
  >(new Set());
  // The runtime's own words when it refuses a resolve. A refused resolve
  // reverts, so without this the thread would simply spring back unexplained.
  const [resolveRefusal, setResolveRefusal] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [composeBody, setComposeBody] = useState("");
  const [detachedComposer, setDetachedComposer] =
    useState<RecoveredComposer["comment"]>(null);
  const [pendingCompose, setPendingCompose] = useState<ComposeState | null>(
    null,
  );
  const [selectionControl, setSelectionControl] =
    useState<SelectionControlState | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<FeedbackTab>("comments");
  const sidebarRef = useRef<HTMLElement>(null);
  const [sidebarView, setSidebarView] = useState<SidebarView>("feedback");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatBody, setChatBody] = useState("");
  const [archivedChatRequestIds, setArchivedChatRequestIds] = useState<
    ReadonlySet<string>
  >(() =>
    planId === "" ? new Set<string>() : readArchivedChatRequestIds(planId),
  );
  const [commentQuery, setCommentQuery] = useState("");
  const [unsavedInputKeys, setUnsavedInputKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Only threads with text are held, so emptiness is a size check rather than
  // a scan, and the recovery snapshot never carries blank entries.
  const [replyDrafts, setReplyDrafts] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const replyDraftsRef = useRef<ReadonlyMap<string, string>>(new Map());
  const [replyPendingCommentIds, setReplyPendingCommentIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const replyPendingCommentIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [recoveryReconciliation, setRecoveryReconciliation] =
    useState<ReviewRecoveryReconciliation>(emptyReviewRecoveryReconciliation);
  const recoveryReconciliationRef = useRef<ReviewRecoveryReconciliation>(
    recoveryReconciliation,
  );
  const replaceRecoveryReconciliation = useCallback(
    (next: ReviewRecoveryReconciliation): void => {
      recoveryReconciliationRef.current = next;
      setRecoveryReconciliation(next);
    },
    [],
  );
  const recoveryConflicts = recoveryReconciliation.conflicts;
  const [isRecoveryConflictOpen, setIsRecoveryConflictOpen] = useState(false);
  const [agent, setAgent] = useState<AgentSnapshot>(emptyAgentSnapshot);
  const [hasObservedAgentSnapshot, setHasObservedAgentSnapshot] =
    useState(false);
  const [displayedSnapshot, setDisplayedSnapshot] = useState(initialSnapshot);
  const [cancelPendingRequestIds, setCancelPendingRequestIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [progress, setProgress] = useState<ReadonlyArray<ProgressEvent>>([]);
  const [runtimeSession, setRuntimeSession] = useState<RuntimeSession | null>(
    null,
  );
  const runtimeSessionOrder = useMemo(createRuntimeSessionOrder, []);
  const acceptRuntimeSession = useCallback(
    ({ sequence, session }: { sequence: number; session: RuntimeSession }) => {
      const decision = runtimeSessionOrder.decide({ sequence, session });
      if (decision.kind === "apply") {
        setRuntimeSession(decision.session);
      }
    },
    [runtimeSessionOrder],
  );
  const [storedAnswers, setStoredAnswers] = useState<
    ReadonlyArray<StagedDecisionAnswer>
  >([]);
  const [supersededDecisionIds, setSupersededDecisionIds] = useState<
    ReadonlyArray<string>
  >([]);
  const [pollHealth, setPollHealth] = useState<ReviewPollHealth>(
    INITIAL_REVIEW_POLL_HEALTH,
  );
  const [statusNowMs, setStatusNowMs] = useState(Date.now());
  const [lastObservableAgentAtMs, setLastObservableAgentAtMs] =
    useState(statusNowMs);
  const [threadOpenState, setThreadOpenState] = useState<ThreadOpenState>(
    new Map(),
  );
  const [expandedBodies, setExpandedBodies] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [expandedRailDraftIds, setExpandedRailDraftIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [submitRightAway, setSubmitRightAway] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [pendingRevert, setPendingRevert] = useState<PendingRevert | null>(
    null,
  );
  const [associatedTarget, setAssociatedTarget] =
    useState<CommentTarget | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    null,
  );
  const [associationActive, setAssociationActive] = useState(false);
  const [status, setStatus] = useState(
    identity === null
      ? "Reading offline: drafts stay in this browser."
      : "Loading review…",
  );
  useEffect(() => {
    if (planId !== "") {
      writeArchivedChatRequestIds(planId, archivedChatRequestIds);
    }
  }, [archivedChatRequestIds, planId]);
  const currentSnapshot = agent.currentSnapshot || displayedSnapshot;
  const pollIsOffline = reviewPollIsOffline(pollHealth);
  const serverGone = reviewRuntimeIsDown(pollHealth);
  // Only a runtime that is answering can report this, so it never competes
  // with the banner for a runtime that has gone entirely.
  const writesStalled =
    !serverGone && runtimeSession?.writesStalledMs !== undefined;
  // Evaluate the remembered deadline from when contact was actually lost. The
  // live status clock would otherwise change this observation after the banner
  // appeared by advancing past a deadline that was still future at contact loss.
  const runtimeDownSinceMs = reviewRuntimeDownSinceMs(pollHealth);
  const endReason = reviewEndReason({
    expiresAtMs: runtimeSession?.expiresAtMs,
    idleTimeoutMs: runtimeSession?.idleTimeoutMs,
    nowMs: runtimeDownSinceMs ?? statusNowMs,
  });
  const threadRuntime: ThreadRuntime =
    identity === null ? "static" : pollIsOffline ? "offline" : "online";
  const agentProjection = agentProjectionForReviewPoll({
    health: pollHealth,
    hasObservedAgentSnapshot,
    lastObservableAtMs: lastObservableAgentAtMs,
    nowMs: statusNowMs,
  });
  const agentPresenceIsObservable = agentProjection.state === "observable";
  const agentStatusIsAvailable =
    agentPresenceIsObservable || agentProjection.state === "agent-unavailable";
  const agentProjectionNowMs = agentProjection.nowMs;
  const agentEndedAtMs = agent.presence.endedAtMs;
  const agentConnection = projectAgentConnectionState({
    presenceConnected: agent.presence.connected,
    heartbeatAt: agent.presence.updatedAtMs ?? 0,
    ...(agentEndedAtMs === undefined ? {} : { endedAtMs: agentEndedAtMs }),
    now: agentProjectionNowMs,
    events: agent.connectionLog,
  });
  const agentConnected = agentConnection.connected;
  // Reachability and acceptance are different questions once a runtime can
  // stall: every write path asks this one, so the page stops sending changes
  // the runtime has already reported it will refuse.
  const runtimeAcceptsWrites = reviewRuntimeAcceptsWrites({
    health: pollHealth,
    writesStalledMs: runtimeSession?.writesStalledMs,
  });
  // The one answer every explicit mutation path consults before submitting.
  // Memoized because handlers and effects depend on it, and a fresh object per
  // render would re-run the writers this is meant to hold back.
  const writeAvailability = useMemo(
    () =>
      reviewWriteAvailability({
        hasReviewSession: identity !== null,
        health: pollHealth,
        writesStalledMs: runtimeSession?.writesStalledMs,
        authoritative: runtimeSession?.authoritative,
      }),
    [
      identity,
      pollHealth,
      runtimeSession?.authoritative,
      runtimeSession?.writesStalledMs,
    ],
  );
  const reviewAuthority: ReviewAuthority =
    identity === null || runtimeSession === null
      ? "unknown"
      : runtimeSession.authoritative
        ? "writable"
        : "read-only";
  const canSendToAgent =
    identity !== null &&
    threadRuntime === "online" &&
    writeAvailability.state === "available";
  const commentSubmitAvailability = deriveReviewCommentSubmitAvailability({
    canSubmit: identity === null || canSendToAgent,
    writeAvailability,
  });
  const unresolvedDrafts = useMemo(
    () => drafts.filter((comment) => !resolvedCommentIds.has(comment.id)),
    [drafts, resolvedCommentIds],
  );
  const resolvedDrafts = useMemo(
    () => drafts.filter((comment) => resolvedCommentIds.has(comment.id)),
    [drafts, resolvedCommentIds],
  );
  const reviewComments = useMemo(
    () => [
      ...unresolvedDrafts,
      ...sent.filter((comment) => !resolvedCommentIds.has(comment.id)),
    ],
    [resolvedCommentIds, sent, unresolvedDrafts],
  );
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const [liveRecoveryOwnerId, setLiveRecoveryOwnerId] = useState<string | null>(
    null,
  );
  const [isLiveRecoveryAvailable, setIsLiveRecoveryAvailable] = useState(true);
  // The version the next conditional write must carry.
  const runtimeVersionRef = useRef("");
  const [persistedReviewState, setPersistedReviewState] = useState<
    string | null
  >(null);
  const persistedReviewStateRef = useRef<string | null>(null);
  const currentReviewState = persistedReviewFingerprint({
    drafts,
    resolvedCommentIds,
  });
  const latestReviewStateRef = useRef<{
    readonly generation: number;
    readonly fingerprint: string;
    readonly state: ReviewRecoveryState;
  }>({
    generation: 0,
    fingerprint: currentReviewState,
    state: { drafts, resolvedCommentIds },
  });
  // Render must stay pure: React may replay or discard a render, and a
  // generation bumped there could describe state that never committed and then
  // reach a conditional write. Every reader of this ref runs after commit, and
  // this effect is declared before them, so they still see the current value.
  useEffect(() => {
    if (latestReviewStateRef.current.fingerprint === currentReviewState) return;
    latestReviewStateRef.current = {
      generation: latestReviewStateRef.current.generation + 1,
      fingerprint: currentReviewState,
      state: { drafts, resolvedCommentIds },
    };
  }, [currentReviewState, drafts, resolvedCommentIds]);
  const markPersistedReviewState = useCallback((fingerprint: string): void => {
    persistedReviewStateRef.current = fingerprint;
    setPersistedReviewState(fingerprint);
  }, []);
  const applyReviewState = useCallback((state: ReviewRecoveryState): void => {
    const fingerprint = persistedReviewFingerprint(state);
    const current = latestReviewStateRef.current;
    latestReviewStateRef.current = {
      generation:
        current.fingerprint === fingerprint
          ? current.generation
          : current.generation + 1,
      fingerprint,
      state,
    };
    setDrafts(state.drafts);
    setResolvedCommentIds(state.resolvedCommentIds);
  }, []);
  const canRefreshReview =
    persistedReviewState === currentReviewState &&
    composeBody === "" &&
    chatBody === "" &&
    replyDrafts.size === 0 &&
    unsavedInputKeys.size === 0;
  const pendingDecisionInputs = useRef<Map<string, PendingDecisionInput>>(
    new Map(),
  );
  const isFlushingDecisionInputs = useRef(false);
  const reviewAuthorityRef = useRef<ReviewAuthority>("unknown");
  // The revision of the newest answers record this page has applied. A response
  // that is strictly older lost a race with a completed write and is dropped;
  // an equal one is applied, because the same revision read against an edited
  // plan legitimately answers with a different set of current answers.
  const appliedAnswerRevision = useRef(-1);
  // The decisions this page has told a card to show as answered. A card cannot
  // work out on its own that an answer stopped applying, and a replaced article
  // is replayed from the last known record before the fresh one arrives, so the
  // difference between the two passes is what has to be taken back.
  const appliedDecisionIds = useRef<ReadonlySet<string>>(new Set());
  const displayedSnapshotRef = useRef(displayedSnapshot);
  const justSubmittedCommentIds = useRef<ReadonlySet<string>>(new Set());
  const onUnsavedInputChange = useCallback<UnsavedInputChange>(
    (key, hasUnsavedInput) => {
      setUnsavedInputKeys((current) => {
        if (current.has(key) === hasUnsavedInput) return current;
        const next = new Set(current);
        if (hasUnsavedInput) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [],
  );
  const replaceReplyDrafts = useCallback(
    (replies: ReadonlyMap<string, string>): void => {
      replyDraftsRef.current = replies;
      setReplyDrafts(replies);
    },
    [],
  );
  const composerRecovery = useMemo<RecoveredComposer>(
    () => ({
      comment:
        compose === null || composeBody === ""
          ? detachedComposer
          : {
              target: compose.target,
              premiseSnapshot: compose.premiseSnapshot,
              body: composeBody,
            },
      replies: replyDrafts,
    }),
    [compose, composeBody, detachedComposer, replyDrafts],
  );
  const composerRecoveryRef = useRef(composerRecovery);
  // Kept out of render for the same reason as the review-state ref above.
  useEffect(() => {
    composerRecoveryRef.current = composerRecovery;
  }, [composerRecovery]);
  /** Gives back typed comment text, and says when it had nowhere to go. */
  const restoreComposer = useCallback(
    (composer: RecoveredComposer): "restored" | "detached" => {
      replaceReplyDrafts(composer.replies);
      const recovered = composer.comment;
      if (recovered === null) return "restored";
      // A comment is written against a place in the plan. If that place is
      // gone, the text has nowhere to attach, and saying so beats reattaching
      // it to whatever happens to be there now.
      const element = targetElement(recovered.target);
      if (
        element === null ||
        (recovered.target.type === "selection" &&
          !selectionTargetResolves(recovered.target))
      ) {
        setCompose(null);
        setComposeBody("");
        setDetachedComposer(recovered);
        return "detached";
      }
      setDetachedComposer(null);
      setCompose({
        target: recovered.target,
        premiseSnapshot: recovered.premiseSnapshot,
        ...composePlacement({
          target: recovered.target,
          top: element.getBoundingClientRect().top,
        }),
      });
      setComposeBody(recovered.body);
      return "restored";
    },
    [replaceReplyDrafts],
  );
  /** Takes the runtime's answer as the version the next write must carry. */
  const observeRuntimeReviewState = useCallback(
    (snapshot: ReviewSnapshot): ReviewRecoveryState => {
      const state: ReviewRecoveryState = {
        drafts: snapshot.drafts,
        resolvedCommentIds: new Set(snapshot.resolvedCommentIds),
      };
      runtimeVersionRef.current = snapshot.version;
      return state;
    },
    [],
  );
  const reconcileAuthoritativeReviewSnapshot = useCallback(
    ({
      snapshot,
      base,
      local,
      preferredSent = [],
      submittedBodies,
    }: {
      readonly snapshot: ReviewSnapshot;
      readonly base: ReviewRecoveryBase;
      readonly local: ReviewRecoveryState;
      readonly preferredSent?: ReadonlyArray<ReviewComment>;
      readonly submittedBodies?: ReadonlyMap<string, string>;
    }) => {
      const runtime = observeRuntimeReviewState(snapshot);
      const merged = mergeLiveReviewRecovery({
        base,
        local,
        runtime,
        sent: snapshot.sent,
        submittedBodies,
      });
      markPersistedReviewState(persistedReviewFingerprint(runtime));
      applyReviewState(merged.state);
      setSent((current) => {
        const localById = new Map(
          [...current, ...preferredSent].map((comment) => [
            comment.id,
            comment,
          ]),
        );
        return snapshot.sent.map(
          (comment) => localById.get(comment.id) ?? comment,
        );
      });
      replaceReplyDrafts(
        repliesForSentComments({
          replies: replyDraftsRef.current,
          sent: snapshot.sent,
        }),
      );
      if (merged.conflicts.length > 0) {
        replaceRecoveryReconciliation({
          base: reviewRecoveryBase(runtime),
          conflicts: merged.conflicts,
          runtime,
        });
        setIsRecoveryConflictOpen(true);
        setStatus(RECOVERY_CONFLICT_STATUS);
      } else {
        replaceRecoveryReconciliation({
          base: reviewRecoveryBase(runtime),
          conflicts: [],
          runtime: null,
        });
        setIsRecoveryConflictOpen(false);
      }
      return merged;
    },
    [
      applyReviewState,
      markPersistedReviewState,
      observeRuntimeReviewState,
      replaceRecoveryReconciliation,
      replaceReplyDrafts,
    ],
  );
  const applyLocalReviewState = useCallback(
    (state: ReviewRecoveryState): void => {
      const reconciliation = recoveryReconciliationRef.current;
      const currentConflicts = reconciliation.conflicts;
      if (currentConflicts.length === 0) {
        applyReviewState(state);
        return;
      }
      const refreshed = refreshReviewRecoveryConflicts({
        conflicts: currentConflicts,
        local: state,
      });
      let nextState = state;
      let nextBase = reconciliation.base;
      if (reconciliation.runtime !== null) {
        for (const conflict of refreshed.settledConflicts) {
          nextState = resolveReviewRecoveryConflict({
            state: nextState,
            runtime: reconciliation.runtime,
            conflict,
            keep: "runtime",
          });
        }
        if (refreshed.settledConflicts.length > 0) {
          nextBase = reviewRecoveryBaseAfterConflictAnswers({
            base: reconciliation.base,
            runtime: reconciliation.runtime,
            answeredConflicts: refreshed.settledConflicts,
            remainingConflicts: refreshed.conflicts,
          });
        }
      }
      applyReviewState(nextState);
      replaceRecoveryReconciliation({
        base: nextBase,
        conflicts: refreshed.conflicts,
        runtime:
          refreshed.conflicts.length === 0 ? null : reconciliation.runtime,
      });
      if (refreshed.conflicts.length === 0) {
        setIsRecoveryConflictOpen(false);
      }
    },
    [applyReviewState, replaceRecoveryReconciliation],
  );
  const stageReviewComment = useCallback(
    (comment: ReviewComment): void => {
      const current = latestReviewStateRef.current.state;
      applyLocalReviewState({
        drafts: [...current.drafts, comment],
        resolvedCommentIds: current.resolvedCommentIds,
      });
    },
    [applyLocalReviewState],
  );
  const changeReplyDraft = useCallback((commentId: string, body: string) => {
    const current = replyDraftsRef.current;
    if ((current.get(commentId) ?? "") === body) return;
    const next = new Map(current);
    if (body === "") next.delete(commentId);
    else next.set(commentId, body);
    replyDraftsRef.current = next;
    setReplyDrafts(next);
  }, []);
  const sendThreadReply = useCallback(
    async (commentId: string, body: string): Promise<void> => {
      if (body === "" || replyPendingCommentIdsRef.current.has(commentId)) {
        return;
      }
      // The reply text is owned above this handler and is only cleared on
      // success, so refusing here keeps every typed character.
      const refusal = reviewWriteRefusal({
        path: "reply",
        availability: writeAvailability,
      });
      if (refusal !== undefined) {
        setStatus(refusal);
        return;
      }
      if (identity === null) return;
      if (
        latestReviewStateRef.current.state.resolvedCommentIds.has(commentId)
      ) {
        setStatus(RESOLVED_THREAD_NEW_WORK_ERROR);
        return;
      }
      const pending = new Set(replyPendingCommentIdsRef.current).add(commentId);
      replyPendingCommentIdsRef.current = pending;
      setReplyPendingCommentIds(pending);
      try {
        await requestJson({
          path: "/api/agent-requests",
          identity,
          method: "POST",
          body: { kind: "reply", commentId, body },
        });
        if ((replyDraftsRef.current.get(commentId) ?? "").trim() === body) {
          changeReplyDraft(commentId, "");
        }
        setStatus("Reply sent to the coding agent.");
      } catch (error) {
        setStatus(errorMessage(error));
      } finally {
        const remaining = new Set(replyPendingCommentIdsRef.current);
        remaining.delete(commentId);
        replyPendingCommentIdsRef.current = remaining;
        setReplyPendingCommentIds(remaining);
      }
    },
    [changeReplyDraft, identity, writeAvailability],
  );
  const acceptAgentSnapshot = useCallback((snapshot: AgentSnapshot) => {
    setHasObservedAgentSnapshot(true);
    setAgent(snapshot);
    setCancelPendingRequestIds((current) =>
      reconcilePendingCancellations({
        pendingRequestIds: current,
        requests: snapshot.requests,
      }),
    );
  }, []);
  const serializeRuntimeWrite = useCallback(
    <Value,>(write: () => Promise<Value>): Promise<Value> => {
      const result = persistenceQueue.current.then(write, write);
      persistenceQueue.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [],
  );
  // Drafts, feedback, and comment deletion share this reviewer-state gate.
  // Change Engine reverts intentionally use serialization alone because their
  // semantics are independent of unresolved reviewer-state recovery choices.
  // The gate only pauses: whether the conflict prompt is on screen is each
  // caller's decision, so a background persist cannot reopen a dismissal.
  const serializeReviewerStateWrite = useCallback(
    <Value,>(write: () => Promise<Value>): Promise<Value> =>
      serializeRuntimeWrite(() => {
        if (recoveryReconciliationRef.current.conflicts.length > 0) {
          return Promise.reject(new RecoveryConflictPauseError());
        }
        return write();
      }),
    [serializeRuntimeWrite],
  );
  useEffect(() => {
    displayedSnapshotRef.current = displayedSnapshot;
  }, [displayedSnapshot]);
  const inlineComposeHost = useInlineComposeHost(compose, isOpen);
  const threadHosts = useThreadHosts(reviewComments, isOpen);
  // An in-place refresh replaces exactly the nodes an effect captured, so
  // every effect below that resolves plan elements, ranges, or listeners once
  // and holds them names this and resolves them again.
  const articleVersion = useArticleVersion();
  const dispatchDecisionPersistenceState = useCallback(
    (decisionId: string, state: DecisionPersistenceState): void => {
      const decision = liveDecisionFigure(decisionId);
      if ("missing" in decision) return;
      decision.found.dispatchEvent(
        new CustomEvent(`bigplan:decision-persistence-${state}`),
      );
    },
    [],
  );
  const applyAnswersResponse = useCallback((value: unknown): void => {
    applyAnswersRecord({
      value,
      applied: appliedAnswerRevision,
      show: (state) => {
        setStoredAnswers(state.answers);
        setSupersededDecisionIds(state.supersededDecisionIds);
      },
    });
  }, []);
  const flushPendingDecisionInputs = useCallback(async (): Promise<void> => {
    if (
      identity === null ||
      reviewAuthorityRef.current !== "writable" ||
      isFlushingDecisionInputs.current
    ) {
      return;
    }
    isFlushingDecisionInputs.current = true;
    const attemptedMutations = new Map<string, DecisionInputMutation>();
    try {
      while (true) {
        const pending = Array.from(
          pendingDecisionInputs.current.entries(),
        ).filter(
          ([decisionId, entry]) =>
            attemptedMutations.get(decisionId) !== entry.mutation,
        );
        if (pending.length === 0) break;
        for (const [decisionId, entry] of pending) {
          if (pendingDecisionInputs.current.get(decisionId) !== entry) {
            continue;
          }
          attemptedMutations.set(decisionId, entry.mutation);
          try {
            const record = await serializeRuntimeWrite(() =>
              requestJson({
                path: "/api/inputs",
                identity,
                method: "POST",
                body: entry.mutation,
              }),
            );
            applyAnswersResponse(record);
            if (pendingDecisionInputs.current.get(decisionId) !== entry) {
              continue;
            }
            pendingDecisionInputs.current.delete(decisionId);
            toast.dismiss(decisionToastId(decisionId));
            dispatchDecisionPersistenceState(decisionId, "saved");
          } catch (error: unknown) {
            if (pendingDecisionInputs.current.get(decisionId) !== entry) {
              continue;
            }
            // The runtime looked at this mutation and refused it, so the
            // reader is owed its reason rather than a retry loop that will
            // collect the same refusal for as long as the page is open.
            if (isTerminalReviewRuntimeRefusal(error)) {
              pendingDecisionInputs.current.delete(decisionId);
              dispatchDecisionPersistenceState(decisionId, "failed");
              toast.error("Decision answer not saved", {
                id: decisionToastId(decisionId),
                description:
                  error instanceof Error
                    ? error.message
                    : "The review runtime refused this answer.",
                duration: Infinity,
              });
              continue;
            }
            const failed = { ...entry, failures: entry.failures + 1 };
            pendingDecisionInputs.current.set(decisionId, failed);
            if (failed.failures !== 2) continue;
            dispatchDecisionPersistenceState(decisionId, "failed");
            toast.error("Decision answer not saved", {
              id: decisionToastId(decisionId),
              description:
                "Big Plan will keep retrying. Keep this review open until the decision card says the answer is saved.",
              duration: Infinity,
            });
          }
        }
      }
    } finally {
      isFlushingDecisionInputs.current = false;
    }
  }, [
    applyAnswersResponse,
    dispatchDecisionPersistenceState,
    identity,
    serializeRuntimeWrite,
  ]);
  const queueDecisionInput = useCallback(
    (mutation: DecisionInputMutation): void => {
      const decisionId = decisionInputId(mutation);
      // A reading session records nothing, so the card says so and the queue
      // never grows an entry that could not be sent.
      if (reviewAuthorityRef.current === "read-only") {
        dispatchDecisionPersistenceState(decisionId, "reading");
        return;
      }
      // The reader asked for this card to stop showing an answer, and the card
      // has already done it. Forgetting that this page applied one keeps the
      // record's own emptiness from being replayed as a second reset, which
      // would drop the reader out of the change flow they just entered.
      if (mutation.op === "retract") {
        const remaining = new Set(appliedDecisionIds.current);
        remaining.delete(decisionId);
        appliedDecisionIds.current = remaining;
      }
      pendingDecisionInputs.current.set(decisionId, {
        mutation,
        failures: 0,
      });
      toast.dismiss(decisionToastId(decisionId));
      dispatchDecisionPersistenceState(decisionId, "pending");
      void flushPendingDecisionInputs();
    },
    [dispatchDecisionPersistenceState, flushPendingDecisionInputs],
  );
  // Authority arrives after the first paint, and what happens to a confirm made
  // before it does is this effect's whole subject: flush it once the session is
  // known writable, or convert it to a reading-session answer once the session
  // is known read-only. Doing neither is what made the product's own promise -
  // confirming a decision persists it - untrue for the bootstrap window.
  // A read-only review can record nothing, so the cards stop offering to. The
  // state lives on the root because the shell owns what a card may do, and a
  // card wired after an article replacement has to be able to read it rather
  // than wait to be told again.
  useEffect(() => {
    rootElement.toggleAttribute(
      "data-review-read-only",
      reviewAuthority === "read-only",
    );
    document.dispatchEvent(new CustomEvent("bigplan:review-authority"));
  }, [articleVersion, reviewAuthority]);
  useEffect(() => {
    reviewAuthorityRef.current = reviewAuthority;
    if (reviewAuthority === "unknown") return;
    if (reviewAuthority === "writable") {
      void flushPendingDecisionInputs();
      return;
    }
    for (const [decisionId] of Array.from(pendingDecisionInputs.current)) {
      pendingDecisionInputs.current.delete(decisionId);
      toast.dismiss(decisionToastId(decisionId));
      dispatchDecisionPersistenceState(decisionId, "reading");
    }
  }, [
    dispatchDecisionPersistenceState,
    flushPendingDecisionInputs,
    reviewAuthority,
  ]);

  useEffect(() => {
    if (identity === null) return;
    const answered = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = parseDecisionAnsweredDetail(event.detail);
      if (detail === null || detail.proposal.trim() !== "") return;
      const decision = liveDecisionFigure(detail.decision);
      if ("missing" in decision) return;
      if (
        !(event.target instanceof Element) ||
        event.target.closest("[data-decision]") !== decision.found
      ) {
        return;
      }
      const option = decision.found.querySelector<HTMLInputElement>(
        `#${CSS.escape(detail.optionId)}[data-decision-choice]`,
      );
      if (option === null) return;
      queueDecisionInput({
        op: "stage",
        answer: {
          decisionId: detail.decision,
          optionId: detail.optionId,
          optionTitle: detail.option,
          prompt: detail.question,
          premiseSnapshot: displayedSnapshotRef.current,
        },
      });
    };
    const retracted = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const decisionId = isRecord(event.detail)
        ? event.detail.decision
        : undefined;
      if (typeof decisionId !== "string") return;
      const decision = liveDecisionFigure(decisionId);
      if (
        "missing" in decision ||
        !(event.target instanceof Element) ||
        event.target.closest("[data-decision]") !== decision.found
      ) {
        return;
      }
      queueDecisionInput({ op: "retract", decisionId });
    };
    document.addEventListener("bigplan:decision-answered", answered);
    document.addEventListener("bigplan:decision-retracted", retracted);
    return () => {
      document.removeEventListener("bigplan:decision-answered", answered);
      document.removeEventListener("bigplan:decision-retracted", retracted);
    };
  }, [identity, queueDecisionInput]);

  // The server decides which stored answers the plan still asks for, so reading
  // the record is the whole of this page's obligation. A failed read leaves the
  // applied revision alone, so the next read - the next article replacement, or
  // a reload - applies normally; there is no reconciliation to owe or retry.
  useEffect(() => {
    if (identity === null) return;
    void requestJson({ path: "/api/review-state", identity })
      .then(applyAnswersResponse)
      .catch(() => undefined);
  }, [applyAnswersResponse, articleVersion, identity]);

  // Replays the current record onto the cards. It runs again after an article
  // replacement because the swap hands back freshly rendered, unanswered cards.
  // A pending mutation overlays the record it has not reached yet, so the
  // reader's most recent gesture is what they keep seeing.
  useEffect(() => {
    const answers = new Map(
      storedAnswers.map((answer) => [answer.decisionId, answer.optionId]),
    );
    for (const [decisionId, pending] of pendingDecisionInputs.current) {
      if (pending.mutation.op === "stage") {
        answers.set(decisionId, pending.mutation.answer.optionId);
      } else {
        answers.delete(decisionId);
      }
    }
    const applied = new Set<string>();
    for (const [decisionId, optionId] of answers) {
      const decision = liveDecisionFigure(decisionId);
      if ("missing" in decision) continue;
      const option = decision.found.querySelector<HTMLInputElement>(
        `#${CSS.escape(optionId)}[data-decision-choice]`,
      );
      if (option === null) continue;
      applied.add(decisionId);
      decision.found.dispatchEvent(
        new CustomEvent("bigplan:decision-apply", { detail: { optionId } }),
      );
    }
    for (const decisionId of appliedDecisionIds.current) {
      if (applied.has(decisionId)) continue;
      const decision = liveDecisionFigure(decisionId);
      if ("missing" in decision) continue;
      decision.found.dispatchEvent(new CustomEvent("bigplan:decision-reset"));
    }
    appliedDecisionIds.current = applied;
    for (const [decisionId, pending] of pendingDecisionInputs.current) {
      dispatchDecisionPersistenceState(
        decisionId,
        pending.failures >= 2 ? "failed" : "pending",
      );
    }
    // A decision whose stored answer stopped applying looks unanswered, so the
    // card is told why. A pending mutation is the reader answering it right
    // now, which resolves the notice without it ever being shown.
    for (const decisionId of supersededDecisionIds) {
      if (pendingDecisionInputs.current.has(decisionId)) continue;
      const decision = liveDecisionFigure(decisionId);
      if ("missing" in decision) continue;
      decision.found.dispatchEvent(
        new CustomEvent("bigplan:decision-superseded"),
      );
    }
  }, [
    articleVersion,
    dispatchDecisionPersistenceState,
    storedAnswers,
    supersededDecisionIds,
  ]);
  const componentBatchNotes = useComponentBatchNotes(
    isOpen && tab === "comments",
  );
  const feedbackTabs =
    identity === null ? STATIC_FEEDBACK_TABS : LIVE_FEEDBACK_TABS;
  const selectFeedbackTab = (next: FeedbackTab) => {
    setTab(next);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`#review-tab-${next}`)?.focus(),
    );
  };
  // The two bodies own separate scroll containers, so a swap would otherwise
  // return the reader to the top of the feedback they were in the middle of.
  // Position is the only continuity the swap cannot inherit for free: drafts,
  // composer text, chat body, search text, and the selected tab all survive
  // because neither body holds that state.
  const feedbackScrollTop = useRef(0);
  const feedbackPanel = (): HTMLElement | null =>
    sidebarRef.current?.querySelector<HTMLElement>(".review-feedback-panel") ??
    null;
  const openAgentSidebar = useCallback(() => {
    setSidebarView("agent");
    setIsOpen(true);
  }, []);
  /*
  One slot holds either body, so choosing a tab is never enough on its own: a
  path that means "show the reviewer their feedback" has to claim the slot for
  feedback as well, or the tab changes behind agent diagnosis and the thread the
  reader was sent to never appears.

  Two entry points because the two intents differ. Selecting the body is what a
  path does when it decides which feedback the reader would see next; opening it
  is what a path does when it is showing them something now.
  */
  const selectFeedbackBody = useCallback((next: FeedbackTab) => {
    setSidebarView("feedback");
    setTab(next);
  }, []);
  const openFeedbackSidebar = useCallback(
    (next: FeedbackTab) => {
      selectFeedbackBody(next);
      setIsOpen(true);
    },
    [selectFeedbackBody],
  );
  // Each control owns its own view. Pressing the one that is already pressed
  // closes the sidebar; it never hands the slot to the other body, which is
  // what made Agent Status look like it was opening Feedback.
  /*
  Closing a sidebar hands focus back to the control that opened it. Without
  that, React unmounts the aside and focus falls to the document body, so a
  keyboard reader who closes the panel loses their place and tabs from the top
  of the plan to get back. Both bodies do it, because both are opened the same
  way and a reader should not have to know which one they were in.
  */
  const closeAgentSidebar = useCallback(() => {
    setIsOpen(false);
    document.getElementById(AGENT_STATUS_TRIGGER_ID)?.focus();
  }, []);
  const closeFeedbackSidebar = useCallback(() => {
    setIsOpen(false);
    document.getElementById(FEEDBACK_TRIGGER_ID)?.focus();
  }, []);
  const toggleAgentSidebar = () => {
    if (isOpen && sidebarView === "agent") closeAgentSidebar();
    else {
      if (isOpen && sidebarView === "feedback") {
        feedbackScrollTop.current = feedbackPanel()?.scrollTop ?? 0;
      }
      openAgentSidebar();
    }
  };
  const toggleFeedbackSidebar = () => {
    if (isOpen && sidebarView === "feedback") {
      feedbackScrollTop.current = feedbackPanel()?.scrollTop ?? 0;
      closeFeedbackSidebar();
      return;
    }
    setSidebarView("feedback");
    setIsOpen(true);
  };
  const handleFeedbackTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let index = feedbackTabs.indexOf(tab);
    if (event.key === "ArrowRight") index = (index + 1) % feedbackTabs.length;
    else if (event.key === "ArrowLeft")
      index = (index - 1 + feedbackTabs.length) % feedbackTabs.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = feedbackTabs.length - 1;
    else return;
    event.preventDefault();
    const next = feedbackTabs[index];
    if (next !== undefined) selectFeedbackTab(next);
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    if (sidebarView === "agent") {
      document.querySelector<HTMLElement>("#review-panel-agent")?.focus();
      return;
    }
    const panel = feedbackPanel();
    if (panel !== null) panel.scrollTop = feedbackScrollTop.current;
  }, [isOpen, sidebarView]);

  // Escape leaves diagnosis the way the toolbar control does. An open composer
  // owns Escape first, because dismissing it is the nearer intent.
  useEffect(() => {
    if (!isOpen || sidebarView !== "agent" || compose !== null) return;
    const leaveAgentSidebar = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeAgentSidebar();
    };
    document.addEventListener("keydown", leaveAgentSidebar);
    return () => document.removeEventListener("keydown", leaveAgentSidebar);
  }, [closeAgentSidebar, compose, isOpen, sidebarView]);

  useEffect(() => {
    rootElement.toggleAttribute("data-review-kernel-open", isOpen);
    return () => rootElement.removeAttribute("data-review-kernel-open");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setThreadOpenState(clearThreadOpenOverlay);
  }, [isOpen]);

  useEffect(() => {
    if (compose === null) return;
    const closeComposer = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setCompose(null);
    };
    document.addEventListener("keydown", closeComposer);
    return () => document.removeEventListener("keydown", closeComposer);
  }, [compose]);

  useEffect(() => {
    const composeSelection =
      compose?.target.type === "selection" ? compose.target : null;
    const persistentSelections = reviewComments
      .map((comment) => comment.target)
      .filter(
        (target): target is SelectionTarget => target.type === "selection",
      );
    if (composeSelection !== null) persistentSelections.push(composeSelection);
    const activeHighlight =
      associatedTarget ?? (associationActive ? composeSelection : null);
    setSelectionHighlights(persistentSelections, activeHighlight);
    rootElement.toggleAttribute(
      "data-review-selection-active",
      activeHighlight !== null &&
        targetHighlightRange(activeHighlight) !== null,
    );
    return () => {
      setSelectionHighlights([], null);
      rootElement.removeAttribute("data-review-selection-active");
    };
  }, [
    articleVersion,
    associatedTarget,
    associationActive,
    compose,
    reviewComments,
  ]);

  useEffect(() => {
    if (associatedTarget === null) return undefined;
    const associatedElements = targetAssociationElements(associatedTarget);
    for (const element of associatedElements) {
      element.dataset.reviewCommentAssociated = "";
    }
    return () => {
      for (const element of associatedElements) {
        delete element.dataset.reviewCommentAssociated;
      }
    };
  }, [articleVersion, associatedTarget]);

  useEffect(() => {
    if (selectedCommentId === null) return undefined;
    const comment = reviewComments.find(
      (candidate) => candidate.id === selectedCommentId,
    );
    if (comment === undefined) return undefined;
    const selectedElements = targetAssociationElements(comment.target);
    for (const element of selectedElements) {
      element.dataset.reviewCommentSelected = "";
    }
    return () => {
      for (const element of selectedElements) {
        delete element.dataset.reviewCommentSelected;
      }
    };
  }, [articleVersion, reviewComments, selectedCommentId]);

  useEffect(() => {
    const marked = new Set<HTMLElement>();
    const entries = reviewComments.flatMap((comment) => {
      const element = targetElement(comment.target);
      if (element === null) return [];
      for (const associatedElement of targetAssociationElements(
        comment.target,
      )) {
        associatedElement.dataset.reviewHasComment = "";
        marked.add(associatedElement);
      }
      return [
        {
          target: comment.target,
          element,
          selectionRects: [] as ReadonlyArray<DOMRect>,
          area: 0,
        },
      ];
    });
    // Measured while inspecting a pointer position rather than cached across
    // them: the page also reflows without scrolling or resizing - reopening the
    // feedback sidebar reflows it - and geometry held from before such a reflow
    // silently stops matching the text the pointer is over.
    const measureGeometry = () => {
      for (const entry of entries) {
        if (entry.target.type === "selection") {
          const range = selectionRange(entry.target);
          entry.selectionRects =
            range === null ? [] : Array.from(range.getClientRects());
        } else {
          const rect = entry.element.getBoundingClientRect();
          entry.area = rect.width * rect.height;
        }
      }
    };
    let frame = 0;
    let pending:
      | {
          readonly x: number;
          readonly y: number;
          readonly target: EventTarget | null;
        }
      | undefined;
    const inspect = () => {
      frame = 0;
      const current = pending;
      pending = undefined;
      if (current === undefined) return;
      const eventTarget = current.target;
      const eventElement =
        eventTarget instanceof Element
          ? eventTarget
          : eventTarget instanceof Node
            ? eventTarget.parentElement
            : null;
      const focusedComment =
        document.activeElement instanceof Element
          ? document.activeElement.closest(
              "[data-review-comment-ui], [data-review-comment-id]",
            )
          : null;
      if (
        focusedComment !== null ||
        (eventTarget instanceof Node &&
          document
            .querySelector("#big-plan-review-root")
            ?.contains(eventTarget)) ||
        Boolean(eventElement?.closest("[data-review-comment-ui]"))
      ) {
        return;
      }
      measureGeometry();
      const selected = entries.find(({ target, selectionRects }) => {
        if (target.type !== "selection") return false;
        return selectionRects.some(
          (rect) =>
            current.x >= rect.left &&
            current.x <= rect.right &&
            current.y >= rect.top &&
            current.y <= rect.bottom,
        );
      });
      if (selected !== undefined) {
        setAssociatedTarget(selected.target);
        return;
      }
      const containing = entries
        .filter(
          ({ target, element }) =>
            target.type !== "selection" &&
            eventTarget instanceof Node &&
            element.contains(eventTarget),
        )
        .sort((left, right) => left.area - right.area)[0];
      setAssociatedTarget(containing?.target ?? null);
    };
    const move = (event: PointerEvent) => {
      pending = { x: event.clientX, y: event.clientY, target: event.target };
      if (frame === 0) frame = requestAnimationFrame(inspect);
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      for (const element of marked) delete element.dataset.reviewHasComment;
    };
  }, [articleVersion, reviewComments]);

  useEffect(() => {
    const selection =
      compose?.target.type === "selection" ? compose.target : null;
    const block = selection === null ? null : targetElement(selection);
    const images =
      selection === null
        ? []
        : (selection.imageBlockIds ?? [])
            .map((imageId) => foundElement(liveBlock(imageId)))
            .filter((image): image is HTMLElement => image !== null);
    for (const image of images) {
      image.dataset.reviewSelectionAssociated = "";
    }
    if (block !== null) {
      block.dataset.reviewSelectionAssociated = "";
      const enter = () => setAssociationActive(true);
      const leave = () => setAssociationActive(false);
      block.addEventListener("pointerenter", enter);
      block.addEventListener("pointerleave", leave);
      return () => {
        block.removeEventListener("pointerenter", enter);
        block.removeEventListener("pointerleave", leave);
        delete block.dataset.reviewSelectionAssociated;
        for (const image of images) {
          delete image.dataset.reviewSelectionAssociated;
        }
      };
    }
    return () => {
      for (const image of images) {
        delete image.dataset.reviewSelectionAssociated;
      }
    };
  }, [articleVersion, compose]);

  useEffect(() => {
    for (const { container } of reviewContainerHosts) {
      const selected =
        compose?.target.type === "block" &&
        targetElement(compose.target) === container;
      container.toggleAttribute("data-review-slide-selected", selected);
      container.toggleAttribute("data-review-scope-selected", selected);
    }
  }, [compose, reviewContainerHosts]);

  useEffect(() => {
    for (const { block } of blockHosts) {
      const selected =
        compose?.target.type === "block" &&
        targetElement(compose.target) === block;
      block.toggleAttribute("data-review-block-selected", selected);
      block.toggleAttribute("data-review-scope-selected", selected);
    }
  }, [blockHosts, compose]);

  useEffect(() => {
    let current = true;
    const reviewStateBeforeHydration = latestReviewStateRef.current.state;
    const composerBeforeHydration = composerRecoveryRef.current;
    void (async () => {
      if (identity === null) {
        setDrafts(planId === "" ? [] : readLocalDrafts(planId));
        setIsHydrated(true);
        return;
      }
      const claimedOwner = claimLiveRecoveryOwner(identity);
      if (!current) return;
      setLiveRecoveryOwnerId(claimedOwner.ownerId);
      setIsLiveRecoveryAvailable(claimedOwner.recoveryAvailable);
      // Only this tab's own record. Two tabs reconcile through the runtime,
      // never through each other's browser storage; issue #99 owns that.
      const recovery = readLiveReviewRecovery({
        scope: identity,
        owner: claimedOwner,
      });
      const recoveredComposer = recovery?.composer ?? EMPTY_RECOVERED_COMPOSER;
      try {
        const sessionSequence = runtimeSessionOrder.issueRequest();
        const session = parseRuntimeSession({
          value: await requestJson({ path: "/api/session", identity }),
          sessionId: identity.sessionId,
        });
        if (session === null) {
          throw new Error("This page is not connected to its review runtime.");
        }
        if (current) {
          acceptRuntimeSession({ sequence: sessionSequence, session });
        }
        const snapshot = parseSnapshot(
          await requestJson({ path: "/api/drafts", identity }),
        );
        if (current) {
          const runtimeReviewState = observeRuntimeReviewState(snapshot);
          markPersistedReviewState(
            persistedReviewFingerprint(runtimeReviewState),
          );
          let restoredReviewState = runtimeReviewState;
          let conflicts: ReadonlyArray<ReviewRecoveryConflict> = [];
          if (recovery !== null) {
            const merged = resumeLiveReviewRecovery({
              recovery,
              runtime: runtimeReviewState,
              sent: snapshot.sent,
            });
            restoredReviewState = merged.state;
            conflicts = merged.conflicts;
          }
          restoredReviewState = mergeReviewStateAfterHydration({
            before: reviewStateBeforeHydration,
            current: latestReviewStateRef.current.state,
            restored: restoredReviewState,
          });
          conflicts = refreshReviewRecoveryConflicts({
            conflicts,
            local: restoredReviewState,
          }).conflicts;
          const conflicted = conflicts.length > 0;
          if (conflicted) {
            replaceRecoveryReconciliation({
              base: reviewRecoveryBase(runtimeReviewState),
              conflicts,
              runtime: runtimeReviewState,
            });
            setIsRecoveryConflictOpen(true);
          } else {
            replaceRecoveryReconciliation({
              base: reviewRecoveryBase(runtimeReviewState),
              conflicts: [],
              runtime: null,
            });
            setIsRecoveryConflictOpen(false);
          }
          const composerAfterHydration = mergeRecoveredComposerAfterHydration({
            before: composerBeforeHydration,
            current: composerRecoveryRef.current,
            recovered: {
              ...recoveredComposer,
              replies: repliesForSentComments({
                replies: recoveredComposer.replies,
                sent: snapshot.sent,
              }),
            },
          });
          const detached =
            restoreComposer(composerAfterHydration) === "detached";
          applyReviewState(restoredReviewState);
          setSent(snapshot.sent);
          setStatus(
            conflicted
              ? RECOVERY_CONFLICT_STATUS
              : detached
                ? "The comment you were writing could not be reattached: its place in the plan is gone."
                : claimedOwner.recoveryAvailable
                  ? "Connected to the local review runtime."
                  : "Connected to the local review runtime. Browser recovery is unavailable.",
          );
          setIsHydrated(true);
        }
      } catch (error) {
        if (current) {
          if (recovery !== null) {
            const restoredReviewState = mergeReviewStateAfterHydration({
              before: reviewStateBeforeHydration,
              current: latestReviewStateRef.current.state,
              restored: recovery,
            });
            const refreshed = refreshReviewRecoveryConflicts({
              conflicts: recovery.reconciliation.conflicts,
              local: restoredReviewState,
            });
            const conflicts = refreshed.conflicts;
            const runtime = recovery.reconciliation.runtime;
            const base =
              runtime !== null && refreshed.settledConflicts.length > 0
                ? reviewRecoveryBaseAfterConflictAnswers({
                    base: recovery.reconciliation.base,
                    runtime,
                    answeredConflicts: refreshed.settledConflicts,
                    remainingConflicts: conflicts,
                  })
                : recovery.reconciliation.base;
            replaceRecoveryReconciliation({
              ...recovery.reconciliation,
              base,
              conflicts,
              runtime: conflicts.length === 0 ? null : runtime,
            });
            applyReviewState(restoredReviewState);
            setIsRecoveryConflictOpen(conflicts.length > 0);
          } else {
            markPersistedReviewState(
              persistedReviewFingerprint({
                drafts: [],
                resolvedCommentIds: new Set(),
              }),
            );
          }
          const composerAfterHydration = mergeRecoveredComposerAfterHydration({
            before: composerBeforeHydration,
            current: composerRecoveryRef.current,
            recovered: recoveredComposer,
          });
          restoreComposer(composerAfterHydration);
          setStatus(errorMessage(error));
          setIsHydrated(true);
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [
    acceptRuntimeSession,
    applyReviewState,
    identity,
    markPersistedReviewState,
    observeRuntimeReviewState,
    planId,
    replaceRecoveryReconciliation,
    restoreComposer,
    runtimeSessionOrder,
  ]);

  useEffect(() => {
    if (
      !isHydrated ||
      identity === null ||
      liveRecoveryOwnerId === null ||
      !isLiveRecoveryAvailable
    )
      return;
    const reviewState = { drafts, resolvedCommentIds };
    const recovery: StoredLiveReviewRecovery = {
      ...reviewState,
      composer: composerRecovery,
      reconciliation: recoveryReconciliation,
    };
    const didPersist = writeLiveReviewRecovery({
      scope: identity,
      ownerId: liveRecoveryOwnerId,
      recovery,
    });
    if (!didPersist) {
      setIsLiveRecoveryAvailable(false);
      setStatus(LIVE_RECOVERY_UNAVAILABLE_STATUS);
      return;
    }
    if (
      recovery.reconciliation.conflicts.length === 0 &&
      persistedReviewState === persistedReviewFingerprint(recovery) &&
      clearLiveReviewRecovery({
        scope: identity,
        ownerId: liveRecoveryOwnerId,
        fingerprint: persistedReviewState,
      })
    )
      return;
  }, [
    composerRecovery,
    drafts,
    identity,
    isHydrated,
    isLiveRecoveryAvailable,
    liveRecoveryOwnerId,
    persistedReviewState,
    recoveryReconciliation,
    resolvedCommentIds,
  ]);

  useEffect(() => {
    if (!isHydrated) return;
    if (identity === null) {
      if (planId !== "") writeLocalDrafts(planId, drafts);
      return;
    }
    if (runtimeSession?.authoritative === false) return;
    const local: ReviewRecoveryState = { drafts, resolvedCommentIds };
    const fingerprint = persistedReviewFingerprint(local);
    if (persistedReviewState === fingerprint) return;
    // The recovery snapshot has its own writer above and runs whatever the
    // runtime is doing, so a runtime that cannot take this change still
    // cannot lose it.
    if (!runtimeAcceptsWrites) return;
    if (recoveryConflicts.length > 0) return;
    void serializeReviewerStateWrite(async () => {
      let prepared = latestReviewStateRef.current;
      if (persistedReviewStateRef.current === prepared.fingerprint) return;
      let preparedBase = recoveryReconciliationRef.current.base;
      if (runtimeVersionRef.current === "") {
        const snapshot = parseSnapshot(
          await requestJson({ path: "/api/drafts", identity }),
        );
        const merged = reconcileAuthoritativeReviewSnapshot({
          snapshot,
          base: preparedBase,
          local: latestReviewStateRef.current.state,
        });
        if (merged.conflicts.length > 0) return;
        prepared = latestReviewStateRef.current;
        preparedBase = recoveryReconciliationRef.current.base;
      }
      try {
        const written = await requestJson({
          path: "/api/drafts",
          identity,
          method: "PUT",
          body: {
            drafts: prepared.state.drafts,
            resolvedCommentIds: Array.from(prepared.state.resolvedCommentIds),
            version: runtimeVersionRef.current,
          },
        });
        const accepted = parseSnapshot(written);
        reconcileAuthoritativeReviewSnapshot({
          snapshot: accepted,
          base: reviewRecoveryBase(prepared.state),
          local: latestReviewStateRef.current.state,
        });
      } catch (error) {
        // Both refusals below are a 409, so the code the runtime named this
        // one by is what tells them apart.
        if (reviewRuntimeRefusalStatus(error) !== 409) throw error;
        // Someone else wrote, or the write contradicts outstanding agent work.
        // Either way the browser now needs what the runtime actually holds.
        const snapshot = parseSnapshot(
          await requestJson({ path: "/api/drafts", identity }),
        );
        if (!isReviewRuntimeRefusal(error, STALE_REVIEW_STATE_CODE)) {
          // The runtime refuses the whole write when a resolve contradicts
          // outstanding agent work, so the resolved set returns to what it
          // stored. Local drafts are untouched and persist on the next write.
          const merged = reconcileAuthoritativeReviewSnapshot({
            snapshot,
            base: preparedBase,
            local: latestReviewStateRef.current.state,
          });
          applyReviewState({
            drafts: merged.state.drafts,
            resolvedCommentIds: new Set(snapshot.resolvedCommentIds),
          });
          const reason = errorMessage(error);
          setResolveRefusal(reason);
          setStatus(reason);
          return;
        }
        // A stale version is the fact that tells a local edit the runtime has
        // not seen from a local copy the runtime has already moved past.
        reconcileAuthoritativeReviewSnapshot({
          snapshot,
          base: preparedBase,
          local: latestReviewStateRef.current.state,
        });
      }
    }).catch((error: unknown) => {
      if (isRecoveryConflictPause(error)) return;
      setStatus(errorMessage(error));
    });
  }, [
    applyReviewState,
    drafts,
    identity,
    isHydrated,
    planId,
    pollHealth.state,
    persistedReviewState,
    recoveryConflicts,
    reconcileAuthoritativeReviewSnapshot,
    resolvedCommentIds,
    runtimeAcceptsWrites,
    runtimeSession?.authoritative,
    serializeReviewerStateWrite,
  ]);

  useEffect(() => {
    if (identity === null) return;
    let current = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      const sessionSequence = runtimeSessionOrder.issueRequest();
      // Stamp before requests so aggregate latency cannot move contact loss past
      // a remembered deadline. The shared order owner applies only the latest
      // session response immediately; aggregate health still waits for all.
      const pollStartedAtMs = Date.now();
      try {
        const sessionPromise = requestJson({
          path: "/api/session",
          identity,
        }).then((value) => {
          const session = parseRuntimeSession({
            value,
            sessionId: identity.sessionId,
          });
          if (session === null) {
            throw new Error(
              "This page is not connected to its review runtime.",
            );
          }
          if (current) {
            acceptRuntimeSession({ sequence: sessionSequence, session });
          }
          return session;
        });
        const [sessionResult, agentResult, progressResult] =
          await Promise.allSettled([
            sessionPromise,
            requestJson({ path: "/api/agent", identity }),
            requestJson({ path: "/api/progress", identity }),
          ]);
        if (current) {
          const failures: Array<unknown> = [];
          if (sessionResult.status === "rejected") {
            failures.push(sessionResult.reason);
          }
          const now = Date.now();
          if (agentResult.status === "fulfilled") {
            acceptAgentSnapshot(parseAgentSnapshot(agentResult.value));
            setLastObservableAgentAtMs(now);
          } else {
            failures.push(agentResult.reason);
          }
          if (progressResult.status === "fulfilled") {
            setProgress(parseProgress(progressResult.value));
          } else {
            failures.push(progressResult.reason);
          }
          if (failures.length === 0) {
            setPollHealth(INITIAL_REVIEW_POLL_HEALTH);
          } else {
            const result: ReviewPollResult = failures.some((failure) =>
              isReviewRuntimeUnavailable(failure),
            )
              ? "runtime-unavailable"
              : "poll-failed";
            setPollHealth((health) =>
              transitionReviewPollHealth({
                health,
                result,
                nowMs: pollStartedAtMs,
              }),
            );
          }
          setStatusNowMs(now);
        }
      } catch (error: unknown) {
        if (current) {
          const result: ReviewPollResult = isReviewRuntimeUnavailable(error)
            ? "runtime-unavailable"
            : "poll-failed";
          const now = Date.now();
          setPollHealth((health) =>
            transitionReviewPollHealth({
              health,
              result,
              nowMs: pollStartedAtMs,
            }),
          );
          setStatusNowMs(now);
        }
      } finally {
        pending = false;
        void flushPendingDecisionInputs();
      }
    };
    void refresh();
    const timer = window.setInterval(
      () => void refresh(),
      REVIEW_POLL_INTERVAL_MS,
    );
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [
    acceptAgentSnapshot,
    acceptRuntimeSession,
    flushPendingDecisionInputs,
    identity,
    runtimeSessionOrder,
  ]);

  useEffect(() => {
    if (identity === null) return;
    const refreshLeaseClock = () => setStatusNowMs(Date.now());
    const heartbeatAt = agent.presence.updatedAtMs ?? 0;
    const remaining = Math.max(
      0,
      heartbeatAt + AGENT_STALL_MS - Date.now() + 1,
    );
    const timer = window.setTimeout(refreshLeaseClock, remaining);
    const refreshVisibleLease = () => {
      if (!document.hidden) refreshLeaseClock();
    };
    window.addEventListener("focus", refreshLeaseClock);
    document.addEventListener("visibilitychange", refreshVisibleLease);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshLeaseClock);
      document.removeEventListener("visibilitychange", refreshVisibleLease);
    };
  }, [agent.presence.updatedAtMs, identity]);

  useEffect(() => {
    if (
      identity === null ||
      agent.currentSnapshot === "" ||
      agent.currentSnapshot === displayedSnapshot
    ) {
      return;
    }
    let current = true;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    void fetch(window.location.href, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("The revised plan could not be loaded");
        return response.text();
      })
      .then((html) => {
        if (!current) return;
        replacePlanArticle(new DOMParser().parseFromString(html, "text/html"));
        setDisplayedSnapshot(agent.currentSnapshot);
        window.scrollTo({ left: scrollX, top: scrollY });
        setStatus(
          "Plan refreshed in place. Open threads and review state were preserved.",
        );
      })
      .catch((error: unknown) => {
        if (current) setStatus(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, [agent.currentSnapshot, displayedSnapshot, identity]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setSelectionControl(selectionControlState()),
      );
    };
    const clear = () => setSelectionControl(null);
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", clear, { passive: true });
    window.addEventListener("resize", clear, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", clear);
      window.removeEventListener("resize", clear);
    };
  }, []);

  const beginTarget = useCallback(
    (target: CommentTarget, rect: Pick<DOMRect, "top">) => {
      if (runtimeSession?.authoritative === false) {
        openAgentSidebar();
        return;
      }
      if (detachedComposer !== null) {
        openFeedbackSidebar("comments");
        return;
      }
      if (
        compose !== null &&
        targetAddress(compose.target) === targetAddress(target)
      ) {
        return;
      }
      const next = {
        target,
        premiseSnapshot: displayedSnapshot,
        ...composePlacement({ target, top: rect.top }),
      };
      if (compose === null || composeBody.trim() === "") {
        setComposeBody("");
        setCompose(next);
        return;
      }
      setPendingCompose(next);
    },
    [
      compose,
      composeBody,
      detachedComposer,
      displayedSnapshot,
      openAgentSidebar,
      openFeedbackSidebar,
      runtimeSession?.authoritative,
    ],
  );

  useEffect(() => {
    const beginSelectedComment = (event: globalThis.KeyboardEvent) => {
      if (
        selectionControl === null ||
        event.defaultPrevented ||
        !isNewCommentShortcut(event)
      ) {
        return;
      }
      event.preventDefault();
      beginTarget(selectionControl.target, { top: selectionControl.top });
      setSelectionControl(null);
    };
    document.addEventListener("keydown", beginSelectedComment);
    return () => document.removeEventListener("keydown", beginSelectedComment);
  }, [beginTarget, selectionControl]);

  const sendComments = useCallback(
    async (comments: ReadonlyArray<ReviewComment>) => {
      if (!canSendToAgent || identity === null) {
        const availability = deriveReviewCommentSubmitAvailability({
          canSubmit: false,
          writeAvailability,
        });
        if (availability.state === "unavailable") {
          setStatus(availability.status);
        }
        return;
      }
      setIsSending(true);
      try {
        const result = await serializeReviewerStateWrite(async () => {
          let base = recoveryReconciliationRef.current.base;
          if (runtimeVersionRef.current === "") {
            const current = parseSnapshot(
              await requestJson({ path: "/api/drafts", identity }),
            );
            const preflight = reconcileAuthoritativeReviewSnapshot({
              snapshot: current,
              base,
              local: latestReviewStateRef.current.state,
            });
            if (preflight.conflicts.length > 0) {
              return { submitted: false, conflicted: true, comments: [] };
            }
            base = recoveryReconciliationRef.current.base;
          }
          const latestDraftsById = new Map(
            latestReviewStateRef.current.state.drafts.map((comment) => [
              comment.id,
              comment,
            ]),
          );
          const preparedComments = comments.flatMap((requested) => {
            const latest = latestDraftsById.get(requested.id);
            return latest !== undefined && sameReviewComment(latest, requested)
              ? [latest]
              : [];
          });
          if (preparedComments.length !== comments.length) {
            return { submitted: false, conflicted: false, comments: [] };
          }
          if (
            preparedComments.some((comment) =>
              latestReviewStateRef.current.state.resolvedCommentIds.has(
                comment.id,
              ),
            )
          ) {
            throw new Error(RESOLVED_THREAD_NEW_WORK_ERROR);
          }
          const submittedBodies = new Map(
            preparedComments.map((comment) => [comment.id, comment.body]),
          );
          try {
            const snapshot = parseSnapshot(
              await requestJson({
                path: "/api/feedback",
                identity,
                method: "POST",
                body: {
                  comments: preparedComments,
                  version: runtimeVersionRef.current,
                },
              }),
            );
            const latest = latestReviewStateRef.current;
            const merged = reconcileAuthoritativeReviewSnapshot({
              snapshot,
              base,
              local: latest.state,
              preferredSent: preparedComments,
              submittedBodies,
            });
            return {
              submitted: true,
              conflicted: merged.conflicts.length > 0,
              comments: preparedComments,
            };
          } catch (error) {
            if (!isReviewRuntimeRefusal(error, STALE_REVIEW_STATE_CODE)) {
              throw error;
            }
            const snapshot = parseSnapshot(
              await requestJson({ path: "/api/drafts", identity }),
            );
            reconcileAuthoritativeReviewSnapshot({
              snapshot,
              base,
              local: latestReviewStateRef.current.state,
            });
            return {
              submitted: false,
              conflicted:
                recoveryReconciliationRef.current.conflicts.length > 0,
              comments: [],
            };
          }
        });
        if (!result.submitted) {
          if (result.conflicted) {
            setStatus(RECOVERY_CONFLICT_STATUS);
            setIsRecoveryConflictOpen(true);
          } else {
            setStatus(STALE_SUBMISSION_STATUS);
          }
          return;
        }
        const ids = new Set(result.comments.map((comment) => comment.id));
        justSubmittedCommentIds.current = new Set([
          ...justSubmittedCommentIds.current,
          ...ids,
        ]);
        if (!result.conflicted) {
          setStatus(
            `${result.comments.length} comment${result.comments.length === 1 ? "" : "s"} submitted.`,
          );
        }
      } catch (error) {
        setStatus(errorMessage(error));
        if (isRecoveryConflictPause(error)) setIsRecoveryConflictOpen(true);
      } finally {
        setIsSending(false);
      }
    },
    [
      canSendToAgent,
      identity,
      reconcileAuthoritativeReviewSnapshot,
      serializeReviewerStateWrite,
      writeAvailability,
    ],
  );

  useEffect(() => {
    if (!isHydrated) return undefined;
    const feedbackWindow = window as BigPlanFeedbackWindow;
    const previous = feedbackWindow.bigPlan?.feedback;
    const api = {
      add: (payload: ExternalFeedbackPayload): string => {
        const source =
          payload.source === "flow-diagram" && payload.anchor !== undefined
            ? // A diagram element that no longer resolves still deserves its
              // feedback: the note names the element in its own words, so the
              // comment falls back to the whole plan rather than being lost.
              foundElement(liveFlowAnchor(payload.anchor ?? ""))
            : payload.anchor === undefined || payload.anchor === null
              ? null
              : // A decision anchor is a document id raised by the live viewer
                // script, and every id inside a lens snapshot is namespaced
                // when the server scrubs it, so a copy cannot answer here and
                // this needs no resolver.
                document.getElementById(payload.anchor);
        const block = source?.closest<HTMLElement>("[data-block-id]") ?? null;
        const subject =
          payload.source === "flow-diagram"
            ? "Diagram feedback"
            : "Decision options feedback";
        const lines = payload.items.map((item) => {
          if (item.kind === "edit-text") {
            return `- Change ${item.field ?? "text"}: “${item.before ?? ""}” → “${item.after ?? ""}”`;
          }
          if (item.kind === "remove-element") {
            return `- Remove ${item.anchor ?? "the selected element"}${item.reason === undefined ? "" : `: ${item.reason}`}`;
          }
          return `- ${item.body ?? item.after ?? "Review this item."}`;
        });
        const comment: ReviewComment = {
          id: randomId(),
          body: `${subject}:\n\n${lines.join("\n")}`,
          createdAt: new Date().toISOString(),
          premiseSnapshot: displayedSnapshot,
          target: block === null ? { type: "document" } : targetForBlock(block),
        };
        stageReviewComment(comment);
        openFeedbackSidebar("comments");
        setStatus(
          payload.submit === "now"
            ? "Submitting component feedback."
            : "Component feedback added to the review batch.",
        );
        if (payload.submit === "now") void sendComments([comment]);
        return comment.id;
      },
    };
    feedbackWindow.bigPlan = {
      ...(feedbackWindow.bigPlan ?? {}),
      feedback: api,
    };
    return () => {
      if (feedbackWindow.bigPlan?.feedback !== api) return;
      feedbackWindow.bigPlan = {
        ...feedbackWindow.bigPlan,
        ...(previous === undefined ? {} : { feedback: previous }),
      };
      if (previous === undefined) delete feedbackWindow.bigPlan.feedback;
    };
  }, [
    displayedSnapshot,
    isHydrated,
    openFeedbackSidebar,
    sendComments,
    stageReviewComment,
  ]);

  const saveComment = (body: string, submitRightAway: boolean) => {
    if (compose === null) return;
    const comment: ReviewComment = {
      id: randomId(),
      body,
      createdAt: new Date().toISOString(),
      premiseSnapshot: compose.premiseSnapshot,
      target: compose.target,
    };
    stageReviewComment(comment);
    setCompose(null);
    setComposeBody("");
    selectFeedbackBody("comments");
    setStatus("Comment staged locally.");
    if (submitRightAway) void sendComments([comment]);
  };

  const answerRecoveryConflict = (keep: "local" | "runtime") => {
    const reconciliation = recoveryReconciliationRef.current;
    const [conflict, ...remaining] = reconciliation.conflicts;
    if (conflict === undefined) return;
    if (reconciliation.runtime !== null) {
      const next = resolveReviewRecoveryConflict({
        state: latestReviewStateRef.current.state,
        runtime: reconciliation.runtime,
        conflict,
        keep,
        ...(conflict.kind === "sent" && keep === "local"
          ? { replacementCommentId: randomId() }
          : {}),
      });
      applyReviewState(next);
      replaceRecoveryReconciliation({
        base: reviewRecoveryBaseAfterConflictAnswers({
          base: reconciliation.base,
          runtime: reconciliation.runtime,
          answeredConflicts: [conflict],
          remainingConflicts: remaining,
        }),
        conflicts: remaining,
        runtime: remaining.length === 0 ? null : reconciliation.runtime,
      });
    } else {
      replaceRecoveryReconciliation({
        base: reconciliation.base,
        conflicts: remaining,
        runtime: null,
      });
    }
    setIsRecoveryConflictOpen(remaining.length > 0);
  };

  const deleteDraft = (id: string) => {
    const current = latestReviewStateRef.current.state;
    applyLocalReviewState({
      drafts: current.drafts.filter((comment) => comment.id !== id),
      resolvedCommentIds: current.resolvedCommentIds,
    });
    setPendingDelete(null);
    setStatus("Staged comment deleted.");
  };
  const deleteAllDrafts = () => {
    const current = latestReviewStateRef.current.state;
    applyLocalReviewState({
      drafts: [],
      resolvedCommentIds: current.resolvedCommentIds,
    });
    setPendingDelete(null);
    setStatus("All staged comments deleted.");
  };
  const deleteSentComment = async (commentId: string) => {
    const refusal = reviewWriteRefusal({
      path: "delete-comment",
      availability: writeAvailability,
    });
    if (refusal !== undefined) {
      // Close the confirmation too: leaving it up would invite a second click
      // at a runtime that has already said it cannot take the first.
      setPendingDelete(null);
      setStatus(refusal);
      return;
    }
    if (identity === null) return;
    // Close the confirmation and say what is happening before the round-trip.
    // Leaving the dialog up until the runtime answers reads as a dead button,
    // and a reviewer who clicks again deletes twice.
    const kind = pendingDelete?.kind;
    setPendingDelete(null);
    setStatus("Deleting the comment…");
    try {
      const deleted = await serializeReviewerStateWrite(async () => {
        const base = recoveryReconciliationRef.current.base;
        try {
          const snapshot = parseSnapshot(
            await requestJson({
              path: "/api/comments-delete",
              identity,
              method: "POST",
              body: {
                commentId,
                version: runtimeVersionRef.current,
              },
            }),
          );
          reconcileAuthoritativeReviewSnapshot({
            snapshot,
            base,
            local: latestReviewStateRef.current.state,
          });
          return "deleted";
        } catch (error) {
          if (!isReviewRuntimeRefusal(error, STALE_REVIEW_STATE_CODE)) {
            throw error;
          }
          const snapshot = parseSnapshot(
            await requestJson({ path: "/api/drafts", identity }),
          );
          reconcileAuthoritativeReviewSnapshot({
            snapshot,
            base,
            local: latestReviewStateRef.current.state,
          });
          return "stale";
        }
      });
      if (deleted === "stale") {
        setStatus(
          "The review changed before deletion. Review the latest comments and try again.",
        );
        return;
      }
      if (replyDraftsRef.current.has(commentId)) {
        const next = new Map(replyDraftsRef.current);
        next.delete(commentId);
        replaceReplyDrafts(next);
      }
      acceptAgentSnapshot(
        parseAgentSnapshot(await requestJson({ path: "/api/agent", identity })),
      );
      setThreadOpenState((current) =>
        setThreadOpen({
          state: current,
          commentId,
          kind: "sent",
          surface: "rail",
          isRailOpen: isOpen,
          open: false,
        }),
      );
      if (selectedCommentId === commentId) setSelectedCommentId(null);
      setStatus(
        kind === "canceled"
          ? "Canceled comment deleted."
          : kind === "reverted" || kind === "abandoned"
            ? "Comment deleted."
            : "Queued comment deleted.",
      );
    } catch (error) {
      setStatus(errorMessage(error));
      if (isRecoveryConflictPause(error)) setIsRecoveryConflictOpen(true);
    }
  };
  const revertAgentChanges = async () => {
    if (pendingRevert === null) return;
    const refusal = reviewWriteRefusal({
      path: "revert-changes",
      availability: writeAvailability,
    });
    if (refusal !== undefined) {
      setPendingRevert(null);
      setStatus(refusal);
      return;
    }
    if (identity === null) return;
    const revert = pendingRevert;
    // Same reason as deletion: acknowledge the confirmed action immediately,
    // then let the refreshed plan or the error message report how it went.
    setPendingRevert(null);
    setStatus("Reverting the agent's changes…");
    try {
      await serializeRuntimeWrite(() =>
        requestJson({
          path: "/api/revert-agent-changes",
          identity,
          method: "POST",
          body: revert,
        }),
      );
      // The reverted change set no longer exists, so a tour narrating it
      // would walk stale content.
      closeTour();
      // No full reload: pulling the fresh agent snapshot lets the in-place
      // plan refresh swap the article while React state survives, so the
      // thread the reviewer confirmed this from stays open and can drive
      // the next revert.
      acceptAgentSnapshot(
        parseAgentSnapshot(await requestJson({ path: "/api/agent", identity })),
      );
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  const jumpTo = (comment: ReviewComment) => {
    setAssociatedTarget(comment.target);
    const element = targetElement(comment.target);
    // Scrolling nowhere reads as a broken control, and the comment card
    // already tells the reader when its target left the plan, so the same fact
    // is said out loud here instead of silently doing nothing.
    if (element === null) {
      setStatus("This comment's target is no longer in the plan.");
      return;
    }
    // With a What-changed lens open over the target, the reader's content is
    // in the lens and the block behind it has no box at all.
    (displayedStandIn(element) ?? element).scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };
  const updateDraft = (id: string, body: string) => {
    const current = latestReviewStateRef.current.state;
    applyLocalReviewState({
      drafts: current.drafts.map((comment) =>
        comment.id === id ? { ...comment, body } : comment,
      ),
      resolvedCommentIds: current.resolvedCommentIds,
    });
    setStatus("Comment updated locally.");
  };

  const sendChat = async () => {
    const body = chatBody.trim();
    if (body === "") return;
    // The chat box is only cleared once the runtime has taken the question.
    const refusal = reviewWriteRefusal({
      path: "chat",
      availability: writeAvailability,
    });
    if (refusal !== undefined) {
      setStatus(refusal);
      return;
    }
    if (identity === null) return;
    setIsSendingChat(true);
    try {
      await requestJson({
        path: "/api/agent-requests",
        identity,
        method: "POST",
        body: { kind: "chat", body },
      });
      setChatBody("");
      acceptAgentSnapshot(
        parseAgentSnapshot(await requestJson({ path: "/api/agent", identity })),
      );
      setStatus("Plan question sent to the coding agent.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsSendingChat(false);
    }
  };

  const cancelRequest = async (requestId: string) => {
    const refusal = reviewWriteRefusal({
      path: "cancel-request",
      availability: writeAvailability,
    });
    if (refusal !== undefined) {
      // Never mark the request cancel-pending here: the runtime has not been
      // asked, so showing it as canceling would be a lie the page never undoes.
      setStatus(refusal);
      return;
    }
    if (identity === null) return;
    setCancelPendingRequestIds((current) => new Set([...current, requestId]));
    try {
      await requestJson({
        path: "/api/agent-cancel",
        identity,
        method: "POST",
        body: { requestId },
      });
      acceptAgentSnapshot(
        parseAgentSnapshot(await requestJson({ path: "/api/agent", identity })),
      );
      setStatus("Agent request canceled.");
    } catch (error) {
      setCancelPendingRequestIds((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
      try {
        acceptAgentSnapshot(
          parseAgentSnapshot(
            await requestJson({ path: "/api/agent", identity }),
          ),
        );
      } catch {
        // Preserve the original cancel failure. The poll loop will recover the
        // snapshot when the runtime becomes reachable again.
      }
      setStatus(errorMessage(error));
    }
  };

  const effectivePresence = { ...agent.presence, connected: agentConnected };
  // The same request the activity card describes, so the card's header and its
  // model badge cannot disagree. A live-lease selection would drop the badge at
  // exactly the moment the card turns stalled and the reviewer starts asking
  // which agent is holding the work (BIG-147).
  const claimedRequest = selectClaimedAgentRequest({
    requests: agent.requests,
    cancelPendingRequestIds,
    now: agentProjectionNowMs,
  });
  const displayedAgentIdentity = selectAgentModelIdentity({
    ...(claimedRequest?.claimedModel === undefined
      ? {}
      : { claimed: claimedRequest.claimedModel }),
    ...(claimedRequest === undefined
      ? {}
      : { claimedRequestId: claimedRequest.requestId }),
    ...(agent.presence.model === undefined
      ? {}
      : { presence: agent.presence.model }),
    ...(agent.presence.requestId === undefined
      ? {}
      : { presenceRequestId: agent.presence.requestId }),
  });
  const threadProjections = projectCommentThreads({
    comments: sent,
    requests: agent.requests,
    responses: agent.responses,
    progressEvents: progress,
    presence: effectivePresence,
    runtime: threadRuntime,
    nowMs: agentProjectionNowMs,
    cancelPendingRequestIds,
  });
  const agentStatus: AgentStatus = projectLatestAgentStatus({
    requests: agent.requests,
    responses: agent.responses,
    progressEvents: progress,
    presence: effectivePresence,
    runtime: threadRuntime,
    agentConnected,
    nowMs: agentProjectionNowMs,
    cancelPendingRequestIds,
  });
  const activityForRequest = (
    request: AgentRequest,
  ): ReadonlyArray<MessageActivity> =>
    projectRequestActivity({ request, progressEvents: progress });
  const statusForRequest = (
    request: AgentRequest,
    surface: MessageSurface,
  ): AgentStatus =>
    projectRequestStatus({
      request,
      requests: agent.requests,
      progressEvents: progress,
      presence: effectivePresence,
      runtime: threadRuntime,
      surface,
      nowMs: agentProjectionNowMs,
      cancelPendingRequestIds,
      queuedAhead: queuedRequestsAhead({
        request,
        requests: agent.requests,
        responses: agent.responses,
        cancelPendingRequestIds,
      }),
    });
  // Activity and queue input only. It explains a silence; it is never evidence
  // that an agent is attached, so it must not reach agentConnected or anything
  // the connection card reads (BIG-147).
  const agentHeldWork = heldWorkQuiet({
    requests: agent.requests,
    cancelPendingRequestIds,
    now: agentProjectionNowMs,
  });
  const currentAgentActivity = deriveCurrentAgentActivity({
    requests: agent.requests,
    cancelPendingRequestIds,
    progressEvents: progress,
    agentConnected,
    runtimeOffline: pollIsOffline,
    now: agentProjectionNowMs,
    heartbeatAt: agent.presence.updatedAtMs ?? 0,
    ...(agentEndedAtMs === undefined ? {} : { endedAtMs: agentEndedAtMs }),
    everConnected: agentHasEverConnected({ events: agentConnection.events }),
  });
  const chatRequests = agent.requests.filter(
    (request) => request.kind === "chat",
  );
  const activeChatRequests = chatRequests.filter(
    (request) => !archivedChatRequestIds.has(request.requestId),
  );
  const archivedChatRequests = chatRequests.filter((request) =>
    archivedChatRequestIds.has(request.requestId),
  );
  const renderChatExchange = (request: (typeof chatRequests)[number]) => {
    if (identity === null) return null;
    const response = agent.responses.find(
      (candidate) =>
        candidate.requestId === request.requestId && candidate.kind === "chat",
    );
    return (
      <ChatExchange
        key={request.requestId}
        request={request}
        response={response}
        delivery={projectRequestDelivery({ request })}
        identity={identity}
        status={statusForRequest(request, "chat")}
        activity={activityForRequest(request)}
        onStatus={setStatus}
        onShowAgent={openAgentSidebar}
        onCancelRequest={(requestId) => void cancelRequest(requestId)}
        currentSnapshot={currentSnapshot}
      />
    );
  };
  const unresolvedSent = sent.filter(
    (comment) => !resolvedCommentIds.has(comment.id),
  );
  const normalizedCommentQuery = commentQuery.trim().toLocaleLowerCase();
  const commentMatchesQuery = (comment: ReviewComment): boolean => {
    if (normalizedCommentQuery === "") return true;
    const thread = threadProjections.get(comment.id);
    return [
      comment.body,
      ...(thread?.exchanges.flatMap((exchange) => [
        exchange.request.body ?? "",
        exchange.response?.message ?? "",
        exchange.outcome?.message ?? "",
      ]) ?? []),
    ]
      .join("\n")
      .toLocaleLowerCase()
      .includes(normalizedCommentQuery);
  };
  const visibleDrafts = unresolvedDrafts.filter(commentMatchesQuery);
  const visibleResolvedDrafts = resolvedDrafts.filter(commentMatchesQuery);
  const visibleUnresolvedSent = unresolvedSent.filter(commentMatchesQuery);
  const sentByGroup = new Map<ThreadGroup, ReadonlyArray<ReviewComment>>(
    (["needs-input", "ready", "working", "queued"] as const).map((group) => [
      group,
      visibleUnresolvedSent.filter(
        (comment) => threadProjections.get(comment.id)?.group === group,
      ),
    ]),
  );
  const resolvedSent = sent.filter(
    (comment) =>
      resolvedCommentIds.has(comment.id) && commentMatchesQuery(comment),
  );
  useEffect(() => {
    const started = [...justSubmittedCommentIds.current].filter(
      (commentId) => threadProjections.get(commentId)?.group === "working",
    );
    if (started.length === 0) return;
    const remaining = new Set(justSubmittedCommentIds.current);
    started.forEach((commentId) => remaining.delete(commentId));
    justSubmittedCommentIds.current = remaining;
    const activeCommentId = started[0];
    if (activeCommentId === undefined) return;
    setThreadOpenState((current) =>
      setThreadOpen({
        state: setThreadOpen({
          state: current,
          commentId: activeCommentId,
          kind: "sent",
          surface: "rail",
          isRailOpen: isOpen,
          open: true,
        }),
        commentId: activeCommentId,
        kind: "sent",
        surface: "inline",
        isRailOpen: false,
        open: true,
      }),
    );
  }, [isOpen, threadProjections]);
  // One derivation feeds both the toolbar control and the sidebar it opens, so
  // the two can never disagree about the agent's state.
  const agentHealth = deriveAgentHealth({
    activity: currentAgentActivity,
    hasAgentRuntime: identity !== null,
    isReadOnly: runtimeSession?.authoritative === false,
    isObservable: agentStatusIsAvailable,
  });
  const threadIsOpen = ({
    commentId,
    kind,
    surface,
  }: {
    readonly commentId: string;
    readonly kind: ThreadKind;
    readonly surface: ThreadSurface;
  }): boolean =>
    isThreadOpen({
      state: threadOpenState,
      commentId,
      kind,
      surface,
      isRailOpen: isOpen,
    });
  const toggleCommentThread = ({
    commentId,
    kind,
    surface,
  }: {
    readonly commentId: string;
    readonly kind: ThreadKind;
    readonly surface: ThreadSurface;
  }) =>
    setThreadOpenState((current) =>
      toggleThreadOpen({
        state: current,
        commentId,
        kind,
        surface,
        isRailOpen: isOpen,
      }),
    );
  // Resolving never cancels outstanding work on the reviewer's behalf: the runtime
  // refuses a resolve that would contradict an unanswered message, and that
  // refusal is what the reviewer sees.
  const toggleResolvedComment = (commentId: string) => {
    setResolveRefusal(null);
    const current = latestReviewStateRef.current.state;
    if (!current.resolvedCommentIds.has(commentId)) {
      closeTour();
      if (selectedCommentId === commentId) setSelectedCommentId(null);
      const comment = [...current.drafts, ...sent].find(
        (candidate) => candidate.id === commentId,
      );
      if (
        comment !== undefined &&
        associatedTarget !== null &&
        targetAddress(comment.target) === targetAddress(associatedTarget)
      ) {
        setAssociatedTarget(null);
      }
      if (sent.some((candidate) => candidate.id === commentId)) {
        setThreadOpenState((current) =>
          setThreadOpen({
            state: current,
            commentId,
            kind: "sent",
            surface: "rail",
            isRailOpen: isOpen,
            open: false,
          }),
        );
      }
    }
    const nextResolvedCommentIds = new Set(current.resolvedCommentIds);
    if (nextResolvedCommentIds.has(commentId)) {
      nextResolvedCommentIds.delete(commentId);
    } else {
      nextResolvedCommentIds.add(commentId);
    }
    applyLocalReviewState({
      drafts: current.drafts,
      resolvedCommentIds: nextResolvedCommentIds,
    });
  };
  const viewAgentRequest = (requestId: string, kind: string) => {
    if (kind === "chat") {
      openFeedbackSidebar("chat");
      return;
    }
    const request = agent.requests.find(
      (candidate) => candidate.requestId === requestId,
    );
    const commentId =
      request === undefined ? undefined : requestCommentIds(request)[0];
    if (commentId === undefined) return;
    const comment = sent.find((candidate) => candidate.id === commentId);
    if (comment === undefined) return;
    setSelectedCommentId(commentId);
    setAssociatedTarget(comment.target);
    setThreadOpenState((current) =>
      setThreadOpen({
        state: current,
        commentId,
        kind: "sent",
        surface: "rail",
        isRailOpen: isOpen,
        open: true,
      }),
    );
    openFeedbackSidebar("comments");
    // Bring the commented block to the top of the reading column rather than
    // wherever the least scrolling would leave it. "Nearest" parks a block that
    // is below the fold at the very bottom edge, which reads as the page having
    // scrolled past the thing the reader asked to see; the shared scroll margin
    // keeps it clear of the branding bar.
    const planBlock = targetElement(comment.target);
    if (planBlock !== null) {
      (displayedStandIn(planBlock) ?? planBlock).scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            `[data-review-comment-id="${CSS.escape(commentId)}"]`,
          )
          ?.scrollIntoView({ block: "nearest" });
        document
          .querySelector<HTMLTextAreaElement>(`#reply-${CSS.escape(commentId)}`)
          ?.focus({ preventScroll: true });
      });
    });
  };
  const openBatches = selectOpenFeedbackBatches({
    requests: agent.requests,
    cancelPendingRequestIds,
  });
  const batchCommentIds = (request: AgentRequest): ReadonlyArray<string> =>
    requestCommentIds(request).filter((commentId) =>
      visibleUnresolvedSent.some((comment) => comment.id === commentId),
    );
  /** Heads one batch with what that batch alone is doing. */
  const batchSection = ({
    request,
    count,
    comments,
  }: {
    readonly request: AgentRequest;
    readonly count: number;
    readonly comments: ReadonlyArray<ReviewComment>;
  }): CommentsSurfaceBatch => {
    const status = statusForRequest(request, "thread");
    return {
      requestId: request.requestId,
      count,
      comments,
      label: status.label,
      tone: batchSectionTone({ status }),
      content: (
        <Card
          className="m-0 w-full max-w-none border border-[var(--callout-note-c)] bg-[var(--callout-note-bg)] text-[var(--callout-note-ink)] shadow-none"
          density="dense"
          elevation="none"
        >
          <RequestStatusStrip
            status={status}
            activity={activityForRequest(request)}
            surface="thread"
            commentCount={count}
            onShowAgent={openAgentSidebar}
            onCancelRequest={() => void cancelRequest(request.requestId)}
          />
        </Card>
      ),
    };
  };
  const openBatchThreads = openBatches.flatMap((request) => {
    const commentIds = batchCommentIds(request);
    return commentIds.length === 0 ? [] : [{ request, commentIds }];
  });
  // More than one open batch is where a single header stops being able to tell
  // the truth: the threads under it belong to whichever batch is running, not
  // to the batch the header names, so each batch heads its own threads
  // (BIG-162). One batch has nothing to be confused with, so it keeps the
  // sidebar's existing shape - the whole working group beneath the one header.
  //
  // How many batches are open is a fact about the plan, so it is read from
  // openBatches rather than from the sections that survive the search query.
  // Counting the survivors let a query that hid one batch's comments drop the
  // sidebar back to the lone-batch path, which hands the batch still on screen
  // the whole working group - putting another request's working thread under
  // that batch's header, which is the composition BIG-162 exists to remove.
  const batchGroups = openBatchThreads.map(({ request, commentIds }) => {
    const comments = selectThreadsAwaitingAgent({
      comments:
        openBatches.length > 1
          ? visibleUnresolvedSent.filter((comment) =>
              commentIds.includes(comment.id),
            )
          : (sentByGroup.get("working") ?? []),
      groupOf: (commentId) => threadProjections.get(commentId)?.group,
    });
    return {
      section: batchSection({ request, count: commentIds.length, comments }),
      // A card whose batch carries a status strip above it does not repeat that
      // status on the card itself. Only the threads this header both renders
      // and speaks for qualify: one it has stopped rendering carries its own
      // status again, and a thread from another request that the lone-batch
      // path happens to list is not this batch's to speak for.
      headedCommentIds: comments
        .filter((comment) => commentIds.includes(comment.id))
        .map((comment) => comment.id),
    };
  });
  const batchSections: ReadonlyArray<CommentsSurfaceBatch> = batchGroups.map(
    ({ section }) => section,
  );
  const headedBatchCommentIds = new Set(
    batchGroups.flatMap(({ headedCommentIds }) => headedCommentIds),
  );

  return (
    <>
      <Toaster />
      {serverGone ? (
        <ServerGoneBanner
          canRefresh={canRefreshReview}
          onRefresh={() => window.location.reload()}
          endReason={endReason}
          latestReviewUrl={runtimeSession?.latestReviewUrl}
        />
      ) : null}
      {writesStalled ? <WritesStalledBanner /> : null}
      {reviewContainerHosts.map(({ container, host }) => {
        const target = targetForReviewContainer(container);
        if (target === null) return null;
        const pressed =
          compose?.target.type === "block" &&
          targetElement(compose.target) === container;
        const label = container.matches("[data-quick-summary]")
          ? "Comment on quick summary"
          : "Comment on slide";
        return createPortal(
          <Tooltip label={label} placement="below" asChild>
            <button
              type="button"
              // The control stands alone in a gutter, so it rests as ink only:
              // a ground at rest would read as a chip competing with the card
              // beside it. Hover, focus, and pressed still raise the ground.
              className="group relative inline-flex size-[1.4rem] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent p-0 text-comment-rest hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:bg-surface aria-pressed:text-ink [&>svg]:size-3.5"
              aria-label={label}
              aria-pressed={pressed}
              onClick={() =>
                beginTarget(target, container.getBoundingClientRect())
              }
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
            </button>
          </Tooltip>,
          host,
          target.blockId,
        );
      })}
      {blockHosts.map(({ block, host }) =>
        createPortal(
          block.dataset.blockKind === "data-table" ||
            block.dataset.blockKind === "table" ? (
            <Tooltip label="Comment on this table" placement="below" asChild>
              <button
                type="button"
                className={`review-table-comment review-block-button group inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent p-0 ${isStandaloneCommentHost(host) ? "text-comment-rest" : "text-muted"} hover:text-ink focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:text-ink [&>svg]:size-3.5`}
                aria-label="Comment on this table"
                aria-pressed={
                  compose?.target.type === "block" &&
                  targetElement(compose.target) === block
                }
                onClick={() =>
                  beginTarget(
                    targetForBlock(block),
                    block.getBoundingClientRect(),
                  )
                }
              >
                <Icon icon={MESSAGE_SQUARE_ICON} />
              </button>
            </Tooltip>
          ) : host.dataset.reviewToolbarHost !== undefined ? (
            <button
              type="button"
              className={`review-toolbar-comment inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 ${isStandaloneCommentHost(host) ? "text-comment-rest" : "text-muted"} hover:text-ink focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:text-ink [&>svg]:size-3.5`}
              aria-label={blockCommentLabel(block)}
              aria-pressed={
                compose?.target.type === "block" &&
                targetElement(compose.target) === block
              }
              data-tooltip={blockCommentLabel(block)}
              data-tooltip-delay="1s"
              onClick={() =>
                beginTarget(
                  targetForBlock(block),
                  block.getBoundingClientRect(),
                )
              }
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
            </button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="review-block-button"
              aria-label={`Comment on ${block.dataset.blockLabel ?? "this component"}`}
              data-review-block-button=""
              onClick={() =>
                beginTarget(
                  targetForBlock(block),
                  block.getBoundingClientRect(),
                )
              }
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
            </Button>
          ),
          host,
          block.dataset.blockId,
        ),
      )}
      {imageHosts.map(({ block, host }) =>
        createPortal(
          <Tooltip label="Comment on image" placement="below" asChild>
            <button
              type="button"
              className="review-block-button group inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent p-0 text-comment-rest hover:text-ink focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:text-ink [&>svg]:size-3.5"
              data-review-image-comment=""
              aria-label={`Comment on ${block.dataset.blockLabel ?? "this image"}`}
              aria-pressed={
                compose?.target.type === "block" &&
                targetElement(compose.target) === block
              }
              onClick={() =>
                beginTarget(
                  targetForBlock(block),
                  block.getBoundingClientRect(),
                )
              }
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
            </button>
          </Tooltip>,
          host,
          block.dataset.blockId,
        ),
      )}
      {selectionControl === null ? null : (
        <Tooltip
          label={`New comment · ${NEW_COMMENT_SHORTCUT}`}
          placement="below"
          asChild
          tooltipProps={{ "data-selection-comment-tooltip": "" }}
        >
          <button
            type="button"
            className="group fixed z-30 inline-flex cursor-pointer items-center gap-1 rounded-full border border-accent bg-accent-soft px-2 py-1 text-xs text-accent shadow-raised hover:shadow-lifted focus-visible:shadow-lifted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:inset-shadow-pressed [&_svg]:size-3.5"
            style={{
              top: `${selectionControl.top}px`,
              left: `${selectionControl.left}px`,
            }}
            aria-label={selectionCommentLabel(selectionControl.target)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              beginTarget(selectionControl.target, {
                top: selectionControl.top,
              });
              setSelectionControl(null);
            }}
          >
            <Icon icon={MESSAGE_SQUARE_ICON} />
            Comment
          </button>
        </Tooltip>
      )}
      {resolveRefusal === null ? null : (
        <p
          className="fixed top-14 right-3 left-3 z-50 mx-auto m-0 max-w-2xl min-w-0 rounded-lg border border-[var(--callout-danger-c)] bg-[var(--callout-danger-bg)] p-3 text-xs font-semibold text-[var(--callout-danger-c)] shadow-floating [overflow-wrap:anywhere]"
          role="alert"
          data-review-resolve-refusal
        >
          {resolveRefusal}
        </p>
      )}
      {feedbackHost === null
        ? null
        : createPortal(
            <>
              {identity === null ? null : (
                <AgentStatusTrigger
                  status={agentHealth}
                  className={TOOLBAR_CONTROL_CLASS}
                  isSelected={isOpen && sidebarView === "agent"}
                  onToggle={toggleAgentSidebar}
                />
              )}
              <button
                type="button"
                id={FEEDBACK_TRIGGER_ID}
                className={`${TOOLBAR_CONTROL_CLASS} [&>svg]:size-4`}
                aria-expanded={isOpen && sidebarView === "feedback"}
                aria-controls="big-plan-feedback-sidebar"
                onClick={toggleFeedbackSidebar}
              >
                <Icon icon={MESSAGE_SQUARE_ICON} />
                Feedback
                {unresolvedDrafts.length > 0 ? (
                  <Badge
                    size="compact"
                    tone="accent"
                    className="h-5 min-w-5 justify-center px-1 py-0 leading-none"
                  >
                    {unresolvedDrafts.length}
                  </Badge>
                ) : null}
              </button>
            </>,
            feedbackHost,
          )}
      {isOpen ? (
        <aside
          ref={sidebarRef}
          id="big-plan-feedback-sidebar"
          className="fixed top-11 right-0 bottom-0 z-40 flex w-[min(22rem,100vw)] min-w-0 max-w-full flex-col overflow-hidden border-l border-edge bg-paper text-ink shadow-floating"
          aria-label={sidebarView === "agent" ? AGENT_STATUS_LABEL : "Feedback"}
        >
          <div className="flex flex-none items-stretch border-b border-edge bg-paper">
            {sidebarView === "agent" ? (
              <div className="flex-1" />
            ) : (
              <div
                className="flex min-w-0 flex-1 items-stretch gap-1 pt-1.5 pl-2"
                role="tablist"
                aria-label="Feedback views"
                onKeyDown={handleFeedbackTabKeyDown}
              >
                <button
                  id="review-tab-comments"
                  type="button"
                  className={FEEDBACK_TAB_CLASS}
                  role="tab"
                  aria-controls="review-panel-comments"
                  aria-selected={tab === "comments"}
                  tabIndex={tab === "comments" ? 0 : -1}
                  onClick={() => setTab("comments")}
                >
                  <Icon icon={MESSAGE_SQUARE_ICON} />
                  Comments
                  {unresolvedDrafts.length > 0 ? (
                    <Badge size="compact">{unresolvedDrafts.length}</Badge>
                  ) : null}
                </button>
                <button
                  id="review-tab-chat"
                  type="button"
                  className={FEEDBACK_TAB_CLASS}
                  role="tab"
                  aria-controls="review-panel-chat"
                  aria-selected={tab === "chat"}
                  tabIndex={tab === "chat" ? 0 : -1}
                  onClick={() => setTab("chat")}
                >
                  <Icon icon={MESSAGES_SQUARE_ICON} />
                  Chat
                </button>
                {identity === null ? null : (
                  <button
                    id="review-tab-inputs"
                    type="button"
                    className={FEEDBACK_TAB_CLASS}
                    role="tab"
                    aria-controls="review-panel-inputs"
                    aria-selected={tab === "inputs"}
                    tabIndex={tab === "inputs" ? 0 : -1}
                    onClick={() => setTab("inputs")}
                  >
                    <Icon icon={CIRCLE_QUESTION_MARK_ICON} />
                    Inputs
                  </button>
                )}
              </div>
            )}
            <Button
              variant="ghost"
              size="compactIcon"
              className="mr-2 ml-auto min-h-0 self-center"
              aria-label={
                sidebarView === "agent"
                  ? `Close ${AGENT_STATUS_LABEL}`
                  : "Close feedback"
              }
              onClick={() => {
                if (sidebarView === "agent") closeAgentSidebar();
                else closeFeedbackSidebar();
              }}
            >
              <Icon icon={X_ICON} />
            </Button>
          </div>
          {sidebarView === "feedback" && tab === "comments" ? (
            <CommentsSurface
              model={{
                query: commentQuery,
                onQueryChange: setCommentQuery,
                drafts: visibleDrafts,
                sentCount: visibleUnresolvedSent.length + resolvedSent.length,
                hasRuntime: identity !== null,
                hasComponentBatchNotes: componentBatchNotes,
                groups: sentByGroup,
                batches: batchSections,
                resolved: resolvedSent,
                resolvedDrafts: visibleResolvedDrafts,
                canResolveAll: visibleUnresolvedSent.some(
                  (comment) =>
                    threadProjections.get(comment.id)?.group === "ready",
                ),
                renderDraft: (comment, compact) => (
                  <StagedCard
                    key={comment.id}
                    comment={comment}
                    surface="rail"
                    associated={
                      associatedTarget !== null &&
                      targetAddress(associatedTarget) ===
                        targetAddress(comment.target)
                    }
                    collapsed={false}
                    expanded={expandedBodies.has(comment.id)}
                    compactExpanded={expandedRailDraftIds.has(comment.id)}
                    onExpandCompact={() =>
                      setExpandedRailDraftIds((current) =>
                        new Set(current).add(comment.id),
                      )
                    }
                    onCollapseCompact={() =>
                      setExpandedRailDraftIds((current) => {
                        const next = new Set(current);
                        next.delete(comment.id);
                        return next;
                      })
                    }
                    onExpandBody={() =>
                      setExpandedBodies((current) =>
                        new Set(current).add(comment.id),
                      )
                    }
                    onMinimizeBody={() =>
                      setExpandedBodies((current) => {
                        const next = new Set(current);
                        next.delete(comment.id);
                        return next;
                      })
                    }
                    onUpdate={(body) => updateDraft(comment.id, body)}
                    onDelete={() =>
                      setPendingDelete({ kind: "comment", comment })
                    }
                    onJump={() => jumpTo(comment)}
                    onSubmit={() => void sendComments([comment])}
                    submitAvailability={commentSubmitAvailability}
                    onShowAgent={openAgentSidebar}
                    onAssociate={setAssociatedTarget}
                    identity={identity}
                    currentSnapshot={currentSnapshot}
                    onStatus={setStatus}
                    unsavedInputKey={`draft:rail:${comment.id}`}
                    onUnsavedInputChange={onUnsavedInputChange}
                    onResolve={() => toggleResolvedComment(comment.id)}
                    compact={compact}
                  />
                ),
                renderResolvedDraft: (comment) => (
                  <StagedCard
                    key={comment.id}
                    comment={comment}
                    surface="rail"
                    associated={false}
                    collapsed={false}
                    expanded={expandedBodies.has(comment.id)}
                    onExpandBody={() =>
                      setExpandedBodies((current) =>
                        new Set(current).add(comment.id),
                      )
                    }
                    onMinimizeBody={() =>
                      setExpandedBodies((current) => {
                        const next = new Set(current);
                        next.delete(comment.id);
                        return next;
                      })
                    }
                    onUpdate={(body) => updateDraft(comment.id, body)}
                    onDelete={() =>
                      setPendingDelete({ kind: "comment", comment })
                    }
                    onJump={() => jumpTo(comment)}
                    onSubmit={() => void sendComments([comment])}
                    submitAvailability={commentSubmitAvailability}
                    onShowAgent={openAgentSidebar}
                    onAssociate={setAssociatedTarget}
                    identity={identity}
                    currentSnapshot={currentSnapshot}
                    onStatus={setStatus}
                    unsavedInputKey={`draft:rail:${comment.id}`}
                    onUnsavedInputChange={onUnsavedInputChange}
                    resolved
                    onResolve={() => toggleResolvedComment(comment.id)}
                  />
                ),
                renderSent: (comment, resolved, compact, queuePosition) => {
                  const thread = threadProjections.get(comment.id);
                  if (thread === undefined) return null;
                  return (
                    <SentThread
                      key={comment.id}
                      comment={comment}
                      surface="rail"
                      associated={
                        associatedTarget !== null &&
                        targetAddress(associatedTarget) ===
                          targetAddress(comment.target)
                      }
                      selected={selectedCommentId === comment.id}
                      identity={identity}
                      thread={thread}
                      expanded={threadIsOpen({
                        commentId: comment.id,
                        kind: "sent",
                        surface: "rail",
                      })}
                      resolved={resolved}
                      onToggle={() =>
                        toggleCommentThread({
                          commentId: comment.id,
                          kind: "sent",
                          surface: "rail",
                        })
                      }
                      onResolve={() => toggleResolvedComment(comment.id)}
                      onJump={() => jumpTo(comment)}
                      onAssociate={setAssociatedTarget}
                      onReplySent={setStatus}
                      onShowAgent={openAgentSidebar}
                      onCancelRequest={(requestId) =>
                        void cancelRequest(requestId)
                      }
                      onDelete={() =>
                        setPendingDelete({
                          kind: sentDeleteKind({ thread, currentSnapshot }),
                          comment,
                          abandonedClaim: thread.deleteUnlockedByAbandonedClaim,
                        })
                      }
                      onRevert={(requestId, commentId) =>
                        setPendingRevert({ requestId, commentId })
                      }
                      currentSnapshot={currentSnapshot}
                      reply={replyDrafts.get(comment.id) ?? ""}
                      onReplyChange={(body) =>
                        changeReplyDraft(comment.id, body)
                      }
                      isReplying={replyPendingCommentIds.has(comment.id)}
                      onReply={(body) => void sendThreadReply(comment.id, body)}
                      writeAvailability={writeAvailability}
                      compact={compact}
                      queuePosition={queuePosition}
                      suppressPendingStatus={headedBatchCommentIds.has(
                        comment.id,
                      )}
                    />
                  );
                },
                onResolveAll: () => {
                  const current = latestReviewStateRef.current.state;
                  applyLocalReviewState({
                    drafts: current.drafts,
                    resolvedCommentIds: new Set([
                      ...current.resolvedCommentIds,
                      ...unresolvedSent
                        .filter(
                          (comment) =>
                            threadProjections.get(comment.id)?.group ===
                            "ready",
                        )
                        .map((comment) => comment.id),
                    ]),
                  });
                },
                onDeleteAll: () =>
                  setPendingDelete({
                    kind: "all",
                    count: unresolvedDrafts.length,
                  }),
              }}
            />
          ) : null}
          {sidebarView === "feedback" && tab === "chat" ? (
            <ChatSurface
              model={{
                hasRuntime: identity !== null,
                identity,
                writeAvailability,
                status: agentStatus,
                body: chatBody,
                bodyLimit: BODY_LIMIT,
                shortcutLabel: MODIFIER_SHORTCUT,
                isSending: isSendingChat,
                hasExchanges: activeChatRequests.length > 0,
                exchanges: activeChatRequests.map(renderChatExchange),
                archivedCount: archivedChatRequests.length,
                archivedExchanges: archivedChatRequests.map(renderChatExchange),
                onBodyChange: setChatBody,
                onSend: () => void sendChat(),
                onArchive: () =>
                  setArchivedChatRequestIds(
                    new Set([
                      ...archivedChatRequestIds,
                      ...activeChatRequests.map((request) => request.requestId),
                    ]),
                  ),
              }}
            />
          ) : null}
          {sidebarView === "feedback" &&
          tab === "inputs" &&
          identity !== null ? (
            <InputsSurface />
          ) : null}
          {sidebarView === "agent" && identity !== null ? (
            <AgentSurface
              model={{
                activity: currentAgentActivity,
                status: agentHealth,
                presenceState: agentProjection.state,
                heldWork: agentHeldWork,
                modelName: displayedAgentIdentity?.name,
                modelEffort: displayedAgentIdentity?.effort,
                modelClient: displayedAgentIdentity?.client,
                sessionUrl: displayedAgentIdentity?.sessionUrl,
                sessionId: displayedAgentIdentity?.sessionId,
                connectionLog: agentConnection.events,
                recoveryPrompt: agent.recoveryPrompt,
                runtimeSession,
                onViewRequest: viewAgentRequest,
              }}
            />
          ) : null}
          {sidebarView === "feedback" && tab === "comments" ? (
            <div className="review-feedback-status flex flex-none flex-col items-stretch gap-2 border-t border-edge bg-paper p-3 text-xs text-subtle">
              <Button
                className="w-full px-3! py-2! text-xs"
                size="sm"
                disabled={
                  unresolvedDrafts.length === 0 || isSending || !canSendToAgent
                }
                onClick={() => void sendComments(unresolvedDrafts)}
              >
                {isSending ? "Sending…" : "Send all comments to agent"}
              </Button>
              {detachedComposer === null ? null : (
                <div
                  className="rounded-md bg-[var(--callout-warning-bg)] p-2 text-xs text-[var(--callout-warning-ink)]"
                  role="status"
                >
                  <p className="m-0">
                    The comment you were writing could not be reattached: its
                    place in the plan is gone.
                  </p>
                  <p className="mt-2 mb-0 whitespace-pre-wrap rounded-sm bg-paper/60 p-2 text-ink [overflow-wrap:anywhere]">
                    {detachedComposer.body}
                  </p>
                  <div className="mt-2 flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="micro"
                      onClick={() => {
                        // A review served over plain http by LAN address is not
                        // a secure context, so the clipboard API is absent
                        // rather than merely refusing. The notice already
                        // offers the text for manual selection.
                        if (navigator.clipboard === undefined) {
                          setStatus(RECOVERED_TEXT_COPY_FAILED_STATUS);
                          return;
                        }
                        void navigator.clipboard
                          .writeText(detachedComposer.body)
                          .then(
                            () => setStatus("Recovered comment text copied."),
                            () => setStatus(RECOVERED_TEXT_COPY_FAILED_STATUS),
                          );
                      }}
                    >
                      Copy text
                    </Button>
                    <Button
                      variant="ghost"
                      size="micro"
                      onClick={() => {
                        setDetachedComposer(null);
                      }}
                    >
                      Discard text
                    </Button>
                  </div>
                </div>
              )}
              {identity !== null &&
              (status === STALE_SUBMISSION_STATUS ||
                status === RESOLVED_THREAD_NEW_WORK_ERROR ||
                !isLiveRecoveryAvailable) ? (
                <p
                  className="m-0 rounded-md bg-[var(--callout-warning-bg)] p-2 text-xs text-[var(--callout-warning-ink)]"
                  role="status"
                >
                  {status === STALE_SUBMISSION_STATUS ||
                  status === RESOLVED_THREAD_NEW_WORK_ERROR
                    ? `${status} `
                    : ""}
                  {!isLiveRecoveryAvailable
                    ? LIVE_RECOVERY_UNAVAILABLE_STATUS
                    : ""}
                </p>
              ) : null}
              {identity !== null &&
              recoveryConflicts.length > 0 &&
              !isRecoveryConflictOpen ? (
                <Button
                  variant="outline"
                  size="micro"
                  onClick={() => setIsRecoveryConflictOpen(true)}
                >
                  Review comment versions
                </Button>
              ) : null}
              {identity === null ? (
                <p className="m-0 text-xs text-support" role="status">
                  {status}
                </p>
              ) : agentProjection.state === "loading" ? (
                <p
                  className="m-0 text-xs text-support"
                  role="status"
                  aria-live="polite"
                >
                  Checking agent status…
                </p>
              ) : agentProjection.state === "unobservable" ? (
                <p
                  className="m-0 text-xs text-support"
                  role="status"
                  aria-live="polite"
                >
                  Agent status is unavailable while the review session is
                  offline.
                </p>
              ) : (
                <div role="status" aria-live="polite">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      className="m-0 inline-flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-xs font-semibold text-ink hover:underline hover:underline-offset-[0.16em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      aria-label={`${currentAgentActivity.headline} - open ${AGENT_STATUS_LABEL}`}
                      onClick={openAgentSidebar}
                    >
                      {currentAgentActivity.tone === "danger" ? (
                        <span
                          className="inline-flex shrink-0 text-danger [&>svg]:size-3.5"
                          role="img"
                          aria-label={currentAgentActivity.headline}
                        >
                          <Icon icon={TRIANGLE_ALERT_ICON} />
                        </span>
                      ) : null}
                      {currentAgentActivity.headline}
                    </button>
                    {/* A session that has never had an agent needs no badge
                        saying so: the line beside it already says none has
                        connected, and a badge repeating it turns the ordinary
                        starting condition into something that looks flagged. */}
                    {currentAgentActivity.state === "never-connected" ? null : (
                      <Badge tone="secondary" size="compact">
                        {AGENT_STATE_BADGE_LABEL[currentAgentActivity.state]}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 mb-0 text-xs text-support">
                    {currentAgentActivity.state === "working"
                      ? currentAgentActivity.latestStep
                      : currentAgentActivity.supporting}
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </aside>
      ) : null}
      <InlineComments
        model={{
          drafts: unresolvedDrafts,
          sent,
          hostFor: (commentId) => threadHosts.get(commentId),
          renderDraft: (comment) => (
            <StagedCard
              comment={comment}
              surface="thread"
              associated={
                associatedTarget !== null &&
                targetAddress(associatedTarget) ===
                  targetAddress(comment.target)
              }
              collapsed={
                !threadIsOpen({
                  commentId: comment.id,
                  kind: "draft",
                  surface: "inline",
                })
              }
              expanded={expandedBodies.has(comment.id)}
              onCollapse={() =>
                toggleCommentThread({
                  commentId: comment.id,
                  kind: "draft",
                  surface: "inline",
                })
              }
              onExpandBody={() =>
                setExpandedBodies((current) => new Set(current).add(comment.id))
              }
              onMinimizeBody={() =>
                setExpandedBodies((current) => {
                  const next = new Set(current);
                  next.delete(comment.id);
                  return next;
                })
              }
              onUpdate={(body) => updateDraft(comment.id, body)}
              onDelete={() => setPendingDelete({ kind: "comment", comment })}
              onJump={() => jumpTo(comment)}
              onSubmit={() => void sendComments([comment])}
              submitAvailability={commentSubmitAvailability}
              onShowAgent={openAgentSidebar}
              onAssociate={setAssociatedTarget}
              identity={identity}
              currentSnapshot={currentSnapshot}
              onStatus={setStatus}
              unsavedInputKey={`draft:thread:${comment.id}`}
              onUnsavedInputChange={onUnsavedInputChange}
              onResolve={() => toggleResolvedComment(comment.id)}
            />
          ),
          renderSent: (comment) => {
            const thread = threadProjections.get(comment.id);
            if (thread === undefined) return null;
            return (
              <SentThread
                comment={comment}
                surface="thread"
                associated={
                  associatedTarget !== null &&
                  targetAddress(associatedTarget) ===
                    targetAddress(comment.target)
                }
                selected={selectedCommentId === comment.id}
                identity={identity}
                thread={thread}
                expanded={threadIsOpen({
                  commentId: comment.id,
                  kind: "sent",
                  surface: "inline",
                })}
                resolved={resolvedCommentIds.has(comment.id)}
                onToggle={() =>
                  toggleCommentThread({
                    commentId: comment.id,
                    kind: "sent",
                    surface: "inline",
                  })
                }
                onResolve={() => toggleResolvedComment(comment.id)}
                onJump={() => jumpTo(comment)}
                onAssociate={setAssociatedTarget}
                onReplySent={setStatus}
                onShowAgent={openAgentSidebar}
                onCancelRequest={(requestId) => void cancelRequest(requestId)}
                onDelete={() =>
                  setPendingDelete({
                    kind: sentDeleteKind({ thread, currentSnapshot }),
                    comment,
                    abandonedClaim: thread.deleteUnlockedByAbandonedClaim,
                  })
                }
                onRevert={(requestId, commentId) =>
                  setPendingRevert({ requestId, commentId })
                }
                currentSnapshot={currentSnapshot}
                reply={replyDrafts.get(comment.id) ?? ""}
                onReplyChange={(body) => changeReplyDraft(comment.id, body)}
                isReplying={replyPendingCommentIds.has(comment.id)}
                onReply={(body) => void sendThreadReply(comment.id, body)}
                writeAvailability={writeAvailability}
              />
            );
          },
        }}
      />
      {compose === null ? null : inlineComposeHost === null ? (
        <CommentComposer
          key={
            compose.target.type === "document"
              ? "document"
              : compose.target.blockId
          }
          compose={compose}
          inline={false}
          body={composeBody}
          submitRightAway={submitRightAway}
          identity={identity}
          writeAvailability={writeAvailability}
          submitAvailability={commentSubmitAvailability}
          onCancel={() => {
            setCompose(null);
            setComposeBody("");
          }}
          onBodyChange={setComposeBody}
          onSave={saveComment}
          onSubmitRightAwayChange={setSubmitRightAway}
          onShowAgent={openAgentSidebar}
        />
      ) : (
        createPortal(
          <CommentComposer
            key={
              compose.target.type === "document"
                ? "document"
                : compose.target.blockId
            }
            compose={compose}
            inline
            body={composeBody}
            submitRightAway={submitRightAway}
            identity={identity}
            writeAvailability={writeAvailability}
            submitAvailability={commentSubmitAvailability}
            onCancel={() => {
              setCompose(null);
              setComposeBody("");
            }}
            onBodyChange={setComposeBody}
            onSave={saveComment}
            onSubmitRightAwayChange={setSubmitRightAway}
            onShowAgent={openAgentSidebar}
          />,
          inlineComposeHost,
        )
      )}
      <AlertDialog
        open={pendingCompose !== null}
        title="Finish your draft comment?"
        description="You have a draft comment that will be lost if you start a new one."
        cancelLabel="Return to draft"
        actionLabel="Discard"
        onCancel={() => {
          setPendingCompose(null);
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLTextAreaElement>(
                'textarea[aria-label="Add a comment"]',
              )
              ?.focus(),
          );
        }}
        onAction={() => {
          if (pendingCompose === null) return;
          setCompose(pendingCompose);
          setComposeBody("");
          setPendingCompose(null);
        }}
      />
      <RecoveryConflictDialog
        conflict={isRecoveryConflictOpen ? recoveryConflicts[0] : undefined}
        onKeep={answerRecoveryConflict}
        onDismiss={() => setIsRecoveryConflictOpen(false)}
      />
      <AlertDialog
        open={pendingRevert !== null}
        title="Revert response?"
        description="This restores the plan to its state just before this response. Earlier changes stay in place - this is not a reset to the original plan. The comment and thread will remain until you delete them."
        actionLabel="Revert response"
        onCancel={() => setPendingRevert(null)}
        onAction={() => void revertAgentChanges()}
      />
      <AlertDialog
        open={pendingDelete !== null}
        title={
          pendingDelete?.kind === "all"
            ? "Delete all comments?"
            : pendingDelete?.kind === "canceled"
              ? "Delete canceled comment?"
              : pendingDelete?.kind === "queued"
                ? "Delete queued comment?"
                : pendingDelete?.kind === "abandoned"
                  ? "Delete comment the agent left?"
                  : "Delete comment?"
        }
        description={
          pendingDelete?.kind === "all"
            ? `This permanently removes all ${pendingDelete.count} staged ${pendingDelete.count === 1 ? "comment" : "comments"}. This action cannot be undone.`
            : pendingDelete?.kind === "canceled"
              ? withAbandonedClaimNote({
                  description:
                    "This permanently removes the canceled comment and its thread. This action cannot be undone.",
                  abandonedClaim: pendingDelete.abandonedClaim,
                })
              : pendingDelete?.kind === "queued"
                ? "This removes the comment before the agent picks it up. This action cannot be undone."
                : pendingDelete?.kind === "abandoned"
                  ? `${ABANDONED_CLAIM_REASON} This permanently removes the comment and its thread. ${ABANDONED_CLAIM_CONSEQUENCE}`
                  : pendingDelete?.kind === "reverted"
                    ? withAbandonedClaimNote({
                        description:
                          "This permanently removes the comment and its thread. The reverted plan changes stay reverted.",
                        abandonedClaim: pendingDelete.abandonedClaim,
                      })
                    : "This permanently removes your staged comment. This action cannot be undone."
        }
        actionLabel={pendingDelete?.kind === "all" ? "Delete all" : "Delete"}
        onCancel={() => setPendingDelete(null)}
        onAction={() => {
          if (pendingDelete?.kind === "comment") {
            deleteDraft(pendingDelete.comment.id);
          } else if (pendingDelete?.kind === "all") {
            deleteAllDrafts();
          } else if (
            pendingDelete?.kind === "queued" ||
            pendingDelete?.kind === "canceled" ||
            pendingDelete?.kind === "abandoned" ||
            pendingDelete?.kind === "reverted"
          ) {
            void deleteSentComment(pendingDelete.comment.id);
          }
        }}
      />
    </>
  );
};
