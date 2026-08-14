// Renders the agent sidebar's body from truthful runtime facts. The review
// kernel owns polling and navigation; this module owns only the visual
// projection and local disclosure/copy interactions.
//
// Reading order is a function of state, because the next action differs by
// state: connection health always leads, then whichever of reconnecting or
// checking the agent is actually the right move.

import { useEffect, useState } from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { COPY_ICON } from "../../icons/lucide/copy.js";
import { TERMINAL_ICON } from "../../icons/lucide/terminal.js";
import type {
  AgentHealth,
  AgentHealthIndicator,
  CurrentAgentActivity,
} from "../shared/agent-status.js";
import type { BrowserConnectionEvent } from "../shared/review-wire.js";
import {
  compactDurationLabel,
  relativeSignalLabel,
} from "../shared/time-label.js";
import { AgentStatusGlyph } from "./agent-status.browser.js";
import { Icon } from "./icon.browser.js";
import type { ReviewAgentProjection } from "./review-poll-health.js";

const Spinner = () => (
  <span
    className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
    aria-hidden="true"
  />
);

// Keep human-readable elapsed time independent from the slower network poll.
// This component exists only while the agent sidebar is mounted, so the local
// tick cannot make the rest of the review workspace rerender every second.
const useSecondClock = (): number => {
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return nowMs;
};

// Nothing on this page can restore a superseded session, so this card states
// what happened and offers the one route out, and nothing else.
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
      <AgentStatusGlyph indicator="warning" />
      <strong className="min-w-0 flex-1 text-sm text-ink">
        This review session is no longer valid
      </strong>
    </div>
    <p className="m-0 text-ink [overflow-wrap:anywhere]">
      A newer review session is active for this plan, so this plan is{" "}
      <strong className="text-ink">read-only</strong>. It stays safe to read,
      but it can no longer make changes.
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
          Open the latest review →
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
  // The control floats in the payload's own corner rather than being absolutely
  // positioned over it. A float reserves exactly its own width on exactly the
  // lines it covers, so no line runs underneath it at sidebar width and no
  // fixed padding has to be guessed against a label that changes with state.
  // It is unselectable so copying the payload by hand never picks it up.
  return (
    <pre className="m-0 min-w-0 overflow-x-auto rounded-md border border-edge bg-surface p-3 font-mono text-xs whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
      <button
        type="button"
        className="float-right mb-1 ml-2 inline-flex cursor-pointer items-center gap-1 rounded-sm border border-edge bg-surface px-1.5 py-1 font-sans text-2xs text-muted select-none hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&>svg]:size-3"
        aria-label={buttonLabel}
        onClick={() => void copy()}
      >
        <Icon icon={copied ? CHECK_ICON : COPY_ICON} />
        {failed ? "Copy failed" : copied ? "Copied" : "Copy"}
      </button>
      <code>{value}</code>
    </pre>
  );
};

