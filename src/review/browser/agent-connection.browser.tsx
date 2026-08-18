// Renders the legacy agent-health surface from truthful runtime facts. The
// review kernel owns polling and navigation; this module owns only the visual
// projection and local disclosure/copy interactions.

import { Fragment, useEffect, useState } from "react";
import type { BrandIcon } from "../../icons/brand-icon.js";
import { CLAUDE_ICON } from "../../icons/brands/claude.js";
import { GROK_ICON } from "../../icons/brands/grok.js";
import { MISTRAL_ICON } from "../../icons/brands/mistral.js";
import { OPENAI_ICON } from "../../icons/brands/openai.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { COPY_ICON } from "../../icons/lucide/copy.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { LIGHTBULB_ICON } from "../../icons/lucide/lightbulb.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import {
  agentClientDisplayName,
  agentModelDisplayName,
  agentModelVendor,
  type AgentModelVendor,
} from "../shared/agent-identity-catalog.js";
import { agentSessionAffordance } from "../shared/agent-session-link.js";
import {
  AGENT_SESSION_ENDED_REASON,
  agentHasEverConnected,
} from "../shared/agent-status.js";
import type {
  AgentHealth,
  AgentHealthIndicator,
  CurrentAgentActivity,
  HeldWorkQuiet,
} from "../shared/agent-status.js";
import type { BrowserConnectionEvent } from "../shared/review-wire.js";
import {
  compactDurationLabel,
  relativeSignalLabel,
} from "../shared/time-label.js";
import { BrandIconView, Icon } from "./icon.browser.js";
import type { ReviewAgentProjection } from "./review-poll-health.js";
import { Badge, WorkingMark } from "./ui.browser.js";

const VENDOR_ICONS: Record<AgentModelVendor, BrandIcon> = {
  openai: OPENAI_ICON,
  claude: CLAUDE_ICON,
  grok: GROK_ICON,
  mistral: MISTRAL_ICON,
};

/**
 * Draws the reported model's own mark, or nothing at all.
 *
 * A model the catalog has no faithful mark for shows its name alone. The
 * generic robot that used to stand in was a placeholder in the literal sense:
 * it occupied the space a mark would occupy while identifying nobody.
 */
const ModelIcon = ({ modelName }: { readonly modelName: string }) => {
  const vendor = agentModelVendor(modelName);
  return vendor === undefined ? null : (
    <BrandIconView icon={VENDOR_ICONS[vendor]} />
  );
};

// Keep human-readable elapsed time independent from the slower network poll.
// This component exists only while the Agent tab is mounted, so the local
// tick cannot make the rest of the review workspace rerender every second.
// The comment glyph that heads the subject block; it names what the block is
// about, so it travels with the label rather than being set at each call.
const SubjectMark = () => (
  <span
    className="inline-flex shrink-0 items-center [&>svg]:size-3.5"
    aria-hidden="true"
  >
    <Icon icon={MESSAGE_SQUARE_ICON} />
  </span>
);

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
      <span className="rounded-full bg-[color-mix(in_srgb,currentColor_10%,transparent)] px-2 py-0.5 text-2xs font-semibold">
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

/*
Copying one string, with the outcome shown on the control that did it.

Three surfaces need this now - the recovery payload, a session identifier that
cannot be linked, and the session id in the details - and each needs the same
three states and the same failure wording. The behaviour lives here; the shape
of the control is the caller's.
*/
const useCopyToClipboard = (value: string) => {
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
  return { copied, failed, copy };
};

/** Names a copy control by what it does and what just happened. */
const copyControlLabel = ({
  label,
  copied,
  failed,
}: {
  readonly label: string;
  readonly copied: boolean;
  readonly failed: boolean;
}): string =>
  failed
    ? "Copy failed — select and copy manually"
    : copied
      ? `${label} copied`
      : `Copy ${label}`;

