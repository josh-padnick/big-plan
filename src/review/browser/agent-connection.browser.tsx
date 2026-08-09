// Renders the legacy agent-health surface from truthful runtime facts. The
// review kernel owns polling and navigation; this module owns only the visual
// projection and local disclosure/copy interactions.

import { useState } from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { COPY_ICON } from "../../icons/lucide/copy.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import type { CurrentAgentActivity } from "../agent-activity.js";
import { compactDurationLabel, relativeSignalLabel } from "../time-label.js";
import { Icon } from "./icon.browser.js";

export type BrowserConnectionEvent = {
  readonly eventId?: string;
  readonly connected: boolean;
  readonly at: string;
  readonly reason?: string;
};

const Spinner = () => (
  <span
    className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
    aria-hidden="true"
  />
);

export const AgentHealthAlert = ({
  label,
  onOpen,
}: {
  readonly label: string;
  readonly onOpen: () => void;
}) => (
  <button
    type="button"
    className="inline-flex min-h-[1.875rem] cursor-pointer items-center gap-1.5 rounded-md border border-danger bg-[var(--callout-danger-bg)] px-2 py-1 text-xs font-semibold text-danger shadow-raised hover:shadow-lifted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:inset-shadow-pressed [&>svg]:size-4"
    aria-label={`${label} — open agent connection status`}
    onClick={onOpen}
  >
    <Icon icon={TRIANGLE_ALERT_ICON} />
    {label}
  </button>
);