// Current status is something a reviewer reads, not something they act on, so
// it is plain sidebar content. Only Reconnect and See all agent activity keep
// card chrome, because those are the actions available here.
const CurrentActivityBlock = ({
  activity,
  nowMs,
  onViewRequest,
}: {
  readonly activity: CurrentAgentActivity;
  readonly nowMs: number;
  readonly onViewRequest: (requestId: string, kind: string) => void;
}) => {
  // Health above already states the connection, so this block leads with the
  // work instead of repeating it. An idle agent has no work to describe, so it
  // says only that, rather than restating "connected" a third time.
  const title =
    activity.state === "idle" ? "Waiting for feedback" : activity.headline;
  const body =
    activity.state === "working"
      ? activity.latestStep
      : activity.state === "idle"
        ? ""
        : activity.supporting;
  const secondary =
    activity.state !== "disconnected" && "targetLabel" in activity
      ? (activity.targetLabel ?? "")
      : "";
  const footerLabel =
    "updatedAtMs" in activity
      ? `Updated ${relativeSignalLabel({ now: nowMs, at: activity.updatedAtMs })}`
      : activity.state === "idle"
        ? "No unanswered requests"
        : null;
  return (
    <div
      className="grid min-w-0 gap-2 text-xs leading-[1.45] text-muted"
      data-review-current-activity={activity.state}
    >
      <div className="flex min-w-0 items-center gap-2">
        {activity.state === "working" ? <Spinner /> : null}
        <strong className="min-w-0 flex-1 text-sm text-ink">{title}</strong>
      </div>
      {secondary === "" ? null : (
        <strong className="text-2xs uppercase tracking-caps text-ink">
          {secondary}
        </strong>
      )}
      {body === "" ? null : (
        <p className="m-0 text-ink [overflow-wrap:anywhere]">{body}</p>
      )}
      {footerLabel !== null || "requestId" in activity ? (
        <div className="flex min-w-0 items-center gap-2 text-2xs">
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
    </div>
  );
};

// Every tone is a complete static class string, so each Tailwind candidate
// stays discoverable in source rather than being assembled at runtime.
const HEALTH_CARD_TONE: Record<AgentHealthIndicator, string> = {
  healthy:
    "border-[var(--diff-add-c)] bg-[var(--diff-add-bg)] text-[var(--diff-add-c)]",
  warning:
    "border-[var(--callout-warning-c)] bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]",
  error:
    "border-[var(--callout-danger-c)] bg-[var(--callout-danger-bg)] text-[var(--callout-danger-c)]",
  unavailable: "border-edge bg-raised text-muted",
};

// Connection health leads the sidebar in every state, because it is the fact
// that decides which action below it is the right one.
const ConnectionHealthCard = ({
  status,
  heartbeatAt,
  nowMs,
}: {
  readonly status: AgentHealth;
  readonly heartbeatAt: number;
  readonly nowMs: number;
}) => (
  <article
    className={`grid min-w-0 gap-2 rounded-lg border p-3 text-xs leading-[1.45] ${HEALTH_CARD_TONE[status.indicator]}`}
    data-review-connection-health={status.indicator}
  >
    <div className="flex min-w-0 items-center gap-2">
      <AgentStatusGlyph indicator={status.indicator} />
      <strong className="min-w-0 flex-1 text-sm text-ink">
        {status.label}
      </strong>
    </div>
    <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 border-t border-current/20 pt-2">
      <div className="min-w-0">
        <dt className="text-2xs font-bold uppercase tracking-caps opacity-80">
          Connection
        </dt>
        <dd className="m-0 text-ink">
          {status.indicator === "healthy" ? "Healthy" : "Unavailable"}
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

// Going to the agent itself is an action, so this keeps card chrome. When the
// agent has gone quiet it is also the right first move, so the panel orders it
// above Reconnect rather than changing what it says.
const AgentActivityCard = () => (
  <article className="flex min-w-0 gap-2 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-muted">
    <span className="inline-flex size-6 shrink-0 items-center justify-center self-start rounded-sm border border-edge text-ink [&>svg]:size-3.5">
      <Icon icon={TERMINAL_ICON} />
    </span>
    <p className="m-0 min-w-0 [overflow-wrap:anywhere]">
      <strong className="text-ink">See all agent activity</strong> by going to
      the agent directly - open the terminal or chat session it is running in to
      watch what it is doing. This does not restore the review connection.
    </p>
  </article>
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
      className="group text-xs text-muted tabular-nums"
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

// Reconnecting is the task when the agent is gone, so the payload is open on
// arrival; when the agent is merely quiet it is the wrong first move, so it
// stays a closed disclosure ranked below checking the agent.
const ReconnectCard = ({
  recoveryPrompt,
  agentCommand,
  isPrimary,
}: {
  readonly recoveryPrompt: string;
  readonly agentCommand: string;
  readonly isPrimary: boolean;
}) => (
  <details
    className="group rounded-md border border-edge text-xs text-muted"
    open={isPrimary}
    data-review-reconnect={isPrimary ? "primary" : "secondary"}
  >
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-semibold text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <span className="inline-flex transition-transform group-open:rotate-90 [&>svg]:size-3.5">
        <Icon icon={CHEVRON_RIGHT_ICON} />
      </span>
      Reconnect your agent
    </summary>
    <div className="grid gap-2 border-t border-edge px-3 py-3">
      {isPrimary ? null : (
        <p className="m-0">
          Only if checking the agent shows it has really stopped. Reconnecting
          an agent that is still working interrupts it.
        </p>
      )}
      <p className="m-0">
        To reconnect this running review, paste this exact prompt into your
        coding agent:
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
);

export const AgentConnectionPanel = ({
  activity,
  status,
  presenceState,
  connected,
  heartbeatAt,
  connectionLog,
  recoveryPrompt,
  agentCommand,
  isReadOnly,
  replacementUrl,
  onViewRequest,
}: {
  readonly activity: CurrentAgentActivity;
  readonly status: AgentHealth;
  readonly presenceState: ReviewAgentProjection["state"];
  readonly connected: boolean;
  readonly heartbeatAt: number;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  readonly recoveryPrompt: string;
  readonly agentCommand: string;
  readonly isReadOnly: boolean;
  readonly replacementUrl: string | null;
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
  // A superseded session cannot be repaired from this page, so it shows what
  // happened and the one route out, and never a reconnect prompt or a log.
  if (isReadOnly) {
    return (
      <div className="grid min-w-0 gap-3">
        <ReadOnlySessionCard replacementUrl={replacementUrl} />
      </div>
    );
  }
  if (!agentStatusIsAvailable) {
    return (
      <div className="grid min-w-0 gap-3">
        {presenceState === "loading" ? (
          <AgentPresenceLoadingCard />
        ) : (
          <AgentPresenceUnavailableCard />
        )}
        <AgentActivityCard />
      </div>
    );
  }
  const reconnect = isConnected ? null : (
    <ReconnectCard
      recoveryPrompt={recoveryPrompt}
      agentCommand={agentCommand}
      isPrimary={status.indicator === "error"}
    />
  );
  return (
    <div className="grid min-w-0 gap-3">
      <ConnectionHealthCard
        status={status}
        heartbeatAt={heartbeatAt}
        nowMs={currentNowMs}
      />
      <section aria-labelledby="agent-current-status-heading">
        <h3
          id="agent-current-status-heading"
          className="m-0 mb-2 text-2xs font-bold uppercase tracking-caps text-muted"
        >
          Current status
        </h3>
        <CurrentActivityBlock
          activity={activity}
          nowMs={currentNowMs}
          onViewRequest={onViewRequest}
        />
      </section>
      {status.indicator === "error" ? (
        <>
          {reconnect}
          <AgentActivityCard />
        </>
      ) : (
        <>
          <AgentActivityCard />
          {reconnect}
        </>
      )}
      <ConnectionLog
        connected={isConnected}
        heartbeatAt={heartbeatAt}
        events={connectionLog}
        nowMs={currentNowMs}
      />
    </div>
  );
};
