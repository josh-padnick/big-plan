// Mounts Big Plan's typed React review interaction island over the inert,
// server-rendered plan. React owns only review chrome; authored content stays
// server-rendered and readable when this island is unavailable.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ACTIVITY_ICON } from "../../icons/lucide/activity.js";
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
  deriveAgentHealthLabel,
  deriveCurrentAgentActivity,
  projectAgentConnectionState,
  selectActiveAgentRequest,
  type AgentStatus,
} from "../shared/agent-status.js";
import type { CommentTarget, ReviewComment } from "../shared/comment.js";
import { boundQuote, QUOTE_LIMIT } from "../shared/comment.js";
import {
  parseReviewerMarkdown,
  type ReviewerMarkdownNode,
} from "../shared/reviewer-markdown.js";
import { REVIEW_POLL_INTERVAL_MS } from "../shared/review-polling.js";
import {
  reconcilePendingCancellations,
  requestIsCanceled,
} from "../shared/cancel-pending.js";
import { stackThreadPositions } from "../shared/thread-layout.js";
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
  selectActiveFeedbackBatch,
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
  type AgentRequest,
  type AgentResponse,
  type AgentSnapshot,
  type SnapshotDiff,
  type ProgressEvent,
  type RuntimeSession,
} from "../shared/review-wire.js";
import { AgentHealthAlert } from "./agent-connection.browser.js";
import { AgentSurface } from "./agent-surface.browser.js";
import { ChatSurface } from "./chat-surface.browser.js";
import { CommentsSurface } from "./comments-surface.browser.js";
import {
  AgentChangeDigest,
  MessageTurn,
  ReviewerMessagePreview,
  RequestStatusStrip,
  type MessageActivity,
  type MessageSurface,
} from "./agent-message.browser.js";
import { Icon } from "./icon.browser.js";
import { ComposeImages } from "./compose-images.browser.js";
import { ReviewImage } from "./review-image.browser.js";
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
  liveFlowAnchor,
  livePictures,
} from "./live-target.browser.js";
import {
  agentProjectionForReviewPoll,
  INITIAL_REVIEW_POLL_HEALTH,
  reviewPollIsOffline,
  reviewRuntimeAcceptsWrites,
  reviewRuntimeCanWrite,
  reviewRuntimeIsDown,
  transitionReviewPollHealth,
  type ReviewPollHealth,
  type ReviewPollResult,
} from "./review-poll-health.js";
import {
  isReviewRuntimeUnavailable,
  normalizeReviewRuntimeRequestError,
  reviewRuntimeRefusal,
  reviewRuntimeRefusalStatus,
} from "./review-runtime-request.js";
import { useArticleVersion } from "./use-article-version.browser.js";
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Textarea,
  Tooltip,
} from "./ui.browser.js";

const TOKEN_HEADER = "x-big-plan-review-token";
const BODY_LIMIT = 4000;
const LONG_COMMENT = 180;
const REQUEST_TIMEOUT_MS = 10_000;
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

type PendingDelete =
  | { readonly kind: "comment"; readonly comment: ReviewComment }
  | { readonly kind: "queued"; readonly comment: ReviewComment }
  | { readonly kind: "canceled"; readonly comment: ReviewComment }
  | { readonly kind: "reverted"; readonly comment: ReviewComment }
  | { readonly kind: "all"; readonly count: number };

type PendingRevert = {
  readonly requestId: string;
  readonly commentId: string;
};

type RuntimeIdentity = {
  readonly planId: string;
  readonly sessionId: string;
  readonly token: string;
};

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
    feedback?: { readonly add: (payload: ExternalFeedbackPayload) => void };
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