const CopyBlock = ({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <div className="relative min-w-0">
      <pre className="m-0 min-w-0 overflow-x-auto rounded-md border border-edge bg-surface p-3 pr-12 font-mono text-xs whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
        <code>{value}</code>
      </pre>
      <button
        type="button"
        className="absolute top-2 right-2 inline-flex cursor-pointer items-center gap-1 rounded-sm border border-edge bg-surface px-1.5 py-1 text-2xs text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&>svg]:size-3"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        onClick={() => void copy()}
      >
        <Icon icon={copied ? CHECK_ICON : COPY_ICON} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
};

const activityTone = (tone: CurrentAgentActivity["tone"]): string =>
  tone === "working"
    ? "border-[var(--callout-note-c)] bg-[var(--callout-note-bg)] text-[var(--callout-note-c)]"
    : tone === "warning"
      ? "border-[var(--callout-warning-c)] bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]"
      : tone === "danger"
        ? "border-[var(--callout-danger-c)] bg-[var(--callout-danger-bg)] text-[var(--callout-danger-c)]"
        : "border-edge bg-surface text-muted";

const CurrentActivityCard = ({
  activity,
  nowMs,
  onViewRequest,
}: {
  readonly activity: CurrentAgentActivity;
  readonly nowMs: number;
  readonly onViewRequest: (requestId: string, kind: string) => void;
}) => {
  const body =
    activity.state === "working" ? activity.latestStep : activity.supporting;
  return (
    <article
      className={`grid min-w-0 gap-2 rounded-lg border p-3 text-xs ${activityTone(activity.tone)}`}
      data-review-current-activity={activity.state}
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
        <strong className="min-w-0 flex-1 text-sm text-ink">
          {activity.headline}
        </strong>
        <span className="rounded-full bg-[color-mix(in_srgb,currentColor_10%,transparent)] px-2 py-0.5 text-2xs font-bold uppercase tracking-caps">
          {activity.state === "stalled" ? "warning" : activity.state}
        </span>
      </div>
      {"targetLabel" in activity && activity.targetLabel !== undefined ? (
        <strong className="text-2xs uppercase tracking-caps text-ink">
          {activity.targetLabel}
        </strong>
      ) : null}
      <p className="m-0 text-ink [overflow-wrap:anywhere]">{body}</p>
      <div className="flex min-w-0 items-center gap-2 border-t border-current/20 pt-2 text-2xs">
        <span className="text-muted">
          {"updatedAtMs" in activity
            ? `Updated ${relativeSignalLabel({ now: nowMs, at: activity.updatedAtMs })}`
            : activity.state === "idle"
              ? "No unanswered requests"
              : "Current queue state"}
        </span>
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
    </article>
  );
};

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
    <details className="mt-3 text-xs text-muted" data-review-connection-history>
      <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-edge pb-2 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        Connection log
        <span className="ml-auto rounded-full border border-edge px-1.5 py-0.5 text-2xs font-bold text-muted">
          {ordered.length}
        </span>
      </summary>
      {ordered.length === 0 ? (
        <p className="mb-0">No connection events recorded yet.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 border-b border-edge py-3">
            <div>
              <dt className="text-2xs font-bold uppercase tracking-caps text-subtle">
                State
              </dt>
              <dd
                className={
                  connected
                    ? "m-0 mt-1 font-semibold text-accent"
                    : "m-0 mt-1 font-semibold text-warning"
                }
              >
                {connected ? "CONNECTED" : "DISCONNECTED"}
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-bold uppercase tracking-caps text-subtle">
                Since
              </dt>
              <dd className="m-0 mt-1 text-ink">
                {latest === undefined ? "Unavailable" : formatTime(latest.atMs)}
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-bold uppercase tracking-caps text-subtle">
                Last signal
              </dt>
              <dd className="m-0 mt-1 text-ink">
                {relativeSignalLabel({ now: nowMs, at: heartbeatAt })}
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-bold uppercase tracking-caps text-subtle">
                Events
              </dt>
              <dd className="m-0 mt-1 text-ink">
                {disconnects} disconnects · {reconnects} reconnects
              </dd>
            </div>
          </dl>
          {Array.from(groups).map(([date, rows]) => (
            <section key={date} className="mt-3">
              <h3 className="m-0 text-2xs font-bold uppercase tracking-caps text-subtle">
                {date}
              </h3>
              <ol className="m-0 mt-2 grid list-none gap-2 p-0">
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
                      className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1"
                    >
                      <span
                        className="size-1.5 rounded-full border border-muted"
                        aria-hidden="true"
                      />
                      <time dateTime={event.at}>{formatTime(event.atMs)}</time>
                      <strong
                        className={event.connected ? "text-accent" : "text-ink"}
                      >
                        {event.connected ? "Connected" : "Disconnected"}
                      </strong>
                      {event === latest ? (
                        <span className="rounded-full border border-edge px-1.5 text-2xs font-bold uppercase tracking-caps">
                          Current
                        </span>
                      ) : null}
                      <span className="col-start-3 col-end-5 text-2xs text-muted">
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
  connected,
  heartbeatAt,
  connectionLog,
  recoveryPrompt,
  agentCommand,
  nowMs,
  onViewRequest,
}: {
  readonly activity: CurrentAgentActivity;
  readonly connected: boolean;
  readonly heartbeatAt: number;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  readonly recoveryPrompt: string;
  readonly agentCommand: string;
  readonly nowMs: number;
  readonly onViewRequest: (requestId: string, kind: string) => void;
}) => (
  <div className="grid content-start gap-3">
    <section>
      <p className="m-0 mb-2 text-2xs font-bold uppercase tracking-caps text-subtle">
        Current activity
      </p>
      <CurrentActivityCard
        activity={activity}
        nowMs={nowMs}
        onViewRequest={onViewRequest}
      />
    </section>
    <section className="grid gap-3 rounded-lg border border-edge p-3 text-xs text-muted">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`size-2 shrink-0 rounded-full border-2 border-edge ${connected ? "bg-accent" : "bg-muted"}`}
          aria-hidden="true"
        />
        <strong className="text-ink">
          {connected ? "Agent session connected" : "Agent session disconnected"}
        </strong>
        {heartbeatAt > 0 ? (
          <span className="ml-auto">
            Last signal {relativeSignalLabel({ now: nowMs, at: heartbeatAt })}
          </span>
        ) : null}
      </div>
      {connected ? null : (
        <>
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
        </>
      )}
    </section>
    <ConnectionLog
      connected={connected}
      heartbeatAt={heartbeatAt}
      events={connectionLog}
      nowMs={nowMs}
    />
  </div>
);
