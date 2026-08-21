// Owns the shared legacy-compatible You/Agent turn, status-strip, activity,
// message-body, panel-pill, and change-digest presentation for the review
// island. The Markdown walkers a body renders through are owned by
// message-markdown-view.browser.tsx so every renderer shares one.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CIRCLE_X_ICON } from "../../icons/lucide/circle-x.js";
import { HOURGLASS_ICON } from "../../icons/lucide/hourglass.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import { parseMessageMarkdown } from "../shared/message-markdown.js";
import { parseReviewerMarkdown } from "../shared/reviewer-markdown.js";
import { messageTimeLabel } from "../shared/time-label.js";
import type { AgentStatus } from "../shared/agent-status.js";
import type { ProgressStepCode } from "../shared/progress-code.js";
import type { DiffPlace, SnapshotDiff } from "../shared/review-wire.js";
import {
  UNRECORDABLE_ACCEPTANCE_LABEL,
  useDiffTour,
} from "./diff-tour.browser.js";
import { Icon } from "./icon.browser.js";
import {
  renderMessageNode,
  renderReviewerNode,
} from "./message-markdown-view.browser.js";
import { foundElement, liveBlock } from "./live-target.browser.js";
import { Badge, Button, Tooltip, WorkingMark } from "./ui.browser.js";

export type MessageSurface = "thread" | "chat";

export type MessageActivity = {
  readonly seq: number;
  readonly stepCode: ProgressStepCode;
  readonly step: string;
  readonly state: "waiting" | "live" | "done" | "failed";
  readonly detail?: string;
  readonly atMs?: number;
};

const THREAD_BASE =
  "mt-2 box-border w-auto min-w-0 max-w-full overflow-hidden rounded-lg border border-edge px-2 py-2";
const CHAT_BASE =
  "box-border w-auto min-w-0 max-w-full overflow-hidden rounded-lg border border-edge px-2 py-2";
const ROLE_CLASSES = {
  user: "ml-4 border-r-2 border-r-[var(--annotation-c)] bg-[color-mix(in_srgb,var(--annotation-bg)_30%,var(--bg))]",
  agent:
    "mr-4 border-l-2 border-l-[var(--callout-note-c)] bg-[color-mix(in_srgb,var(--callout-note-bg)_46%,var(--bg))]",
} as const;

const absoluteTime = (at: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));

const MessageBody = ({
  body,
  isStructured,
}: {
  readonly body: string;
  readonly isStructured: boolean;
}) =>
  isStructured ? (
    <div
      className="min-w-0 max-w-full text-xs leading-4 text-ink whitespace-pre-wrap [overflow-wrap:anywhere]"
      data-review-message-body="structured"
    >
      {parseMessageMarkdown(body).map((node, index) =>
        renderMessageNode(node, String(index)),
      )}
    </div>
  ) : (
    <div
      className="min-w-0 max-w-full text-xs text-ink [line-height:1.45] whitespace-pre-wrap [overflow-wrap:anywhere]"
      data-review-message-body="reviewer"
    >
      {parseReviewerMarkdown(body).map((node, index) =>
        renderReviewerNode(node, String(index)),
      )}
    </div>
  );

/** Renders one exact legacy speaker turn on either feedback surface. */
export const MessageTurn = ({
  role,
  speakerLabel,
  surface,
  body,
  createdAt,
  delivery,
  children,
}: {
  readonly role: "user" | "agent";
  readonly speakerLabel?: string;
  readonly surface: MessageSurface;
  readonly body: string;
  readonly createdAt: string;
  readonly delivery?: "Sent" | "Queued" | "Saved";
  readonly children?: ReactNode;
}) => {
  const time = messageTimeLabel({
    now: Date.now(),
    createdAt,
    absoluteLabel: absoluteTime,
  });
  return (
    <div
      className={`${surface === "thread" ? THREAD_BASE : CHAT_BASE} ${ROLE_CLASSES[role]}`}
      data-review-message={role}
    >
      <div className="flex items-center gap-1.5 text-2xs text-muted">
        <strong className="text-2xs text-ink">
          {speakerLabel ?? (role === "user" ? "You" : "Agent")}
        </strong>
        <time className="ml-auto" dateTime={createdAt}>
          {role === "user" && delivery !== undefined
            ? `${delivery} · ${time}`
            : time}
        </time>
      </div>
      <MessageBody body={body} isStructured={role === "agent"} />
      {children}
    </div>
  );
};