type FeedbackTab = "comments" | "chat" | "agent";
const LIVE_FEEDBACK_TABS: ReadonlyArray<FeedbackTab> = [
  "comments",
  "chat",
  "agent",
];
const STATIC_FEEDBACK_TABS: ReadonlyArray<FeedbackTab> = ["comments", "chat"];
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
}: {
  readonly preferred: FloatingPosition;
  readonly width: number;
  readonly height: number;
  readonly obstacles: ReadonlyArray<FloatingRect>;
}): FloatingPosition => {
  const edge = 24;
  const gap = 12;
  const left = Math.max(
    edge,
    Math.min(preferred.left, window.innerWidth - width - edge),
  );
  const clampTop = (top: number) =>
    Math.max(edge, Math.min(top, window.innerHeight - height - edge));
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

const runtimeIdentity = (): RuntimeIdentity | null => {
  const planId = rootElement.getAttribute("data-plan-id") ?? "";
  const sessionId = rootElement.getAttribute("data-review-session") ?? "";
  const token = rootElement.getAttribute("data-review-token") ?? "";
  return planId === "" || sessionId === "" || token === ""
    ? null
    : { planId, sessionId, token };
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

const liveRecoveryStorageKey = (identity: RuntimeIdentity): string =>
  `big-plan:review:live-recovery:${identity.planId}:${identity.sessionId}`;

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

const persistedReviewFingerprint = ({
  drafts,
  resolvedCommentIds,
}: {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly resolvedCommentIds: ReadonlySet<string>;
}): string =>
  JSON.stringify({
    drafts,
    resolvedCommentIds: Array.from(resolvedCommentIds).sort(),
  });

type LiveReviewRecovery = {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly resolvedCommentIds: ReadonlySet<string>;
  readonly baseFingerprint: string | null;
};

/** Reads a session-scoped recovery snapshot without accepting partial data. */
const readLiveReviewRecovery = (
  identity: RuntimeIdentity,
): LiveReviewRecovery | null => {
  try {
    const raw = localStorage.getItem(liveRecoveryStorageKey(identity));
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      (parsed.version !== 1 && parsed.version !== 2) ||
      !Array.isArray(parsed.drafts) ||
      !parsed.drafts.every(isComment) ||
      !Array.isArray(parsed.resolvedCommentIds) ||
      !parsed.resolvedCommentIds.every(
        (value): value is string => typeof value === "string",
      ) ||
      (parsed.version === 2 &&
        parsed.baseFingerprint !== null &&
        typeof parsed.baseFingerprint !== "string")
    ) {
      return null;
    }
    return {
      drafts: parsed.drafts,
      resolvedCommentIds: new Set(parsed.resolvedCommentIds),
      baseFingerprint:
        parsed.version === 2 && typeof parsed.baseFingerprint === "string"
          ? parsed.baseFingerprint
          : null,
    };
  } catch {
    return null;
  }
};

/** Saves unsynchronized live review state before a runtime write is attempted. */
const writeLiveReviewRecovery = ({
  identity,
  recovery,
  baseFingerprint,
}: {
  readonly identity: RuntimeIdentity;
  readonly recovery: Omit<LiveReviewRecovery, "baseFingerprint">;
  readonly baseFingerprint: string | null;
}): boolean => {
  try {
    localStorage.setItem(
      liveRecoveryStorageKey(identity),
      JSON.stringify({
        version: 2,
        drafts: recovery.drafts,
        resolvedCommentIds: Array.from(recovery.resolvedCommentIds),
        baseFingerprint,
      }),
    );
    return true;
  } catch {
    return false;
  }
};

const reconcileLiveReviewRecovery = ({
  runtime,
  recovery,
}: {
  readonly runtime: Omit<LiveReviewRecovery, "baseFingerprint">;
  readonly recovery: Omit<LiveReviewRecovery, "baseFingerprint">;
}): Omit<LiveReviewRecovery, "baseFingerprint"> => {
  const drafts = [...runtime.drafts];
  const runtimeDrafts = new Map(
    runtime.drafts.map((comment) => [comment.id, comment]),
  );
  const resolvedCommentIds = new Set(runtime.resolvedCommentIds);
  for (const recovered of recovery.drafts) {
    const current = runtimeDrafts.get(recovered.id);
    if (current === undefined) {
      drafts.push(recovered);
      if (recovery.resolvedCommentIds.has(recovered.id)) {
        resolvedCommentIds.add(recovered.id);
      }
      continue;
    }
    // Target metadata is runtime-owned and may be canonicalized on first save.
    // A matching body therefore represents the same immutable comment even
    // when the browser's display kind differs from the stored block kind.
    if (current.body === recovered.body) continue;
    const recoveredId = randomId();
    drafts.push({ ...recovered, id: recoveredId });
    if (recovery.resolvedCommentIds.has(recovered.id)) {
      resolvedCommentIds.add(recoveredId);
    }
  }
  return { drafts, resolvedCommentIds };
};

/** Clears only the recovery snapshot confirmed by the completed runtime write. */
const clearLiveReviewRecovery = ({
  identity,
  fingerprint,
}: {
  readonly identity: RuntimeIdentity;
  readonly fingerprint: string;
}): void => {
  const recovery = readLiveReviewRecovery(identity);
  if (
    recovery === null ||
    persistedReviewFingerprint(recovery) !== fingerprint
  ) {
    return;
  }
  try {
    localStorage.removeItem(liveRecoveryStorageKey(identity));
  } catch {
    // The runtime now owns the state, so stale recovery cleanup is best effort.
  }
};

const requestJson = async ({
  path,
  identity,
  method = "GET",
  body,
}: {
  readonly path: string;
  readonly identity: RuntimeIdentity;
  readonly method?: "GET" | "PUT" | "POST";
  readonly body?: unknown;
}): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(path, {
      method,
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: {
        [TOKEN_HEADER]: identity.token,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw await reviewRuntimeRefusal({
        status: response.status,
        readBody: () => response.json(),
      });
    }
    return await response.json();
  } catch (error) {
    throw normalizeReviewRuntimeRequestError({
      error,
      timedOut: controller.signal.aborted,
    });
  } finally {
    window.clearTimeout(timeout);
  }
};

/** The one place a runtime failure interrupts reading, whatever the failure. */
const RuntimeAlertBanner = ({
  scope,
  heading,
  detail,
  action,
}: {
  readonly scope: string;
  readonly heading: string;
  readonly detail: string;
  readonly action?: {
    readonly label: string;
    readonly onAct: () => void;
    readonly enabled: boolean;
  };
}) => (
  <div
    className="fixed top-14 right-3 left-3 z-50 mx-auto flex max-w-2xl min-w-0 items-start gap-3 rounded-lg border border-[var(--callout-danger-c)] bg-[var(--callout-danger-bg)] p-3 text-sm text-[var(--callout-danger-c)] shadow-floating"
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
);

const ServerGoneBanner = ({
  canRefresh,
  onRefresh,
}: {
  readonly canRefresh: boolean;
  readonly onRefresh: () => void;
}) => (
  <RuntimeAlertBanner
    scope="data-review-server-gone"
    heading="This review session is no longer online"
    detail={
      canRefresh
        ? "The local review server stopped responding. Refresh when it is running again to continue reviewing. This is separate from the agent connection."
        : "The local review server stopped responding. Keep this tab open because the latest review input has not reached the local review server. This is separate from the agent connection."
    }
    action={{ label: "Refresh", onAct: onRefresh, enabled: canRefresh }}
  />
);

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
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let last: Text | null = null;
    let node = walker.nextNode();
    while (node !== null) {
      if (!(node instanceof Text)) {
        node = walker.nextNode();
        continue;
      }
      last = node;
      const length = node.data.length;
      if (targetOffset <= consumed + length) {
        return { node, offset: Math.max(0, targetOffset - consumed) };
      }
      consumed += length;
      node = walker.nextNode();
    }
    return last === null ? null : { node: last, offset: last.data.length };
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

const renderReviewerNode = (
  node: ReviewerMarkdownNode,
  key: string,
): ReactNode => {
  if (node.type === "text") return node.value;
  if (node.type === "inlineCode") return <code key={key}>{node.value}</code>;
  if (node.type === "code") {
    return (
      <pre key={key}>
        <code>{node.value}</code>
      </pre>
    );
  }
  if (node.type === "image") {
    return <ReviewImage key={key} id={node.id} alt={node.alt} />;
  }
  const children = node.children.map((child, index) =>
    renderReviewerNode(child, `${key}-${index}`),
  );
  if (node.type === "paragraph") return <p key={key}>{children}</p>;
  if (node.type === "strong") return <strong key={key}>{children}</strong>;
  if (node.type === "emphasis") return <em key={key}>{children}</em>;
  if (node.type === "blockquote")
    return <blockquote key={key}>{children}</blockquote>;
  if (node.type === "listItem") return <li key={key}>{children}</li>;
  if (node.type === "list") {
    return node.ordered ? (
      <ol key={key}>{children}</ol>
    ) : (
      <ul key={key}>{children}</ul>
    );
  }
  if (node.type !== "link") return null;
  return (
    <a key={key} href={node.url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
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

const useThreadHosts = (
  comments: ReadonlyArray<ReviewComment>,
  isOpen: boolean,
): ReadonlyMap<string, HTMLDivElement> => {
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLDivElement>>(
    new Map(),
  );
  const isWide = useWide();

  useEffect(() => {
    if (!isWide) {
      setHosts(new Map());
      return;
    }
    const mounted = new Map<string, HTMLDivElement>();
    const targetOffsets = new Map<string, number>();
    const anchorPositions = new Map<
      string,
      { readonly left: number; readonly right: number; readonly top: number }
    >();
    for (const comment of comments) {
      const anchor = targetElement(comment.target);
      if (anchor === null) continue;
      const container =
        anchor.closest<HTMLElement>("[data-slide], [data-quick-summary]") ??
        anchor.parentElement ??
        anchor;
      targetOffsets.set(
        comment.id,
        anchor.getBoundingClientRect().top -
          container.getBoundingClientRect().top,
      );
      const containerRect = container.getBoundingClientRect();
      anchorPositions.set(comment.id, {
        left: containerRect.left + window.scrollX,
        right: containerRect.right + window.scrollX,
        top: containerRect.top + window.scrollY,
      });
      const host = document.createElement("div");
      host.dataset.reviewThreadFor = comment.id;
      host.dataset.reviewThreadSide = "";
      document.body.append(host);
      mounted.set(comment.id, host);
    }
    const position = () => {
      const viewportWidth = document.documentElement.clientWidth;
      const edge = 24;
      const feedbackRailWidth = isOpen ? Math.min(22 * 16, viewportWidth) : 0;
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
        { readonly left: number; readonly right: number; readonly top: number }
      >();
      const rightThreadOffsets = new Map<string, number>();
      for (const comment of comments) {
        const host = mounted.get(comment.id);
        const target = targetElement(comment.target);
        if (host === undefined || target === null) continue;
        const anchor =
          target.closest<HTMLElement>("[data-slide], [data-quick-summary]") ??
          target.parentElement ??
          target;
        const liveAnchorRect = anchor.getBoundingClientRect();
        const cachedAnchor = anchorPositions.get(comment.id);
        const anchorIsHidden = anchor.getClientRects().length === 0;
        const anchorRect =
          anchorIsHidden && cachedAnchor !== undefined
            ? {
                left: cachedAnchor.left - window.scrollX,
                right: cachedAnchor.right - window.scrollX,
                top: cachedAnchor.top - window.scrollY,
              }
            : liveAnchorRect;
        if (!anchorIsHidden) {
          anchorPositions.set(comment.id, {
            left: liveAnchorRect.left + window.scrollX,
            right: liveAnchorRect.right + window.scrollX,
            top: liveAnchorRect.top + window.scrollY,
          });
        }
        const cardHeight = Math.max(
          1,
          host.firstElementChild?.getBoundingClientRect().height ?? 1,
        );
        const isSlideAnchor = anchor.matches(
          "[data-slide], [data-quick-summary]",
        );
        const desiredTop =
          anchorRect.top +
          (targetOffsets.get(comment.id) ?? 0) +
          window.scrollY +
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
        const minimumLeft = edge + window.scrollX;
        const maximumLeft =
          window.scrollX +
          viewportWidth -
          feedbackRailWidth -
          threadWidth -
          edge;
        const right =
          anchorRect.right +
          window.scrollX +
          (rightThreadOffsets.get(id) ?? diffThreadGap);
        host.style.left = `${Math.max(
          minimumLeft,
          Math.min(right, maximumLeft),
        )}px`;
      }
    };
    const frame = requestAnimationFrame(position);
    const observer = new ResizeObserver(position);
    for (const host of mounted.values()) observer.observe(host);
    for (const comment of comments) {
      const target = targetElement(comment.target);
      if (target !== null) {
        observer.observe(target);
        const anchor =
          target.closest<HTMLElement>("[data-slide], [data-quick-summary]") ??
          target.parentElement;
        if (anchor !== null) observer.observe(anchor);
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
      const obstacles = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-review-thread-side], button[aria-label^="Comment on"]',
        ),
        (node) => node.getBoundingClientRect(),
      ).filter((obstacle) => obstacle.width > 0 && obstacle.height > 0);
      const next = floatingComposerPosition({
        preferred: {
          top: compose.top - window.scrollY,
          left: compose.left - window.scrollX,
        },
        width: rect.width,
        height: rect.height,
        obstacles,
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
        <span
          className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent motion-reduce:animate-none"
          aria-hidden="true"
        />
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
  unsavedInputKey,
  onUnsavedInputChange,
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
  readonly unsavedInputKey: string;
  readonly onUnsavedInputChange: UnsavedInputChange;
  readonly compact?: boolean;
  readonly queuePosition?: number;
  readonly suppressPendingStatus?: boolean;
}) => {
  const [reply, setReply] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const hasUnsavedReply = reply !== "";
  useEffect(() => {
    onUnsavedInputChange(unsavedInputKey, hasUnsavedReply);
    return () => onUnsavedInputChange(unsavedInputKey, false);
  }, [hasUnsavedReply, onUnsavedInputChange, unsavedInputKey]);
  const {
    exchanges,
    latestExchange,
    latestChanged,
    latestStatus,
    latestPending,
    latestCanceled,
    canDeleteQueued,
    canDeleteCanceled,
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
  const deleteCommentLabel = latestChangeWasReverted
    ? "Delete comment"
    : latestCanceled
      ? "Delete canceled comment"
      : "Delete queued comment";

  const sendReply = async (bodyOverride?: string) => {
    const body = (bodyOverride ?? reply).trim();
    if (identity === null || body === "") return;
    setIsReplying(true);
    try {
      await requestJson({
        path: "/api/agent-requests",
        identity,
        method: "POST",
        body: { kind: "reply", commentId: comment.id, body },
      });
      setReply("");
      onReplySent("Reply sent to the coding agent.");
    } catch (error) {
      onReplySent(errorMessage(error));
    } finally {
      setIsReplying(false);
    }
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
                className="mb-3 grid gap-2"
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
              label="Reply to the agent"
              textareaClassName="mt-1 min-h-20"
              body={reply}
              maxLength={BODY_LIMIT}
              placeholder="Reply to the agent…"
              onBodyChange={setReply}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void sendReply();
                }
              }}
            />
            <div className="mt-2 flex justify-end">
              <Tooltip label={`Reply · ${MODIFIER_SHORTCUT}`}>
                <Button
                  size="compact"
                  disabled={reply.trim() === "" || isReplying}
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
    <li className="grid min-w-0 gap-2">
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
  const [pendingCompose, setPendingCompose] = useState<ComposeState | null>(
    null,
  );
  const [selectionControl, setSelectionControl] =
    useState<SelectionControlState | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<FeedbackTab>("comments");
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
  const [agentAttentionKey, setAgentAttentionKey] = useState(0);
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
  const agentConnection = projectAgentConnectionState({
    presenceConnected: agent.presence.connected,
    heartbeatAt: agent.presence.updatedAtMs ?? 0,
    now: agentProjectionNowMs,
    events: agent.connectionLog,
  });
  const agentConnected = agentConnection.connected;
  const runtimeCanWrite = reviewRuntimeCanWrite(pollHealth);
  // Reachability and acceptance are different questions once a runtime can
  // stall: every write path asks this one, so the page stops sending changes
  // the runtime has already reported it will refuse.
  const runtimeAcceptsWrites = reviewRuntimeAcceptsWrites({
    health: pollHealth,
    writesStalledMs: runtimeSession?.writesStalledMs,
  });
  const canSendToAgent =
    identity !== null &&
    threadRuntime === "online" &&
    runtimeAcceptsWrites &&
    runtimeSession?.authoritative !== false;
  const commentSubmitAvailability = deriveReviewCommentSubmitAvailability({
    canSubmit: identity === null || canSendToAgent,
    runtimeCanWrite,
    writesStalled: !runtimeAcceptsWrites && runtimeCanWrite,
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
  const [persistedReviewState, setPersistedReviewState] = useState<
    string | null
  >(null);
  const currentReviewState = persistedReviewFingerprint({
    drafts,
    resolvedCommentIds,
  });
  const canRefreshReview =
    persistedReviewState === currentReviewState &&
    composeBody === "" &&
    chatBody === "" &&
    unsavedInputKeys.size === 0;
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
  const inlineComposeHost = useInlineComposeHost(compose, isOpen);
  const threadHosts = useThreadHosts(reviewComments, isOpen);
  // An in-place refresh replaces exactly the nodes an effect captured, so
  // every effect below that resolves plan elements, ranges, or listeners once
  // and holds them names this and resolves them again.
  const articleVersion = useArticleVersion();
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
  const showAgentSetup = () => {
    setIsOpen(true);
    selectFeedbackTab("agent");
    setAgentAttentionKey((current) => current + 1);
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
    const refreshGeometry = () => {
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
    refreshGeometry();
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
    const refresh = () => refreshGeometry();
    document.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
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
    void (async () => {
      if (identity === null) {
        setDrafts(planId === "" ? [] : readLocalDrafts(planId));
        setIsHydrated(true);
        return;
      }
      try {
        const session = parseRuntimeSession({
          value: await requestJson({ path: "/api/session", identity }),
          sessionId: identity.sessionId,
        });
        if (session === null) {
          throw new Error("This page is not connected to its review runtime.");
        }
        setRuntimeSession(session);
        const snapshot = parseSnapshot(
          await requestJson({ path: "/api/drafts", identity }),
        );
        if (current) {
          const runtimeResolvedCommentIds = new Set(
            snapshot.resolvedCommentIds,
          );
          const runtimeFingerprint = persistedReviewFingerprint({
            drafts: snapshot.drafts,
            resolvedCommentIds: runtimeResolvedCommentIds,
          });
          setPersistedReviewState(runtimeFingerprint);
          const recovery = readLiveReviewRecovery(identity);
          const recoveryFingerprint =
            recovery === null ? null : persistedReviewFingerprint(recovery);
          let restoredReviewState: Omit<LiveReviewRecovery, "baseFingerprint"> =
            {
              drafts: snapshot.drafts,
              resolvedCommentIds: runtimeResolvedCommentIds,
            };
          if (recoveryFingerprint === runtimeFingerprint) {
            clearLiveReviewRecovery({
              identity,
              fingerprint: runtimeFingerprint,
            });
          } else if (recovery !== null) {
            restoredReviewState =
              recovery.baseFingerprint === runtimeFingerprint
                ? recovery
                : reconcileLiveReviewRecovery({
                    runtime: restoredReviewState,
                    recovery,
                  });
            writeLiveReviewRecovery({
              identity,
              recovery: restoredReviewState,
              baseFingerprint: runtimeFingerprint,
            });
          }
          setDrafts(restoredReviewState.drafts);
          setSent(snapshot.sent);
          setResolvedCommentIds(restoredReviewState.resolvedCommentIds);
          setStatus("Connected to the local review runtime.");
          setIsHydrated(true);
        }
      } catch (error) {
        if (current) {
          const recovery = readLiveReviewRecovery(identity);
          if (recovery !== null) {
            setDrafts(recovery.drafts);
            setResolvedCommentIds(recovery.resolvedCommentIds);
          } else {
            setPersistedReviewState(
              persistedReviewFingerprint({
                drafts: [],
                resolvedCommentIds: new Set(),
              }),
            );
          }
          setStatus(errorMessage(error));
          setIsHydrated(true);
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [identity, planId]);

  useEffect(() => {
    if (!isHydrated) return;
    if (identity === null) {
      if (planId !== "") writeLocalDrafts(planId, drafts);
      return;
    }
    if (runtimeSession?.authoritative === false) return;
    const fingerprint = persistedReviewFingerprint({
      drafts,
      resolvedCommentIds,
    });
    if (persistedReviewState === fingerprint) return;
    const existingRecovery = readLiveReviewRecovery(identity);
    const recoveryBaseFingerprint =
      existingRecovery?.baseFingerprint ?? persistedReviewState;
    writeLiveReviewRecovery({
      identity,
      recovery: { drafts, resolvedCommentIds },
      baseFingerprint: recoveryBaseFingerprint,
    });
    // The recovery snapshot above is written first and unconditionally, so a
    // runtime that cannot take this change still cannot lose it.
    if (!runtimeAcceptsWrites) return;
    void serializeRuntimeWrite(async () => {
      const runtimeSnapshot = parseSnapshot(
        await requestJson({ path: "/api/drafts", identity }),
      );
      const runtimeReviewState = {
        drafts: runtimeSnapshot.drafts,
        resolvedCommentIds: new Set(runtimeSnapshot.resolvedCommentIds),
      };
      const runtimeFingerprint = persistedReviewFingerprint(runtimeReviewState);
      if (runtimeFingerprint === fingerprint) {
        return { state: "persisted" as const, fingerprint };
      }
      if (recoveryBaseFingerprint !== runtimeFingerprint) {
        const reconciled = reconcileLiveReviewRecovery({
          runtime: runtimeReviewState,
          recovery: { drafts, resolvedCommentIds },
        });
        const reconciledFingerprint = persistedReviewFingerprint(reconciled);
        if (reconciledFingerprint === runtimeFingerprint) {
          clearLiveReviewRecovery({ identity, fingerprint });
        } else {
          writeLiveReviewRecovery({
            identity,
            recovery: reconciled,
            baseFingerprint: runtimeFingerprint,
          });
        }
        return {
          state: "reconciled" as const,
          reviewState: reconciled,
          runtimeFingerprint,
        };
      }
      try {
        await requestJson({
          path: "/api/drafts",
          identity,
          method: "PUT",
          body: {
            drafts,
            resolvedCommentIds: Array.from(resolvedCommentIds),
          },
        });
      } catch (error: unknown) {
        // The runtime refuses the whole write when a resolve contradicts
        // outstanding agent work, so the resolved set returns to what it stored.
        // Local drafts are untouched and persist on the next write.
        if (reviewRuntimeRefusalStatus(error) !== 409) throw error;
        return {
          state: "refused" as const,
          reason: errorMessage(error),
          resolvedCommentIds: runtimeReviewState.resolvedCommentIds,
        };
      }
      return { state: "persisted" as const, fingerprint };
    })
      .then((result) => {
        if (result.state === "refused") {
          setResolvedCommentIds(result.resolvedCommentIds);
          setResolveRefusal(result.reason);
          setStatus(result.reason);
          return;
        }
        if (result.state === "reconciled") {
          setPersistedReviewState(result.runtimeFingerprint);
          setDrafts(result.reviewState.drafts);
          setResolvedCommentIds(result.reviewState.resolvedCommentIds);
          return;
        }
        setPersistedReviewState(result.fingerprint);
        clearLiveReviewRecovery({
          identity,
          fingerprint: result.fingerprint,
        });
      })
      .catch((error: unknown) => setStatus(errorMessage(error)));
  }, [
    drafts,
    identity,
    isHydrated,
    planId,
    pollHealth.state,
    persistedReviewState,
    resolvedCommentIds,
    runtimeAcceptsWrites,
    runtimeSession?.authoritative,
    serializeRuntimeWrite,
  ]);

  useEffect(() => {
    if (identity === null) return;
    let current = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const [sessionValue, agentValue, progressValue] = await Promise.all([
          requestJson({ path: "/api/session", identity }),
          requestJson({ path: "/api/agent", identity }),
          requestJson({ path: "/api/progress", identity }),
        ]);
        if (current) {
          const session = parseRuntimeSession({
            value: sessionValue,
            sessionId: identity.sessionId,
          });
          if (session === null) {
            throw new Error(
              "This page is not connected to its review runtime.",
            );
          }
          setRuntimeSession(session);
          acceptAgentSnapshot(parseAgentSnapshot(agentValue));
          setProgress(parseProgress(progressValue));
          setPollHealth(INITIAL_REVIEW_POLL_HEALTH);
          const now = Date.now();
          setStatusNowMs(now);
          setLastObservableAgentAtMs(now);
        }
      } catch (error) {
        if (current) {
          const result: ReviewPollResult = isReviewRuntimeUnavailable(error)
            ? "runtime-unavailable"
            : "poll-failed";
          setPollHealth((health) =>
            transitionReviewPollHealth({ health, result }),
          );
          setStatusNowMs(Date.now());
        }
      } finally {
        pending = false;
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
  }, [acceptAgentSnapshot, identity]);

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
        setIsOpen(true);
        setTab("agent");
        return;
      }
      if (
        compose !== null &&
        targetAddress(compose.target) === targetAddress(target)
      ) {
        return;
      }
      const targetRect = targetElement(target)?.getBoundingClientRect();
      const composerWidth = 17 * 16;
      const edge = 24;
      const overlap = 12;
      const viewportWidth = document.documentElement.clientWidth;
      const next = {
        target,
        premiseSnapshot: displayedSnapshot,
        top:
          window.scrollY +
          Math.max(56, Math.min(rect.top, window.innerHeight - 360)),
        left: Math.max(
          edge + window.scrollX,
          Math.min(
            (targetRect?.right ?? viewportWidth) + window.scrollX - overlap,
            window.scrollX + viewportWidth - composerWidth - edge,
          ),
        ),
      };
      if (compose === null || composeBody.trim() === "") {
        setComposeBody("");
        setCompose(next);
        return;
      }
      setPendingCompose(next);
    },
    [compose, composeBody, displayedSnapshot, runtimeSession?.authoritative],
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
          runtimeCanWrite,
          writesStalled: !runtimeAcceptsWrites && runtimeCanWrite,
        });
        if (availability.state === "unavailable") {
          setStatus(availability.status);
        }
        return;
      }
      setIsSending(true);
      try {
        const result = parseSnapshot(
          await serializeRuntimeWrite(() =>
            requestJson({
              path: "/api/feedback",
              identity,
              method: "POST",
              body: { comments },
            }),
          ),
        );
        const ids = new Set(comments.map((comment) => comment.id));
        justSubmittedCommentIds.current = new Set([
          ...justSubmittedCommentIds.current,
          ...ids,
        ]);
        setDrafts((current) =>
          current.filter((comment) => !ids.has(comment.id)),
        );
        setSent((current) =>
          result.sent.length > 0 ? result.sent : [...current, ...comments],
        );
        setStatus(
          `${comments.length} comment${comments.length === 1 ? "" : "s"} submitted.`,
        );
      } catch (error) {
        setStatus(errorMessage(error));
      } finally {
        setIsSending(false);
      }
    },
    [
      canSendToAgent,
      identity,
      isOpen,
      runtimeAcceptsWrites,
      runtimeCanWrite,
      serializeRuntimeWrite,
    ],
  );

  useEffect(() => {
    if (!isHydrated) return undefined;
    const feedbackWindow = window as BigPlanFeedbackWindow;
    const previous = feedbackWindow.bigPlan?.feedback;
    const api = {
      add: (payload: ExternalFeedbackPayload): void => {
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
            : "Suggested decision option";
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
        setDrafts((current) => [...current, comment]);
        setIsOpen(true);
        setTab("comments");
        setStatus(
          payload.submit === "now"
            ? "Submitting component feedback."
            : "Component feedback added to the review batch.",
        );
        if (payload.submit === "now") void sendComments([comment]);
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
  }, [displayedSnapshot, isHydrated, sendComments]);

  const saveComment = (body: string, submitRightAway: boolean) => {
    if (compose === null) return;
    const comment: ReviewComment = {
      id: randomId(),
      body,
      createdAt: new Date().toISOString(),
      premiseSnapshot: compose.premiseSnapshot,
      target: compose.target,
    };
    setDrafts((current) => [...current, comment]);
    setCompose(null);
    setComposeBody("");
    setTab("comments");
    setStatus("Comment staged locally.");
    if (submitRightAway) void sendComments([comment]);
  };

  const deleteDraft = (id: string) => {
    setDrafts((current) => current.filter((comment) => comment.id !== id));
    setPendingDelete(null);
    setStatus("Staged comment deleted.");
  };
  const deleteAllDrafts = () => {
    setDrafts([]);
    setPendingDelete(null);
    setStatus("All staged comments deleted.");
  };
  const deleteSentComment = async (commentId: string) => {
    if (identity === null) return;
    // Close the confirmation and say what is happening before the round-trip.
    // Leaving the dialog up until the runtime answers reads as a dead button,
    // and a reviewer who clicks again deletes twice.
    const kind = pendingDelete?.kind;
    setPendingDelete(null);
    setStatus("Deleting the comment…");
    try {
      await serializeRuntimeWrite(() =>
        requestJson({
          path: "/api/comments-delete",
          identity,
          method: "POST",
          body: { commentId },
        }),
      );
      const [snapshotValue, agentValue] = await Promise.all([
        requestJson({ path: "/api/drafts", identity }),
        requestJson({ path: "/api/agent", identity }),
      ]);
      const snapshot = parseSnapshot(snapshotValue);
      setSent(snapshot.sent);
      setResolvedCommentIds(new Set(snapshot.resolvedCommentIds));
      acceptAgentSnapshot(parseAgentSnapshot(agentValue));
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
          : kind === "reverted"
            ? "Comment deleted."
            : "Queued comment deleted.",
      );
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };
  const revertAgentChanges = async () => {
    if (identity === null || pendingRevert === null) return;
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
    setDrafts((current) =>
      current.map((comment) =>
        comment.id === id ? { ...comment, body } : comment,
      ),
    );
    setStatus("Comment updated locally.");
  };

  const sendChat = async () => {
    const body = chatBody.trim();
    if (identity === null) {
      setStatus("Start `big-plan review` to ask the coding agent.");
      return;
    }
    if (body === "") return;
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
  const activeRequest = selectActiveAgentRequest({
    requests: agent.requests,
    cancelPendingRequestIds,
    now: agentProjectionNowMs,
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
  const currentAgentActivity = deriveCurrentAgentActivity({
    requests: agent.requests,
    cancelPendingRequestIds,
    progressEvents: progress,
    agentConnected,
    runtimeOffline: pollIsOffline,
    now: agentProjectionNowMs,
    heartbeatAt: agent.presence.updatedAtMs ?? 0,
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
        delivery={projectRequestDelivery({
          request,
          nowMs: agentProjectionNowMs,
        })}
        identity={identity}
        status={statusForRequest(request, "chat")}
        activity={activityForRequest(request)}
        onStatus={setStatus}
        onShowAgent={showAgentSetup}
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
  const agentHealthLabel = agentStatusIsAvailable
    ? deriveAgentHealthLabel({
        activity: currentAgentActivity,
        hasAgentRuntime: identity !== null,
        isReadOnly: runtimeSession?.authoritative === false,
      })
    : null;
  const isAgentWorking = currentAgentActivity.state === "working";
  const agentSessionLabel = isAgentWorking
    ? "Agent working"
    : "Agent session active";
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
    if (!resolvedCommentIds.has(commentId)) {
      closeTour();
      if (selectedCommentId === commentId) setSelectedCommentId(null);
      const comment = [...drafts, ...sent].find(
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
    setResolvedCommentIds((current) => {
      const next = new Set(current);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };
  const viewAgentRequest = (requestId: string, kind: string) => {
    if (kind === "chat") {
      setTab("chat");
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
    setTab("comments");
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
  const activeBatchRequest = selectActiveFeedbackBatch({
    requests: agent.requests,
    cancelPendingRequestIds,
  });
  const activeBatchCommentIds =
    activeBatchRequest === undefined
      ? []
      : requestCommentIds(activeBatchRequest).filter((commentId) =>
          visibleUnresolvedSent.some((comment) => comment.id === commentId),
        );

  return (
    <>
      {serverGone ? (
        <ServerGoneBanner
          canRefresh={canRefreshReview}
          onRefresh={() => window.location.reload()}
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
              className="review-image-comment review-block-button group inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent p-0 text-comment-rest hover:text-ink focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:text-ink [&>svg]:size-3.5"
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
              {agentHealthLabel === null ? (
                identity !== null && agentConnected ? (
                  <Tooltip label={agentSessionLabel}>
                    <button
                      type="button"
                      className="inline-flex size-11 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 hover:bg-surface focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent wide:size-8"
                      aria-label={agentSessionLabel}
                      onClick={() => {
                        setIsOpen(true);
                        setTab("agent");
                      }}
                    >
                      <span
                        className={`review-agent-active-indicator inline-flex size-2.5 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--diff-add-c)_34%,transparent)] ${isAgentWorking ? "review-agent-active-indicator--working" : ""}`}
                        aria-hidden="true"
                      >
                        <span className="size-1.5 rounded-full bg-[var(--diff-add-c)]" />
                      </span>
                    </button>
                  </Tooltip>
                ) : null
              ) : (
                <AgentHealthAlert
                  label={agentHealthLabel}
                  tone={
                    runtimeSession?.authoritative === false
                      ? "warning"
                      : "danger"
                  }
                  onOpen={() => {
                    setIsOpen(true);
                    setTab("agent");
                  }}
                />
              )}
              <button
                type="button"
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-muted shadow-none hover:bg-surface hover:text-ink hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:inset-shadow-pressed aria-expanded:border-accent aria-expanded:bg-accent-wash aria-expanded:text-accent aria-expanded:shadow-raised wide:min-h-8 [&>svg]:size-4"
                aria-expanded={isOpen}
                aria-controls="big-plan-feedback-rail"
                onClick={() => setIsOpen((current) => !current)}
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
          id="big-plan-feedback-rail"
          className="fixed top-11 right-0 bottom-0 z-40 flex w-[min(22rem,100vw)] min-w-0 max-w-full flex-col overflow-hidden border-l border-edge bg-paper text-ink shadow-floating"
          aria-label="Feedback"
        >
          <div className="flex flex-none items-stretch border-b border-edge bg-paper">
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
                  id="review-tab-agent"
                  type="button"
                  className={FEEDBACK_TAB_CLASS}
                  role="tab"
                  aria-controls="review-panel-agent"
                  aria-selected={tab === "agent"}
                  tabIndex={tab === "agent" ? 0 : -1}
                  onClick={() => setTab("agent")}
                >
                  <Icon icon={ACTIVITY_ICON} />
                  Agent
                </button>
              )}
            </div>
            <Button
              variant="ghost"
              size="compactIcon"
              className="mr-2 ml-auto min-h-0 self-center"
              aria-label="Close feedback"
              onClick={() => setIsOpen(false)}
            >
              <Icon icon={X_ICON} />
            </Button>
          </div>
          {tab === "comments" ? (
            <CommentsSurface
              model={{
                query: commentQuery,
                onQueryChange: setCommentQuery,
                drafts: visibleDrafts,
                sentCount: visibleUnresolvedSent.length + resolvedSent.length,
                hasRuntime: identity !== null,
                hasComponentBatchNotes: componentBatchNotes,
                groups: sentByGroup,
                workingBatch:
                  activeBatchRequest === undefined ||
                  activeBatchCommentIds.length === 0
                    ? undefined
                    : {
                        count: activeBatchCommentIds.length,
                        label: statusForRequest(activeBatchRequest, "thread")
                          .label,
                        tone:
                          statusForRequest(activeBatchRequest, "thread")
                            .stage === "waiting"
                            ? ("queued" as const)
                            : ("working" as const),
                        content: (
                          <Card
                            className="m-0 w-full max-w-none border border-[var(--callout-note-c)] bg-[var(--callout-note-bg)] text-[var(--callout-note-ink)] shadow-none"
                            density="dense"
                            elevation="none"
                          >
                            <RequestStatusStrip
                              status={statusForRequest(
                                activeBatchRequest,
                                "thread",
                              )}
                              activity={activityForRequest(activeBatchRequest)}
                              surface="thread"
                              commentCount={activeBatchCommentIds.length}
                              onShowAgent={showAgentSetup}
                              onCancelRequest={() =>
                                void cancelRequest(activeBatchRequest.requestId)
                              }
                            />
                          </Card>
                        ),
                      },
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
                    onShowAgent={showAgentSetup}
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
                    onShowAgent={showAgentSetup}
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
                      onShowAgent={showAgentSetup}
                      onCancelRequest={(requestId) =>
                        void cancelRequest(requestId)
                      }
                      onDelete={() =>
                        setPendingDelete({
                          kind:
                            thread.latestChanged?.baselineSnapshot ===
                            currentSnapshot
                              ? "reverted"
                              : thread.latestCanceled
                                ? "canceled"
                                : "queued",
                          comment,
                        })
                      }
                      onRevert={(requestId, commentId) =>
                        setPendingRevert({ requestId, commentId })
                      }
                      currentSnapshot={currentSnapshot}
                      unsavedInputKey={`reply:rail:${comment.id}`}
                      onUnsavedInputChange={onUnsavedInputChange}
                      compact={compact}
                      queuePosition={queuePosition}
                      suppressPendingStatus={activeBatchCommentIds.includes(
                        comment.id,
                      )}
                    />
                  );
                },
                onResolveAll: () =>
                  setResolvedCommentIds(
                    new Set([
                      ...resolvedCommentIds,
                      ...unresolvedSent
                        .filter(
                          (comment) =>
                            threadProjections.get(comment.id)?.group ===
                            "ready",
                        )
                        .map((comment) => comment.id),
                    ]),
                  ),
                onDeleteAll: () =>
                  setPendingDelete({
                    kind: "all",
                    count: unresolvedDrafts.length,
                  }),
              }}
            />
          ) : null}
          {tab === "chat" ? (
            <ChatSurface
              model={{
                hasRuntime: identity !== null,
                identity,
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
          {tab === "agent" && identity !== null ? (
            <AgentSurface
              model={{
                activity: currentAgentActivity,
                presenceState: agentProjection.state,
                connected: agentConnected,
                heartbeatAt: agent.presence.updatedAtMs ?? 0,
                modelName: activeRequest?.claimedModel?.name,
                connectionLog: agentConnection.events,
                recoveryPrompt: agent.recoveryPrompt,
                agentCommand: agent.agentCommand,
                plan: agent.plan,
                runtimeSession,
                attentionKey: agentAttentionKey,
                onViewRequest: viewAgentRequest,
              }}
            />
          ) : null}
          {tab === "comments" ? (
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
                      aria-label={`${currentAgentActivity.headline} — view Agent tab`}
                      onClick={showAgentSetup}
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
                    <Badge tone="secondary" size="compact">
                      {currentAgentActivity.state === "disconnected"
                        ? "Offline"
                        : currentAgentActivity.state === "stalled"
                          ? "Warning"
                          : currentAgentActivity.state}
                    </Badge>
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
              onShowAgent={showAgentSetup}
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
                onShowAgent={showAgentSetup}
                onCancelRequest={(requestId) => void cancelRequest(requestId)}
                onDelete={() =>
                  setPendingDelete({
                    kind:
                      thread.latestChanged?.baselineSnapshot === currentSnapshot
                        ? "reverted"
                        : thread.latestCanceled
                          ? "canceled"
                          : "queued",
                    comment,
                  })
                }
                onRevert={(requestId, commentId) =>
                  setPendingRevert({ requestId, commentId })
                }
                currentSnapshot={currentSnapshot}
                unsavedInputKey={`reply:thread:${comment.id}`}
                onUnsavedInputChange={onUnsavedInputChange}
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
          submitAvailability={commentSubmitAvailability}
          onCancel={() => {
            setCompose(null);
            setComposeBody("");
          }}
          onBodyChange={setComposeBody}
          onSave={saveComment}
          onSubmitRightAwayChange={setSubmitRightAway}
          onShowAgent={showAgentSetup}
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
            submitAvailability={commentSubmitAvailability}
            onCancel={() => {
              setCompose(null);
              setComposeBody("");
            }}
            onBodyChange={setComposeBody}
            onSave={saveComment}
            onSubmitRightAwayChange={setSubmitRightAway}
            onShowAgent={showAgentSetup}
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
                : pendingDelete?.kind === "reverted"
                  ? "Delete comment?"
                  : "Delete comment?"
        }
        description={
          pendingDelete?.kind === "all"
            ? `This permanently removes all ${pendingDelete.count} staged ${pendingDelete.count === 1 ? "comment" : "comments"}. This action cannot be undone.`
            : pendingDelete?.kind === "canceled"
              ? "This permanently removes the canceled comment and its thread. This action cannot be undone."
              : pendingDelete?.kind === "queued"
                ? "This removes the comment before the agent picks it up. This action cannot be undone."
                : pendingDelete?.kind === "reverted"
                  ? "This permanently removes the comment and its thread. The reverted plan changes stay reverted."
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
            pendingDelete?.kind === "reverted"
          ) {
            void deleteSentComment(pendingDelete.comment.id);
          }
        }}
      />
    </>
  );
};
