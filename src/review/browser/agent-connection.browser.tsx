// Renders the legacy agent-health surface from truthful runtime facts. The
// review kernel owns polling and navigation; this module owns only the visual
// projection and local disclosure/copy interactions.

import { useEffect, useRef, useState } from "react";
import { BOT_ICON } from "../../icons/lucide/bot.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { COPY_ICON } from "../../icons/lucide/copy.js";
import { TERMINAL_ICON } from "../../icons/lucide/terminal.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import type { CurrentAgentActivity } from "../shared/agent-status.js";
import type { BrowserConnectionEvent } from "../shared/review-wire.js";
import {
  compactDurationLabel,
  relativeSignalLabel,
} from "../shared/time-label.js";
import { Icon } from "./icon.browser.js";
import type { ReviewAgentProjection } from "./review-poll-health.js";

const Spinner = () => (
  <span
    className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
    aria-hidden="true"
  />
);

// Keep human-readable elapsed time independent from the slower network poll.
// This component exists only while the Agent tab is mounted, so the local
// tick cannot make the rest of the review workspace rerender every second.
const useSecondClock = (): number => {
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return nowMs;
};

export const AgentHealthAlert = ({
  label,
  tone,
  onOpen,
}: {
  readonly label: string;
  readonly tone: "warning" | "danger";
  readonly onOpen: () => void;
}) => (
  <button
    type="button"
    className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 py-1 text-xs font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent wide:min-h-8 [&>svg]:size-4 ${tone === "warning" ? "text-warning" : "text-danger"}`}
    aria-label={`${label} — open agent connection status`}
    onClick={onOpen}
  >
    <Icon icon={TRIANGLE_ALERT_ICON} />
    {label}
  </button>
);

const ReadOnlySessionCard = ({
  replacementUrl,
}: {
  readonly replacementUrl: string | null;
}) => (
  <article
    className="grid min-w-0 gap-2 rounded-lg border border-[var(--callout-warning-c)] bg-[var(--callout-warning-bg)] p-3 text-xs leading-[1.45] text-[var(--callout-warning-c)]"
    data-review-current-activity="read-only"
  >
    <div className="flex min-w-0 items-center gap-2">
      <span
        className="size-2 shrink-0 rounded-full border-2 border-current opacity-70"
        aria-hidden="true"
      />
      <strong className="min-w-0 flex-1 text-sm text-ink">
        This review was replaced
      </strong>
      <span className="rounded-full bg-[color-mix(in_srgb,currentColor_10%,transparent)] px-2 py-0.5 text-2xs font-bold uppercase tracking-caps">
        Read only
      </span>
    </div>
    <p className="m-0 text-ink [overflow-wrap:anywhere]">
      A newer review session is active for this plan. This tab remains safe to
      read, but it can no longer make changes.
    </p>
    <div className="flex min-w-0 items-center gap-2 border-t border-current/20 pt-2 text-2xs">
      <span className="text-muted">
        Your comments remain in the latest review.
      </span>
      {replacementUrl === null ? null : (
        <a
          className="ml-auto shrink-0 font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          href={replacementUrl}
        >
          Open latest review →
        </a>
      )}
    </div>
  </article>
);

const CopyBlock = ({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}) => {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    setCopied(false);
    setFailed(false);
    try {
      if (navigator.clipboard === undefined) throw new Error("Unavailable");
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setFailed(true);
      return;
    }
    window.setTimeout(() => setCopied(false), 1_500);
  };
  const buttonLabel = failed
    ? "Copy failed — select and copy manually"
    : copied
      ? `${label} copied`
      : `Copy ${label}`;
  return (
    <div className="relative min-w-0">
      <pre className="m-0 min-w-0 overflow-x-auto rounded-md border border-edge bg-surface p-3 pr-12 font-mono text-xs whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
        <code>{value}</code>
      </pre>
      <button
        type="button"
        className="absolute top-2 right-2 inline-flex cursor-pointer items-center gap-1 rounded-sm border border-edge bg-surface px-1.5 py-1 text-2xs text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&>svg]:size-3"
        aria-label={buttonLabel}
        onClick={() => void copy()}
      >
        <Icon icon={copied ? CHECK_ICON : COPY_ICON} />
        {failed ? "Copy failed" : copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
};

const CurrentActivityCard = ({
  activity,
  modelName,
  nowMs,
  attentionKey,
  onViewRequest,
}: {
  readonly activity: CurrentAgentActivity;
  readonly modelName?: string;
  readonly nowMs: number;
  readonly attentionKey: number;
  readonly onViewRequest: (requestId: string, kind: string) => void;
}) => {
  const cardRef = useRef<HTMLElement>(null);
  const [isAttentionActive, setIsAttentionActive] = useState(false);
  useEffect(() => {
    if (attentionKey === 0) return;
    const card = cardRef.current;
    if (card === null) return;
    card.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
    });
    card.focus({ preventScroll: true });
    setIsAttentionActive(true);
    const timer = window.setTimeout(() => setIsAttentionActive(false), 1_200);
    return () => window.clearTimeout(timer);
  }, [attentionKey]);
  const body =
    activity.state === "working" ? activity.latestStep : activity.supporting;
  // A live connection is the fact a reviewer checks this card for; what the
  // agent happens to be doing is the detail underneath it. Only the working
  // state buries the connection behind the activity, so only it is retitled,
  // and its activity joins the request it is working on one line down.
  const title =
    activity.state === "working" ? "Agent connected" : activity.headline;
  const targetLabel =
    activity.state !== "disconnected" && "targetLabel" in activity
      ? activity.targetLabel
      : undefined;
  const secondary =
    activity.state === "working"
      ? [activity.headline, targetLabel].filter(Boolean).join(" · ")
      : (targetLabel ?? "");
  const footerLabel =
    "updatedAtMs" in activity
      ? `Updated ${relativeSignalLabel({ now: nowMs, at: activity.updatedAtMs })}`
      : activity.state === "idle"
        ? "No unanswered requests"
        : null;
  return (
    <article
      ref={cardRef}
      className={`grid min-w-0 gap-2 rounded-lg border border-edge bg-raised p-3 text-xs leading-[1.45] text-muted outline-offset-2 transition-[outline-color] focus-visible:outline-2 focus-visible:outline-accent motion-reduce:scroll-auto ${isAttentionActive ? "outline-2 outline-accent" : "outline-transparent"}`}
      data-review-current-activity={activity.state}
      data-review-attention={isAttentionActive ? "true" : undefined}
      tabIndex={-1}
    >
      <div className="flex min-w-0 items-center gap-2">
        {activity.state === "working" ? (
          <Spinner />
        ) : (
          <span
            className="size-2 shrink-0 rounded-full border-2 border-current opacity-70"
            aria-hidden="true"
          />
        )}
        <strong className="min-w-0 flex-1 text-sm text-ink">{title}</strong>
        <span className="rounded-full bg-[color-mix(in_srgb,currentColor_10%,transparent)] px-2 py-0.5 text-2xs font-bold uppercase tracking-caps">
          {activity.state === "stalled"
            ? "warning"
            : activity.state === "disconnected"
              ? "offline"
              : activity.state}
        </span>
      </div>
      {modelName === undefined ? null : (
        <span
          className="inline-flex w-fit min-w-0 max-w-full items-center gap-1.5 rounded-full border border-current/20 bg-[color-mix(in_srgb,currentColor_8%,transparent)] px-2 py-0.5 text-2xs font-semibold text-ink [&>svg]:size-3"
          data-review-agent-model={modelName}
        >
          <Icon icon={BOT_ICON} />
          <span className="truncate">{modelName}</span>
        </span>
      )}
      {secondary === "" ? null : (
        <strong className="text-2xs uppercase tracking-caps text-ink">
          {secondary}
        </strong>
      )}
      <p className="m-0 text-ink [overflow-wrap:anywhere]">{body}</p>
      {footerLabel !== null || "requestId" in activity ? (
        <div className="flex min-w-0 items-center gap-2 border-t border-current/20 pt-2 text-2xs">
          {footerLabel === null ? null : (
            <span className="text-muted">{footerLabel}</span>
          )}
          {"requestId" in activity ? (
            <button
              type="button"
              className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() =>
                onViewRequest(activity.requestId, activity.requestKind)
              }
            >
              View thread →
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
};

const ConnectionHealthCard = ({
  connected,
  heartbeatAt,
  nowMs,
}: {
  readonly connected: boolean;
  readonly heartbeatAt: number;
  readonly nowMs: number;
}) => (
  <article
    className={`grid min-w-0 gap-2 rounded-lg border p-3 text-xs leading-[1.45] ${connected ? "border-[var(--diff-add-c)] bg-[var(--diff-add-bg)] text-[var(--diff-add-c)]" : "border-[var(--callout-danger-c)] bg-[var(--callout-danger-bg)] text-[var(--callout-danger-c)]"}`}
    data-review-connection-health={connected ? "connected" : "disconnected"}
  >
    <div className="flex min-w-0 items-center gap-2">
      <span
        className="size-2 shrink-0 rounded-full border-2 border-current opacity-70"
        aria-hidden="true"
      />
      <strong className="min-w-0 flex-1 text-sm text-ink">
        {connected ? "Agent connected" : "Agent disconnected"}
      </strong>
      <span className="rounded-full bg-[color-mix(in_srgb,currentColor_10%,transparent)] px-2 py-0.5 text-2xs font-bold uppercase tracking-caps">
        {connected ? "online" : "offline"}
      </span>
    </div>
    <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 border-t border-current/20 pt-2">
      <div className="min-w-0">
        <dt className="text-2xs font-bold uppercase tracking-caps opacity-80">
          Connection
        </dt>
        <dd className="m-0 text-ink">
          {connected ? "Healthy" : "Unavailable"}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-2xs font-bold uppercase tracking-caps opacity-80">
          Last signal
        </dt>
        <dd className="m-0 text-ink [overflow-wrap:anywhere]">
          {relativeSignalLabel({ now: nowMs, at: heartbeatAt })}
        </dd>
      </div>
    </dl>
  </article>
);

const AgentPresenceUnavailableCard = () => (
  <article
    className="grid min-w-0 gap-1 rounded-lg border border-edge bg-raised p-3 text-xs leading-[1.45] text-muted"
    data-review-connection-health="unobservable"
  >
    <strong className="text-sm text-ink">Agent status unavailable</strong>
    <p className="m-0 [overflow-wrap:anywhere]">
      The review session is offline, so agent presence cannot be checked.
    </p>
  </article>
);

const AgentPresenceLoadingCard = () => (
  <article
    className="grid min-w-0 gap-1 rounded-lg border border-edge bg-raised p-3 text-xs leading-[1.45] text-muted"
    data-review-connection-health="loading"
  >
    <strong className="text-sm text-ink">Checking agent status</strong>
    <p className="m-0 [overflow-wrap:anywhere]">
      Waiting for the first review session update.
    </p>
  </article>
);

const AnotherViewTip = () => (
  <aside className="mt-3 flex min-w-0 gap-2 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-muted">
    <Icon icon={TERMINAL_ICON} />
    <p className="m-0 min-w-0 [overflow-wrap:anywhere]">
      <strong className="text-ink">Another view:</strong> inspect the agent chat
      or terminal for another view of progress. This does not restore the review
      connection.
    </p>
  </aside>
);

const ConnectionLog = ({
  connected,
  heartbeatAt,
  events,
  nowMs,
}: {
  readonly connected: boolean;
  readonly heartbeatAt: number;
  readonly events: ReadonlyArray<BrowserConnectionEvent>;
  readonly nowMs: number;
}) => {
  const ordered = events
    .map((event) => ({ ...event, atMs: Date.parse(event.at) }))
    .filter((event) => Number.isFinite(event.atMs))
    .sort((left, right) => left.atMs - right.atMs);
  const latest = ordered.at(-1);
  let disconnects = 0;
  let reconnects = 0;
  let hasConnected = false;
  ordered.forEach((event, index) => {
    if (!event.connected && ordered[index - 1]?.connected) disconnects += 1;
    if (
      event.connected &&
      hasConnected &&
      ordered[index - 1]?.connected === false
    )
      reconnects += 1;
    if (event.connected) hasConnected = true;
  });
  const groups = new Map<string, Array<(typeof ordered)[number]>>();
  for (const event of [...ordered].reverse()) {
    const date = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(event.atMs));
    const group = groups.get(date) ?? [];
    group.push(event);
    groups.set(date, group);
  }
  const formatTime = (at: number) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(at));
  return (
    <details
      className="group mt-3 text-xs text-muted tabular-nums"
      data-review-connection-history
    >
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-[650] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <span className="flex items-center gap-1">
          Connection log
          <span className="inline-flex transition-transform group-open:rotate-90 [&>svg]:size-3.5">
            <Icon icon={CHEVRON_RIGHT_ICON} />
          </span>
        </span>
        <span
          className="rounded-full border border-edge px-1.5 py-px text-2xs font-bold leading-[1.2] uppercase tracking-caps text-muted"
          aria-label={`${ordered.length} event${ordered.length === 1 ? "" : "s"}`}
        >
          {ordered.length}
        </span>
      </summary>
      {ordered.length === 0 ? (
        <p className="mb-0">No connection events recorded yet.</p>
      ) : (
        <>
          <dl className="mt-3 mb-3 grid grid-cols-2 gap-x-3 gap-y-2 border-y border-edge py-3">
            <div className="min-w-0">
              <dt className="mb-0.5 text-2xs font-bold uppercase tracking-caps text-muted">
                State
              </dt>
              <dd
                className={
                  connected
                    ? "m-0 text-xs font-[750] text-[var(--diff-add-c)] [overflow-wrap:anywhere]"
                    : "m-0 text-xs font-[750] text-warning [overflow-wrap:anywhere]"
                }
              >
                {connected ? "CONNECTED" : "DISCONNECTED"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-0.5 text-2xs font-bold uppercase tracking-caps text-muted">
                Since
              </dt>
              <dd className="m-0 text-xs text-ink [overflow-wrap:anywhere]">
                {latest === undefined ? "Unavailable" : formatTime(latest.atMs)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-0.5 text-2xs font-bold uppercase tracking-caps text-muted">
                Last signal
              </dt>
              <dd className="m-0 text-xs text-ink [overflow-wrap:anywhere]">
                {relativeSignalLabel({ now: nowMs, at: heartbeatAt })}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="mb-0.5 text-2xs font-bold uppercase tracking-caps text-muted">
                Events
              </dt>
              <dd className="m-0 text-xs text-ink [overflow-wrap:anywhere]">
                {disconnects} disconnects · {reconnects} reconnects
              </dd>
            </div>
          </dl>
          {Array.from(groups).map(([date, rows]) => (
            <section key={date} className="[&+section]:mt-3">
              <h3 className="mt-0 mb-1.5 text-2xs font-bold uppercase tracking-caps text-muted">
                {date}
              </h3>
              <ol className="m-0 grid list-none gap-1 p-0">
                {rows.map((event) => {
                  const index = ordered.indexOf(event);
                  const next = ordered[index + 1];
                  const knownSession = ordered
                    .slice(0, index)
                    .some((candidate) => candidate.connected);
                  const prefix = event.connected
                    ? "Connected for "
                    : next?.connected
                      ? knownSession
                        ? "Reconnected after "
                        : "Connected after "
                      : "Offline for ";
                  const suffix =
                    !event.connected && next?.connected ? " offline" : "";
                  const duration = compactDurationLabel({
                    start: event.atMs,
                    end: next?.atMs ?? nowMs,
                  });
                  return (
                    <li
                      key={event.eventId ?? event.at}
                      className="relative grid min-w-0 grid-cols-[0.65rem_4.6rem_minmax(0,1fr)_auto] items-baseline gap-x-1.5 gap-y-0.5 py-2 leading-none first:pt-1 last:pb-0"
                      data-review-connection-event={
                        event.connected ? "connected" : "disconnected"
                      }
                      data-review-connection-current={
                        event === latest ? "" : undefined
                      }
                    >
                      <span
                        className={`relative size-[6px] self-center rounded-full border bg-paper ${event.connected ? "border-[var(--diff-add-c)] bg-[var(--diff-add-c)]" : event === latest ? "border-warning bg-warning" : "border-muted"}`}
                        data-review-connection-marker=""
                        aria-hidden="true"
                      />
                      <time className="text-2xs text-muted" dateTime={event.at}>
                        {formatTime(event.atMs)}
                      </time>
                      <strong
                        className={`min-w-0 text-xs ${event.connected ? "text-[var(--diff-add-c)]" : "text-ink"}`}
                      >
                        {event.connected ? "Connected" : "Disconnected"}
                      </strong>
                      {event === latest ? (
                        <span className="rounded-full border border-edge px-1.5 py-px text-2xs font-bold leading-[1.2] uppercase tracking-caps">
                          Current
                        </span>
                      ) : null}
                      <span
                        className="col-start-3 col-end-5 text-2xs text-muted"
                        data-review-connection-duration=""
                      >
                        {prefix}
                        {duration ?? "duration unavailable"}
                        {suffix}
                      </span>
                      {event.reason === undefined ? null : (
                        <span className="col-start-3 col-end-5 text-2xs text-warning">
                          {event.reason}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </>
      )}
    </details>
  );
};

export const AgentConnectionPanel = ({
  activity,
  presenceState,
  connected,
  heartbeatAt,
  modelName,
  connectionLog,
  recoveryPrompt,
  agentCommand,
  isReadOnly,
  replacementUrl,
  attentionKey,
  onViewRequest,
}: {
  readonly activity: CurrentAgentActivity;
  readonly presenceState: ReviewAgentProjection["state"];
  readonly connected: boolean;
  readonly heartbeatAt: number;
  readonly modelName?: string;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  readonly recoveryPrompt: string;
  readonly agentCommand: string;
  readonly isReadOnly: boolean;
  readonly replacementUrl: string | null;
  readonly attentionKey: number;
  readonly onViewRequest: (requestId: string, kind: string) => void;
}) => {
  const currentNowMs = useSecondClock();
  const presenceIsObservable = presenceState === "observable";
  const agentStatusIsAvailable =
    presenceIsObservable || presenceState === "agent-unavailable";
  const isConnected =
    presenceIsObservable &&
    connected &&
    activity.state !== "offline" &&
    activity.state !== "disconnected";
  return (
    <section className="min-w-0" aria-labelledby="agent-connection-heading">
      <h2
        id="agent-connection-heading"
        className="m-0 mb-3 text-sm font-bold text-ink"
      >
        Agent Connection
      </h2>
      {agentStatusIsAvailable ? (
        <>
          <ConnectionHealthCard
            connected={isConnected}
            heartbeatAt={heartbeatAt}
            nowMs={currentNowMs}
          />
          <section
            className="mt-4"
            aria-labelledby="agent-current-status-heading"
          >
            <h3
              id="agent-current-status-heading"
              className="m-0 mb-2 text-2xs font-bold uppercase tracking-caps text-muted"
            >
              Current status
            </h3>
            {isReadOnly ? (
              <ReadOnlySessionCard replacementUrl={replacementUrl} />
            ) : (
              <CurrentActivityCard
                activity={activity}
                modelName={isConnected ? modelName : undefined}
                nowMs={currentNowMs}
                attentionKey={attentionKey}
                onViewRequest={onViewRequest}
              />
            )}
          </section>
        </>
      ) : presenceState === "loading" ? (
        <AgentPresenceLoadingCard />
      ) : (
        <AgentPresenceUnavailableCard />
      )}
      <AnotherViewTip />
      {isReadOnly || isConnected || !agentStatusIsAvailable ? null : (
        <details className="group mt-3 rounded-md border border-edge text-xs text-muted">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className="inline-flex transition-transform group-open:rotate-90 [&>svg]:size-3.5">
              <Icon icon={CHEVRON_RIGHT_ICON} />
            </span>
            Re-connect your session
          </summary>
          <div className="grid gap-2 border-t border-edge px-3 py-3">
            <p className="m-0">
              To reconnect this running review, paste this exact prompt into
              your coding agent:
            </p>
            <CopyBlock
              value={
                recoveryPrompt ||
                "Ask your coding agent to reconnect to this Big Plan review and keep its feedback loop running."
              }
              label="recovery prompt"
            />
            <p className="m-0">
              Or run this exact connector command yourself from the Big Plan
              repository:
            </p>
            <CopyBlock value={agentCommand} label="connector command" />
          </div>
        </details>
      )}
      {isReadOnly || !agentStatusIsAvailable ? null : (
        <ConnectionLog
          connected={isConnected}
          heartbeatAt={heartbeatAt}
          events={connectionLog}
          nowMs={currentNowMs}
        />
      )}
    </section>
  );
};