/** Keeps a collapsed reviewer message visually continuous with its full turn. */
export const ReviewerMessagePreview = ({
  body,
  onExpand,
  role = "user",
  label,
}: {
  readonly body: string;
  readonly onExpand: () => void;
  readonly role?: "user" | "agent";
  readonly label?: string;
}) => {
  const previewRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (preview === null) return;
    const update = () =>
      setIsTruncated(preview.scrollHeight > preview.clientHeight + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [body]);
  return (
    <button
      type="button"
      className={`${THREAD_BASE} ${ROLE_CLASSES[role]} review-sent-summary block cursor-pointer text-left text-xs text-ink [line-height:1.45] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
      aria-label={label ?? `Expand thread: ${body}`}
      aria-expanded="false"
      onClick={onExpand}
    >
      <span ref={previewRef} className="line-clamp-3 [overflow-wrap:anywhere]">
        {body}
      </span>
      {isTruncated ? (
        <span className="mt-1 block text-2xs font-semibold text-accent">
          … more
        </span>
      ) : null}
    </button>
  );
};

const Spinner = () => <WorkingMark className="size-[0.72rem]" />;

const STATUS_TONES = {
  neutral:
    "border-edge bg-[color-mix(in_srgb,var(--surface-c)_60%,var(--bg))] text-muted",
  positive:
    "border-[var(--callout-note-c)] bg-[var(--callout-note-bg)] text-[var(--callout-note-c)]",
  warning:
    "border-[var(--callout-warning-c)] bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]",
  danger:
    "border-[var(--callout-danger-c)] bg-[var(--callout-danger-bg)] text-[var(--callout-danger-c)]",
} as const;

/** Places request lifecycle and narrated activity directly under its user turn. */
/**
 * The past-horizon reading, which the vocabulary marks by tone rather than by a
 * stage of its own: a claim quiet past the recovery horizon has stopped
 * explaining anything, so its copy sends the reviewer to Agent Status and the
 * surfaces here have to carry that route and read differently from an ordinary
 * quiet turn (BIG-147).
 */
const abandonedReading = (status: AgentStatus): boolean =>
  status.stage === "stalled" && status.tone === "danger";

export const RequestStatusStrip = ({
  status,
  activity,
  surface,
  commentCount = 1,
  onShowAgent,
  onCancelRequest,
}: {
  readonly status: AgentStatus;
  readonly activity: ReadonlyArray<MessageActivity>;
  readonly surface: MessageSurface;
  readonly commentCount?: number;
  readonly onShowAgent: () => void;
  readonly onCancelRequest?: () => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const meaningful = activity
    .filter(
      (event) =>
        (event.state === "live" || event.state === "waiting") &&
        event.stepCode !== "reply-sent" &&
        event.stepCode !== "chat-sent" &&
        event.stepCode !== "feedback-received",
    )
    .filter(
      (event, index, events) =>
        index === 0 ||
        events[index - 1]?.step.toLowerCase() !== event.step.toLowerCase(),
    )
    .slice(-8);
  const current = meaningful.at(-1);
  const earlier = meaningful.slice(0, -1).reverse();
  const currentText =
    current === undefined
      ? "Starting work…"
      : current.step +
        (current.detail === undefined ? "" : ` — ${current.detail}`);
  const hasCurrentTooltip = currentText.length > 96;
  const isWorking = status.stage === "working";
  const icon =
    status.stage === "waiting" ? (
      <Icon icon={HOURGLASS_ICON} />
    ) : status.stage === "blocked" || status.stage === "stalled" ? (
      <Icon icon={TRIANGLE_ALERT_ICON} />
    ) : status.stage === "failed" || status.stage === "offline" ? (
      <Icon icon={CIRCLE_X_ICON} />
    ) : null;
  return (
    <div
      className={`my-1.5 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 rounded-md border border-l-[3px] px-2 py-2 text-2xs ${STATUS_TONES[status.tone]}`}
      data-review-thread-status={status.stage}
    >
      <div className="flex items-center gap-1.5 [&>svg]:size-[0.85rem] [&>svg]:shrink-0">
        {isWorking ? <Spinner /> : icon}
        <strong className="min-w-0 flex-1 font-bold">
          {isWorking && commentCount > 1 ? (
            `Agent is working on ${commentCount} comments`
          ) : status.stage === "waiting" && status.label !== "Waiting" ? (
            <>
              <span className="block">{status.label}</span>
              <span className="block font-medium">{status.headline}</span>
            </>
          ) : (
            status.headline
          )}
        </strong>
      </div>
      {status.detail === "" ? null : (
        <p className="m-0 text-ink [overflow-wrap:anywhere]">{status.detail}</p>
      )}
      {status.stage === "blocked" || abandonedReading(status) ? (
        <button
          type="button"
          className="mt-1.5 w-fit cursor-pointer border-0 bg-transparent p-0 font-semibold text-current underline underline-offset-[0.16em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={onShowAgent}
        >
          Show setup instructions →
        </button>
      ) : null}
      {isWorking && surface === "thread" ? (
        <p className="mt-0.5 mb-0 text-muted">
          Updating {commentCount} comment{commentCount === 1 ? "" : "s"}
        </p>
      ) : null}
      {isWorking ? (
        hasCurrentTooltip ? (
          <Tooltip
            label={currentText}
            className="block"
            placement="below"
            asChild
          >
            <p
              className="mt-1.5 mb-0 min-w-0 text-xs text-ink [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              data-review-status-current-activity=""
              aria-live="polite"
              tabIndex={0}
            >
              <span className="line-clamp-3">{currentText}</span>
            </p>
          </Tooltip>
        ) : (
          <p
            className="mt-1.5 mb-0 min-w-0 text-xs text-ink [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            data-review-status-current-activity=""
            aria-live="polite"
          >
            {currentText}
          </p>
        )
      ) : null}
      {isWorking && earlier.length > 0 ? (
        <button
          type="button"
          className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-2xs text-muted hover:text-ink [&>svg]:size-3"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          <Icon icon={CHEVRON_RIGHT_ICON} />
          {isExpanded
            ? "Hide earlier updates"
            : `Show ${earlier.length} earlier update${earlier.length === 1 ? "" : "s"}`}
        </button>
      ) : null}
      {isWorking && isExpanded && earlier.length > 0 ? (
        <ol className="m-0 grid max-h-36 min-w-0 grid-cols-[minmax(0,1fr)] list-none overflow-y-auto pl-1 text-ink">
          {earlier.map((event) => (
            <li
              key={event.seq}
              className="flex min-w-0 items-baseline justify-between gap-2 border-t border-current/15 py-1 first:border-t-0"
            >
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {event.step}
                {event.detail === undefined ? "" : ` — ${event.detail}`}
              </span>
              {event.atMs === undefined ? null : (
                <time className="shrink-0 text-2xs text-muted">
                  {messageTimeLabel({
                    now: Date.now(),
                    createdAt: new Date(event.atMs).toISOString(),
                    absoluteLabel: absoluteTime,
                  })}
                </time>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      {onCancelRequest === undefined || status.stage === "answered" ? null : (
        <button
          type="button"
          className="-mx-1 cursor-pointer justify-self-end rounded-sm px-1 text-2xs underline underline-offset-[0.16em] hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          onClick={onCancelRequest}
        >
          Cancel request
        </button>
      )}
    </div>
  );
};

const PILL_STYLES = {
  idle: "bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]",
  working: "bg-[var(--callout-note-bg)] text-[var(--callout-note-c)]",
  ready: "bg-[var(--diff-add-bg)] text-[var(--diff-add-c)]",
  failed: "bg-[var(--callout-danger-bg)] text-[var(--callout-danger-c)]",
} as const;

/** Summarizes the session while leaving request truth on each message turn. */
export const AgentStatePill = ({
  status,
}: {
  readonly status: AgentStatus;
}) => {
  const state =
    status.stage === "working"
      ? ({ tone: "working", label: "Agent working" } as const)
      : status.stage === "answered"
        ? ({ tone: "ready", label: "Ready to re-review" } as const)
        : status.stage === "failed"
          ? ({ tone: "failed", label: "Agent needs attention" } as const)
          : status.stage === "offline"
            ? ({ tone: "failed", label: "Agent disconnected" } as const)
            : status.stage === "blocked"
              ? ({ tone: "failed", label: "No agent connected" } as const)
              : abandonedReading(status)
                ? ({
                    tone: "failed",
                    label: "No longer reporting — connect an agent",
                  } as const)
                : status.stage === "stalled"
                  ? ({
                      tone: "idle",
                      label: "Agent silent — check terminal",
                    } as const)
                  : status.stage === "waiting"
                    ? ({ tone: "idle", label: "Waiting for agent" } as const)
                    : ({ tone: "idle", label: "Waiting for you" } as const);
  return (
    <span
      className={`ml-auto rounded-full px-2 py-0.5 text-2xs font-semibold whitespace-nowrap ${PILL_STYLES[state.tone]}`}
      data-review-agent-state=""
      data-tone={state.tone}
    >
      {state.label}
    </span>
  );
};

/** Attaches a quiet grouped revision digest to the answer that caused it. */
export const AgentChangeDigest = ({
  diff,
  placeIds,
  spilloverCount,
  isSuperseded,
  isLoading,
  onLoad,
  actionLabel,
  onResolve,
  onRevert,
  canRevert,
  thread,
  onKeepChatting,
}: {
  readonly diff: SnapshotDiff | null;
  readonly placeIds?: ReadonlyArray<string>;
  readonly spilloverCount?: number;
  readonly isSuperseded?: boolean;
  readonly isLoading: boolean;
  readonly onLoad: () => void;
  readonly actionLabel?: string;
  readonly onResolve?: () => void;
  readonly onRevert?: () => void;
  readonly canRevert?: boolean;
  readonly thread?: {
    readonly label: string;
    readonly onOpen: () => void;
  };
  readonly onKeepChatting?: () => void;
}) => {
  const {
    activeDiff,
    activePlaceId,
    canRecordAcceptance,
    isPlaceAccepted,
    setPlacesAccepted,
    standingOf,
    closeTour,
    openTour,
  } = useDiffTour();
  const available =
    diff === null
      ? []
      : placeIds === undefined
        ? diff.places
        : diff.places.filter((place) => placeIds.includes(place.placeId));
  const [expandedChoice, setExpandedChoice] = useState<boolean | null>(null);
  const isExpanded = expandedChoice ?? available.length <= 3;
  if (diff === null) {
    return (
      <button
        type="button"
        className="mt-2 rounded-md border border-edge bg-paper px-2 py-1 text-2xs font-semibold text-accent hover:border-accent hover:bg-surface"
        disabled={isLoading}
        onClick={onLoad}
      >
        {isLoading ? "Loading changes…" : "See changes"}
      </button>
    );
  }
  if (available.length === 0) return null;
  // The digest and the stepper reviewing this same set both ask the selector,
  // so the two can never disagree about how much is still open.
  const standing = standingOf(
    diff,
    available.map((place) => place.placeId),
  );
  const allAccepted = standing.isAccepted;
  const ownsActiveTour =
    activeDiff?.from === diff.from && activeDiff?.to === diff.to;
  const isActive =
    ownsActiveTour &&
    available.some((place) => place.placeId === activePlaceId);
  const sections = new Map<string, Array<DiffPlace>>();
  for (const change of available) {
    const group = sections.get(change.section) ?? [];
    group.push(change);
    sections.set(change.section, group);
  }
  const sectionKicker = (entries: ReadonlyArray<DiffPlace>): string | null => {
    for (const entry of entries) {
      for (const index of entry.locationIndexes) {
        const location = diff.locations.at(index);
        const blockId = location?.newBlockId ?? location?.oldBlockId;
        if (blockId === undefined) continue;
        const kicker = foundElement(liveBlock(blockId))
          ?.closest<HTMLElement>("[data-slide]")
          ?.querySelector<HTMLElement>("[data-slide-kicker]")
          ?.textContent?.trim();
        if (kicker !== undefined && kicker !== "") return kicker;
      }
    }
    return null;
  };
  return (
    <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 border-t border-edge pt-2">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-1 rounded-sm bg-transparent px-1 py-0.5 text-left text-2xs font-bold text-muted hover:bg-surface hover:text-accent [&>svg]:size-3"
        aria-expanded={isExpanded}
        onClick={() => setExpandedChoice(!isExpanded)}
      >
        <Icon icon={CHEVRON_RIGHT_ICON} />
        {available.length} change{available.length === 1 ? "" : "s"} across{" "}
        {sections.size} slide{sections.size === 1 ? "" : "s"}
        {standing.accepted === 0 ? null : allAccepted ? (
          <Badge className="ml-auto" size="status" tone="statusAccent">
            Accepted
          </Badge>
        ) : (
          <span
            // A generic span cannot carry an accessible name, so a reader would
            // be told only "1/2". The image role is what lets the label stand
            // in for the shorthand the sighted reader sees.
            role="img"
            className="ml-auto shrink-0 font-medium text-accent"
            aria-label={`${standing.accepted} of ${standing.total} changes accepted`}
          >
            {standing.accepted}/{standing.total}
          </span>
        )}
      </button>
      {isExpanded ? (
        <div className="min-w-0 overflow-hidden rounded-md border border-edge bg-paper">
          {Array.from(sections).map(([section, entries]) => (
            <div key={section}>
              <div
                className="flex min-w-0 items-center gap-2 border-t border-edge bg-surface px-2 py-1.5 text-2xs font-semibold text-subtle first:border-t-0"
                data-review-diff-section=""
              >
                <span className="min-w-0 flex-1 truncate">
                  {sectionKicker(entries) ?? section}
                </span>
                <span className="rounded-full bg-paper px-1 text-2xs">
                  {entries.length}
                </span>
              </div>
              {entries.map((entry) => (
                <button
                  type="button"
                  key={entry.placeId}
                  className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0.5 border-0 border-t border-edge bg-transparent px-6 py-2 text-left text-xs font-medium text-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-accent aria-current:bg-accent-soft aria-current:text-accent"
                  aria-current={
                    activePlaceId === entry.placeId ? "step" : undefined
                  }
                  onClick={() =>
                    openTour({
                      diff,
                      placeIds: available.map((place) => place.placeId),
                      startPlaceId: entry.placeId,
                      isSuperseded,
                      onResolve,
                      onRevert,
                      canRevert,
                      thread,
                      onKeepChatting,
                    })
                  }
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {entry.label}
                  </span>
                  {isPlaceAccepted(diff, entry.placeId) ? (
                    <span
                      className="row-span-2 inline-flex shrink-0 items-center self-center text-accent [&>svg]:size-3.5"
                      aria-label="Accepted"
                    >
                      <Icon icon={CHECK_ICON} />
                    </span>
                  ) : null}
                  <em className="col-start-1 text-2xs font-normal text-muted capitalize">
                    {entry.note}
                  </em>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {spilloverCount === undefined || spilloverCount === 0 ? null : (
        <p className="m-0 text-2xs text-muted">
          {spilloverCount} other change{spilloverCount === 1 ? "" : "s"}{" "}
          elsewhere in this snapshot
        </p>
      )}
      {allAccepted ? (
        <p
          className="m-0 border-t border-edge pt-2 text-2xs font-semibold text-accent"
          data-review-changes-accepted=""
        >
          Change set accepted
        </p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          className="w-fit rounded-md border border-edge bg-paper px-2 py-1 text-2xs font-semibold text-accent hover:border-accent hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => {
            if (isActive) {
              closeTour();
              return;
            }
            openTour({
              diff,
              placeIds: available.map((place) => place.placeId),
              isSuperseded,
              onResolve,
              onRevert,
              canRevert,
              thread,
              onKeepChatting,
            });
          }}
        >
          {isActive
            ? "Exit review"
            : (actionLabel ??
              (standing.accepted > 0 && !allAccepted
                ? "Continue review"
                : available.length === 1
                  ? "Review change"
                  : `Review changes (${available.length})`))}
        </button>
        {available.length <= 1 || allAccepted ? null : (
          <Button
            variant="accentOutline"
            size="micro"
            disabled={!canRecordAcceptance}
            aria-label={
              canRecordAcceptance
                ? "Accept all changes"
                : UNRECORDABLE_ACCEPTANCE_LABEL
            }
            onClick={() =>
              setPlacesAccepted(
                diff,
                available.map((place) => place.placeId),
                true,
              )
            }
          >
            Accept all
          </Button>
        )}
      </div>
    </div>
  );
};