/** A bare copy control, for a value already shown beside it. */
const CopyIdentifierControl = ({ value }: { readonly value: string }) => {
  const { copied, failed, copy } = useCopyToClipboard(value);
  return (
    <button
      type="button"
      className="inline-flex shrink-0 cursor-pointer items-center rounded-sm border-0 bg-transparent p-0 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&>svg]:size-3"
      aria-label={copyControlLabel({
        label: "agent session identifier",
        copied,
        failed,
      })}
      data-review-agent-session-copy={value}
      onClick={() => void copy()}
    >
      <Icon icon={copied ? CHECK_ICON : COPY_ICON} />
    </button>
  );
};

const CopyBlock = ({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}) => {
  const { copied, failed, copy } = useCopyToClipboard(value);
  const buttonLabel = copyControlLabel({ label, copied, failed });
  // The control floats in the payload's own corner rather than being absolutely
  // positioned over it. A float reserves exactly its own width on exactly the
  // lines it covers, so no line runs underneath it at sidebar width and no
  // fixed padding has to be guessed against a label that changes with state.
  // It is unselectable so copying the payload by hand never picks it up.
  //
  // The payload itself takes the floor of the scale, at the captain's
  // measurement: it is copied far more often than it is read, and the step
  // exists for exactly this.
  return (
    <pre className="m-0 min-w-0 overflow-x-auto rounded-md border border-edge bg-surface p-3 font-mono text-3xs whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
      <button
        type="button"
        className="float-right mb-1 ml-2 inline-flex cursor-pointer items-center justify-center gap-1 rounded-sm border border-edge bg-surface px-1.5 py-1 font-sans text-2xs text-muted select-none hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&>svg]:size-3"
        aria-label={buttonLabel}
        onClick={() => void copy()}
      >
        <Icon icon={copied ? CHECK_ICON : COPY_ICON} />
        {/*
        The label changes under the reader's cursor, and the control is floated
        into the payload, so a label that grows reflows the text it sits in -
        the line breaks move at the moment of a successful copy, which reads as
        the page reacting badly to being used. The widest label is rendered
        once, invisibly and unclickably, to hold the width; the visible label is
        stacked on top of it. Reserving the width in the layout is what makes
        this stable across fonts rather than a guess in pixels.
        */}
        <span className="grid">
          <span
            className="invisible col-start-1 row-start-1"
            aria-hidden="true"
          >
            Copy failed
          </span>
          <span className="col-start-1 row-start-1">
            {failed ? "Copy failed" : copied ? "Copied" : "Copy"}
          </span>
        </span>
      </button>
      <code>{value}</code>
    </pre>
  );
};

const STATUS_CARD_TONE: Record<AgentHealthIndicator, string> = {
  healthy:
    "border-[var(--diff-add-c)] bg-[var(--diff-add-bg)] text-[var(--diff-add-c)]",
  working:
    "border-[var(--diff-add-c)] bg-[var(--diff-add-bg)] text-[var(--diff-add-c)]",
  warning:
    "border-[var(--callout-warning-c)] bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]",
  error:
    "border-[var(--callout-danger-c)] bg-[var(--callout-danger-bg)] text-[var(--callout-danger-c)]",
  unavailable: "border-edge bg-raised text-muted",
};

/** The wall-clock time the log prints beside each event. */
const formatClockTime = (atMs: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(atMs));

/**
 * The connection facts worth stating beside the status: when this connection
 * started and how long it has held, plus how unstable it has been. "Last
 * signal" is deliberately absent - on a live connection it always says "just
 * now", which tells a reviewer nothing they cannot already see.
 */
export const summarizeAgentConnection = ({
  events,
}: {
  readonly events: ReadonlyArray<BrowserConnectionEvent>;
}): {
  readonly everConnected: boolean;
  readonly sinceAtMs: number | undefined;
  readonly quietPeriods: number;
  readonly resumed: number;
} => {
  const ordered = events
    .map((event) => ({ ...event, atMs: Date.parse(event.at) }))
    .filter((event) => Number.isFinite(event.atMs))
    .sort((left, right) => left.atMs - right.atMs);
  // A gap in the signal is a quiet period, not an observed disconnection. The
  // runtime records an edge whenever the heartbeat ages out, and nothing renews
  // it while a turn runs, so counting these as disconnects and reconnects put
  // events in the reviewer's log that never happened (BIG-147).
  let quietPeriods = 0;
  let resumed = 0;
  let hasConnected = false;
  ordered.forEach((event, index) => {
    if (!event.connected && ordered[index - 1]?.connected) quietPeriods += 1;
    if (
      event.connected &&
      hasConnected &&
      ordered[index - 1]?.connected === false
    )
      resumed += 1;
    if (event.connected) hasConnected = true;
  });
  // The current run started at the last transition into the present state.
  const latest = ordered.at(-1);
  return {
    everConnected: agentHasEverConnected({ events }),
    sinceAtMs: latest === undefined ? undefined : latest.atMs,
    quietPeriods,
    resumed,
  };
};

const CurrentActivityCard = ({
  activity,
  status,
  modelName,
  modelEffort,
  modelClient,
  sessionUrl,
  sessionId,
  connection,
  nowMs,
  onViewRequest,
}: {
  readonly activity: CurrentAgentActivity;
  readonly status: AgentHealth;
  readonly modelName?: string;
  readonly modelEffort?: string;
  readonly modelClient?: string;
  readonly sessionUrl?: string;
  readonly sessionId?: string;
  readonly connection: ReturnType<typeof summarizeAgentConnection>;
  readonly nowMs: number;
  readonly onViewRequest: (requestId: string, kind: string) => void;
}) => {
  const body =
    activity.state === "working" ? activity.latestStep : activity.supporting;
  // A live connection is the fact a reviewer checks this card for; what the
  // agent happens to be doing is the detail underneath it. Only the working
  // state buries the connection behind the activity, so only it is retitled.
  const title = activity.state === "working" ? status.label : activity.headline;
  const targetLabel =
    activity.state !== "disconnected" &&
    activity.state !== "never-connected" &&
    "targetLabel" in activity
      ? activity.targetLabel
      : undefined;
  // What the agent is doing and which thread it is doing it to are two facts,
  // not one label. Joining them put a thread name in a section-title face and
  // read as though the status itself were called "start here, disconnected".
  const workHeadline =
    activity.state === "working" ? activity.headline : undefined;
  // The subject of the work is the thing to click, so it is derived once here
  // rather than assembled in the markup: a thread name when there is one, the
  // work itself when there is not, and nothing needs a separate link.
  const subjectLabel =
    targetLabel !== undefined && targetLabel !== ""
      ? targetLabel
      : activity.state === "working"
        ? workHeadline
        : undefined;
  // Whether there is an agent for an identity to belong to. A session with none
  // has nothing to report and no gap to explain.
  // "Since" alone made the reader carry the card's state down to the row and
  // apply it themselves. The label states it.
  const sinceLabel =
    activity.state === "disconnected"
      ? "Disconnected since"
      : activity.state === "offline"
        ? "Unreachable since"
        : "Connected since";
  /*
  What the connector said about itself, in the order a reader asks it: which
  tool, which model, how hard it was told to think. Each segment is independent,
  because each is declared independently, and the catalog decides how a declared
  id is written - never this component, and never by re-casing what it was
  handed.
  */
  const identitySegments = [
    modelClient === undefined
      ? undefined
      : { key: "client", text: agentClientDisplayName(modelClient) },
    modelName === undefined
      ? undefined
      : { key: "model", text: agentModelDisplayName(modelName) },
    modelEffort === undefined
      ? undefined
      : { key: "effort", text: modelEffort },
  ].filter((segment) => segment !== undefined);
  const sessionAffordance = agentSessionAffordance({
    ...(sessionUrl === undefined ? {} : { sessionUrl }),
    ...(sessionId === undefined ? {} : { sessionId }),
  });
  // Since and Events describe a connection at rest; the session identifies the
  // agent whatever it is doing. The working card carries the second without the
  // first, and every other state carries both.
  const showsSinceAndEvents =
    activity.state !== "working" &&
    connection.sinceAtMs !== undefined &&
    connection.everConnected;
  const showsConnectionFacts =
    showsSinceAndEvents || sessionAffordance.kind === "identifier";
  const requestId = "requestId" in activity ? activity.requestId : undefined;
  const requestKind = "requestId" in activity ? activity.requestKind : "";
  const footerLabel =
    "updatedAtMs" in activity
      ? `Updated ${relativeSignalLabel({ now: nowMs, at: activity.updatedAtMs })}`
      : activity.state === "idle"
        ? "No unanswered requests"
        : null;
  return (
    <article
      className={`grid min-w-0 gap-1.5 rounded-lg border p-3 text-xs leading-[1.45] ${STATUS_CARD_TONE[status.indicator]}`}
      data-review-current-activity={activity.state}
    >
      {/* Six pixels rather than eight: the mark is round and the title starts
          with a letter, so the measured gap reads wider than it is. */}
      <div className="flex min-w-0 items-center gap-1.5">
        {activity.state === "working" ? (
          /* Sized to the mark the thread chips show, so the card's heading does
             not say the same thing more quietly than a chip does. */
          <WorkingMark className="size-3" />
        ) : null}
        <strong className="min-w-0 flex-1 text-sm text-ink">{title}</strong>
      </div>
      {/*
      Identity is shown only where it exists, segment by segment. A session that
      declared nothing renders nothing here: a line saying so would occupy the
      space an answer occupies while carrying none, and the reader who wants to
      know which agent this is learns more from the absence than from being told
      about it.
      */}
      {identitySegments.length === 0 ? null : (
        <span
          className="inline-flex w-fit min-w-0 max-w-full items-center gap-1.5 rounded-full border border-current/20 bg-[color-mix(in_srgb,currentColor_8%,transparent)] px-2 py-0.5 text-2xs font-semibold text-ink [&>svg]:size-3"
          {...(modelName === undefined
            ? {}
            : { "data-review-agent-model": modelName })}
          {...(modelEffort === undefined
            ? {}
            : { "data-review-agent-effort": modelEffort })}
          {...(modelClient === undefined
            ? {}
            : { "data-review-agent-client": modelClient })}
        >
          {modelName === undefined ? null : <ModelIcon modelName={modelName} />}
          {identitySegments.map((segment, index) => (
            <Fragment key={segment.key}>
              {index === 0 ? null : (
                /* The separator carries its own even spacing rather than
                   inheriting the row's gap on one side only. */
                <span aria-hidden="true" className="shrink-0 opacity-50">
                  ·
                </span>
              )}
              <span
                className={
                  segment.key === "effort"
                    ? "shrink-0 font-normal text-muted"
                    : "min-w-0 truncate"
                }
              >
                {segment.text}
              </span>
            </Fragment>
          ))}
        </span>
      )}
      {/*
      A link only where one can actually be followed. Big Plan decides that from
      the interfaces it knows, not from the declaration: an address it cannot
      place is offered as a string to copy, which is useful in whatever tool it
      belongs to and never sends the reader nowhere.
      */}
      {sessionAffordance.kind === "link" ? (
        <a
          className="inline-flex w-fit items-center gap-1 text-2xs font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          href={sessionAffordance.href}
          target="_blank"
          rel="noreferrer noopener"
          data-review-agent-session-url={sessionAffordance.href}
          data-review-agent-session-interface={sessionAffordance.interfaceId}
        >
          Open the agent's chat
        </a>
      ) : null}
      {workHeadline === undefined || subjectLabel === undefined ? null : (
        <p className="m-0 text-ink [overflow-wrap:anywhere]">{workHeadline}</p>
      )}
      {subjectLabel === undefined ? (
        <p className="m-0 text-ink [overflow-wrap:anywhere]">{body}</p>
      ) : (
        /* The request is a thing inside the card rather than another paragraph
           of it: one border, one step of ground away from the card it sits in,
           and no rule above, which would draw the same separation twice. */
        <div
          className="grid min-w-0 gap-1 rounded-md border border-current/25 bg-[color-mix(in_srgb,currentColor_6%,transparent)] p-2"
          data-review-agent-target={targetLabel ?? subjectLabel}
        >
          {requestId === undefined ? (
            <p className="m-0 flex min-w-0 items-center gap-1.5 font-semibold text-ink">
              <SubjectMark />
              <span className="min-w-0 truncate">{subjectLabel}</span>
            </p>
          ) : (
            <button
              type="button"
              className="flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left font-semibold text-ink hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => onViewRequest(requestId, requestKind)}
            >
              <SubjectMark />
              <span className="min-w-0 truncate">{subjectLabel}</span>
            </button>
          )}
          <p className="m-0 text-muted [overflow-wrap:anywhere]">{body}</p>
        </div>
      )}
      {/*
      The facts about the connection, under the card's first rule in every
      state. A working card carries only the session: how long the agent has
      been connected and how often the signal has lapsed are questions about a
      connection at rest, and asking them beside live work reads as doubt about
      work that is visibly happening.
      */}
      {showsConnectionFacts ? (
        <dl className="m-0 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 border-t border-current/20 pt-1.5 text-2xs">
          {showsSinceAndEvents && connection.sinceAtMs !== undefined ? (
            <div className="min-w-0">
              {/* The label says which transition the time belongs to, so the
                  row reads as a sentence about this state rather than as a
                  field whose meaning the reader has to infer from the card. */}
              <dt className="font-semibold">{sinceLabel}</dt>
              <dd className="m-0 text-ink [overflow-wrap:anywhere]">
                {formatClockTime(connection.sinceAtMs)}
                {" ("}
                {compactDurationLabel({
                  start: connection.sinceAtMs,
                  end: Math.max(nowMs, connection.sinceAtMs),
                }) ?? "just now"}
                {")"}
              </dd>
            </div>
          ) : null}
          {sessionAffordance.kind === "identifier" ? (
            /* The one place a session identifier is offered. It cannot be
               followed, so it belongs with the facts a reader consults rather
               than beside the state they are reading - and having it here is
               what lets the card above it carry no copy control at all. */
            <div className="min-w-0">
              <dt className="font-semibold">Agent session</dt>
              <dd className="m-0 flex min-w-0 items-center gap-1 text-ink">
                <span
                  className="min-w-0 truncate"
                  data-review-agent-session-id={sessionAffordance.value}
                >
                  {sessionAffordance.value}
                </span>
                {/* The row truncates because the identifier is long and not for
                    reading; the control hands over the whole of it. */}
                <CopyIdentifierControl value={sessionAffordance.value} />
              </dd>
            </div>
          ) : null}
          {showsSinceAndEvents ? (
            <div className="min-w-0">
              <dt className="font-semibold">Events</dt>
              <dd className="m-0 grid text-ink [overflow-wrap:anywhere]">
                <span>
                  {connection.quietPeriods} quiet{" "}
                  {connection.quietPeriods === 1 ? "period" : "periods"}
                </span>
                <span>{connection.resumed} resumed</span>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {footerLabel === null ? null : (
        <div className="flex min-w-0 items-center gap-2 border-t border-current/20 pt-1.5 text-2xs">
          <span className="text-muted">{footerLabel}</span>
        </div>
      )}
    </article>
  );
};

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

// A tip, not an affordance: card chrome kept inviting a click that does not
// exist, so this is a line of advice with a mark beside it and nothing to press.
const AgentActivityTip = () => (
  <p className="m-0 flex min-w-0 gap-1.5 text-xs text-muted [&>span>svg]:size-3.5">
    <span
      className="mt-px inline-flex shrink-0 items-center"
      aria-hidden="true"
    >
      <Icon icon={LIGHTBULB_ICON} />
    </span>
    <span className="min-w-0 [overflow-wrap:anywhere]">
      You can see all agent activity directly in the terminal or chat the agent
      runs in.
    </span>
  </p>
);

export type ConnectionLogRowReading = {
  readonly label: string;
  readonly prefix: string;
  readonly suffix: string;
  /**
   * Whether the stored reason still tells the reader something the label does
   * not. An aged-out row names a threshold the label cannot carry; a reported
   * end would only say "the agent session ended" under a row already headed
   * "Session ended".
   */
  readonly showReason: boolean;
};

/**
 * Names one connection-log row from the event and the one that follows it.
 *
 * An observed end is the only row that states what happened rather than what
 * stopped being observed, so it is the only one that may say so (BIG-156). A
 * gap Big Plan inferred stays a quiet period, because that is all the evidence
 * behind it supports (BIG-147).
 */
export const connectionLogRowReading = ({
  connected,
  ended,
  nextConnected,
  knownSession,
}: {
  readonly connected: boolean;
  readonly ended: boolean;
  readonly nextConnected: boolean | undefined;
  readonly knownSession: boolean;
}): ConnectionLogRowReading => {
  if (connected) {
    return {
      label: "Connected",
      prefix: "Connected for ",
      suffix: "",
      showReason: true,
    };
  }
  const label = ended ? "Session ended" : "No signal";
  const showReason = !ended;
  if (nextConnected === true) {
    return {
      label,
      prefix: knownSession ? "Signal returned after " : "First signal after ",
      // "Quiet" is the word for a gap Big Plan inferred. The time between a
      // reported end and the next session is a measured interval, not a
      // silence anyone had to interpret, so it is stated without that word.
      suffix: ended ? "" : " quiet",
      showReason,
    };
  }
  return ended
    ? { label, prefix: "Ended ", suffix: " ago", showReason }
    : { label, prefix: "Quiet for ", suffix: "", showReason };
};

export type ConnectionLogTally = {
  readonly quietPeriods: number;
  readonly sessionsEnded: number;
  readonly resumed: number;
};

/**
 * Names the state the log's summary reports.
 *
 * It has to answer with the same word as the health card above it: a summary
 * reading "NO SIGNAL" under a card reading "Agent session ended" tells the
 * reviewer the two disagree about what happened.
 */
export const connectionLogState = ({
  connected,
  ended,
}: {
  readonly connected: boolean;
  readonly ended: boolean;
}): string => (connected ? "CONNECTED" : ended ? "SESSION ENDED" : "NO SIGNAL");

/**
 * Counts what the log's edges say, keeping reported ends out of the count of
 * gaps Big Plan inferred. Those are different events, and a summary that
 * merges them re-imports the guess the row above it just stopped making.
 */
export const connectionLogTally = (
  events: ReadonlyArray<Pick<BrowserConnectionEvent, "connected" | "reason">>,
): ConnectionLogTally => {
  let quietPeriods = 0;
  let sessionsEnded = 0;
  let resumed = 0;
  let hasConnected = false;
  events.forEach((event, index) => {
    const previous = events[index - 1];
    if (!event.connected && previous?.connected) {
      if (connectionEventEnded(event)) sessionsEnded += 1;
      else quietPeriods += 1;
    }
    if (event.connected && hasConnected && previous?.connected === false) {
      resumed += 1;
    }
    if (event.connected) hasConnected = true;
  });
  return { quietPeriods, sessionsEnded, resumed };
};

/** Renders the tally, naming reported ends only once there are some. */
export const connectionLogTallyLabel = ({
  quietPeriods,
  sessionsEnded,
  resumed,
}: ConnectionLogTally): string =>
  [
    `${quietPeriods} quiet ${quietPeriods === 1 ? "period" : "periods"}`,
    ...(sessionsEnded === 0
      ? []
      : [
          `${sessionsEnded} ended ${sessionsEnded === 1 ? "session" : "sessions"}`,
        ]),
    `${resumed} resumed`,
  ].join(" · ");

/** True when this edge carries the loop's own report that its session ended. */
export const connectionEventEnded = (
  event: Pick<BrowserConnectionEvent, "connected" | "reason">,
): boolean => !event.connected && event.reason === AGENT_SESSION_ENDED_REASON;

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
  // A gap in the signal is a quiet period, not an observed disconnection. The
  // runtime records an edge whenever the heartbeat ages out, and nothing renews
  // it while a turn runs, so counting these as disconnects and reconnects put
  // events in the reviewer's log that never happened (BIG-147). An end the
  // agent's loop reported is the one edge that is not a guess, and it is
  // counted apart from them (BIG-156).
  const tally = connectionLogTally(ordered);
  const latestEnded = latest !== undefined && connectionEventEnded(latest);
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
          className="rounded-full border border-edge px-1.5 py-px text-2xs font-semibold leading-[1.2] text-muted"
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
                {connectionLogState({ connected, ended: latestEnded })}
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
                {connectionLogTallyLabel(tally)}
              </dd>
            </div>
          </dl>
          {Array.from(groups).map(([date, rows]) => (
            <section key={date} className="mt-2 [&+section]:mt-3">
              <h3 className="mt-0 mb-1 border-b border-edge pb-1 text-2xs font-semibold text-muted">
                {date}
              </h3>
              <ol className="m-0 grid list-none gap-1.5 p-0">
                {rows.map((event) => {
                  const index = ordered.indexOf(event);
                  const next = ordered[index + 1];
                  const knownSession = ordered
                    .slice(0, index)
                    .some((candidate) => candidate.connected);
                  const ended = connectionEventEnded(event);
                  const reading = connectionLogRowReading({
                    connected: event.connected,
                    ended,
                    nextConnected: next?.connected,
                    knownSession,
                  });
                  const duration = compactDurationLabel({
                    start: event.atMs,
                    end: next?.atMs ?? nowMs,
                  });
                  return (
                    <li
                      key={event.eventId ?? event.at}
                      className="relative grid min-w-0 grid-cols-[0.65rem_4.6rem_minmax(0,1fr)_auto] items-baseline gap-x-1.5 gap-y-0.5 py-1 leading-none first:pt-0.5 last:pb-0 [&>*]:min-h-4 [&_*]:leading-[1.2]"
                      data-review-connection-event={
                        event.connected
                          ? "connected"
                          : ended
                            ? "ended"
                            : "quiet"
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
                        {reading.label}
                      </strong>
                      {event === latest ? (
                        <Badge
                          size="compact"
                          tone="secondary"
                          className="h-4 py-0"
                        >
                          Current
                        </Badge>
                      ) : null}
                      <span
                        className="col-start-3 col-end-5 text-2xs text-muted"
                        data-review-connection-duration=""
                      >
                        {reading.prefix}
                        {duration ?? "duration unavailable"}
                        {reading.suffix}
                      </span>
                      {event.reason === undefined ||
                      !reading.showReason ? null : (
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
  status,
  presenceState,
  connected,
  heldWork,
  heartbeatAt,
  endedAtMs,
  modelName,
  modelEffort,
  modelClient,
  sessionUrl,
  sessionId,
  connectionLog,
  recoveryPrompt,
  isReadOnly,
  replacementUrl,
  onViewRequest,
}: {
  readonly activity: CurrentAgentActivity;
  readonly status: AgentHealth;
  readonly presenceState: ReviewAgentProjection["state"];
  readonly connected: boolean;
  readonly modelName?: string;
  readonly modelEffort?: string;
  readonly modelClient?: string;
  readonly sessionUrl?: string;
  readonly sessionId?: string;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  /**
   * What held work says about the quiet. It chooses this section's copy and
   * nothing else: while it explains the quiet the section names the takeover
   * that connecting a session would cost, and once it has gone stale the copy
   * becomes the plain recovery instruction. It never decides whether the
   * section renders, and never decides what the cards above report, which stays
   * presence alone (BIG-147).
   */
  readonly heldWork: HeldWorkQuiet;
  readonly heartbeatAt: number;
  /** When the agent's own loop reported the session ending, if it did. */
  readonly endedAtMs?: number;
  readonly recoveryPrompt: string;
  readonly isReadOnly: boolean;
  readonly replacementUrl: string | null;
  readonly onViewRequest: (requestId: string, kind: string) => void;
}) => {
  const currentNowMs = useSecondClock();
  /*
  The recovery section opens itself the moment the agent goes, and stays open
  or closed as the reader leaves it after that. It is controlled rather than
  given an initial `open`, because this card re-renders every second and an
  uncontrolled attribute would be re-asserted on the next tick, reopening a
  section the reader had just closed. The effect fires on the transition into
  disconnected rather than on every render, so closing it stays closed while
  the agent is still gone.
  */
  const agentIsGone =
    activity.state === "disconnected" || activity.state === "offline";
  const [recoveryIsOpen, setRecoveryIsOpen] = useState(agentIsGone);
  useEffect(() => {
    // Follows the transition, not the render: the section opens when the agent
    // goes and closes when one arrives, and a reader who toggles it in between
    // keeps their choice until the state changes under them again.
    setRecoveryIsOpen(agentIsGone);
  }, [agentIsGone]);
  const connection = summarizeAgentConnection({ events: connectionLog });
  // The activity already answers "has an agent ever been here", and answers it
  // on more evidence than the log alone: a claim counts even when the log lost
  // the edge. Asking it here keeps the section's words and the card's headline
  // from ever disagreeing.
  const neverConnected = activity.state === "never-connected";
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
      {agentStatusIsAvailable ? (
        isReadOnly ? (
          <ReadOnlySessionCard replacementUrl={replacementUrl} />
        ) : (
          <CurrentActivityCard
            activity={activity}
            status={status}
            modelName={modelName}
            modelEffort={modelEffort}
            modelClient={modelClient}
            sessionUrl={sessionUrl}
            sessionId={sessionId}
            connection={connection}
            nowMs={currentNowMs}
            onViewRequest={onViewRequest}
          />
        )
      ) : presenceState === "loading" ? (
        <AgentPresenceLoadingCard />
      ) : (
        <AgentPresenceUnavailableCard />
      )}
      {/* Always present with respect to the AGENT: a section that comes and
          goes as an agent connects and drops teaches the reader it might not be
          there when they need it. Withheld only when the review session itself
          is unreachable, where a reconnect instruction would point at a URL
          that is already dead. */}
      {isReadOnly || !agentStatusIsAvailable ? null : (
        <details
          className="group mt-3 rounded-md border border-edge text-xs text-muted"
          open={recoveryIsOpen}
          onToggle={(event) => setRecoveryIsOpen(event.currentTarget.open)}
          data-review-agent-recovery={
            heldWork === "explained" ? "takeover" : "plain"
          }
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className="inline-flex transition-transform group-open:rotate-90 [&>svg]:size-3.5">
              <Icon icon={CHEVRON_RIGHT_ICON} />
            </span>
            {heldWork === "explained"
              ? "Connect a new agent"
              : neverConnected
                ? "Connect your agent"
                : "Reconnect your agent"}
          </summary>
          <div className="grid gap-2 border-t border-edge px-3 py-3">
            {heldWork === "explained" ? (
              /*
              The consequence is stated as the code behaves, not as it would be
              kinder to say. A quiet agent keeps its answer - a lapsed lease is
              not a rejection (BIG-147) - but a DISPLACED one does not: taking
              the claim rewrites its holder, and the mailbox refuses a response
              from an agent that no longer holds it. Softening this to "its
              answer still arrives" would be the product lying about itself in
              the one place a reader is deciding whether to act.
              */
              <p className="m-0">
                An agent is already connected to this session and may still be
                working on it. If you wish, you can replace that agent with a
                different one. The agent connected now would stop being able to
                answer, so anything it has in flight is dropped rather than
                delivered. All comments are safe.
              </p>
            ) : null}
            <p className="m-0">
              {heldWork === "explained"
                ? "To connect a new agent anyway, paste this exact prompt into your coding agent:"
                : neverConnected
                  ? "To connect this running review, paste this exact prompt into your coding agent:"
                  : "To reconnect this running review, paste this exact prompt into your coding agent:"}
            </p>
            <CopyBlock
              value={
                recoveryPrompt ||
                "Ask your coding agent to reconnect to this Big Plan review and keep its feedback loop running."
              }
              label="recovery prompt"
            />
          </div>
        </details>
      )}
      <div className="mt-3">
        <AgentActivityTip />
      </div>
      {isReadOnly || !agentStatusIsAvailable ? null : (
        <>
          <hr className="mt-3 border-0 border-t border-edge" />
          <ConnectionLog
            connected={isConnected}
            heartbeatAt={endedAtMs ?? heartbeatAt}
            events={connectionLog}
            nowMs={currentNowMs}
          />
        </>
      )}
    </section>
  );
};
