// Renders the Agent Status sidebar's body from truthful runtime facts. The
// review kernel owns polling and navigation; this module owns only the visual
// projection and local disclosure/copy interactions.

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { COPY_ICON } from "../../icons/lucide/copy.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { LIGHTBULB_ICON } from "../../icons/lucide/lightbulb.js";
import { agentSessionAffordance } from "../shared/agent-session-link.js";
import {
  AGENT_SESSION_ENDED_REASON,
  agentActivityIsAttached,
  agentDisconnectDropsWork,
  agentHasEverConnected,
} from "../shared/agent-status.js";
import { AGENT_DISCONNECTED_REASON } from "../shared/agent-disconnect.js";
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
import { Icon } from "./icon.browser.js";
import {
  AgentIdentityLine,
  AgentSessionFact,
} from "./agent-identity.browser.js";
import { INFO_ICON } from "../../icons/lucide/info.js";
import { AgentRoleBadge } from "./agent-roster.browser.js";
import type { ReviewAgentProjection } from "./review-poll-health.js";
import {
  AlertDialog,
  Badge,
  Button,
  Tooltip,
  WorkingMark,
  copyControlLabel,
  useCopyToClipboard,
} from "./ui.browser.js";

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

// Keep human-readable elapsed time independent from the slower network poll.
// This runs only while the Agent Status body is mounted, so the local tick
// cannot make the rest of the review workspace rerender every second.
const useSecondClock = (): number => {
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return nowMs;
};

const ReadOnlySessionCard = ({
  replacementUrl,
}: {
  readonly replacementUrl: string | null;
}) => (
  <article
    className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-[var(--callout-warning-c)] bg-[var(--callout-warning-bg)] p-3 text-xs leading-[1.45] text-[var(--callout-warning-c)]"
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
        {/* The reserved width is the point: this stack is sized by its
            widest child, so it is the one grid here that wants the
            content-based track the fence otherwise refuses. */}
        {/* eslint-disable-next-line no-restricted-syntax */}
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
  // A pending primacy question is a request, not a fault, so the card keeps the
  // warning register rather than the danger one; the roster above it carries
  // the actual question (BIG-171).
  "decision-owed":
    "border-[var(--callout-warning-c)] bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]",
  working:
    "border-[var(--diff-add-c)] bg-[var(--diff-add-bg)] text-[var(--diff-add-c)]",
  "read-only":
    "border-[var(--callout-warning-c)] bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]",
  stalled:
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
  readonly sessionsEnded: number;
  readonly resumed: number;
} => {
  const ordered = events
    .map((event) => ({ ...event, atMs: Date.parse(event.at) }))
    .filter((event) => Number.isFinite(event.atMs))
    .sort((left, right) => left.atMs - right.atMs);
  // A gap in the signal is a quiet period, not an observed disconnection. The
  // runtime records an edge whenever the heartbeat ages out, and nothing renews
  // it while a turn runs, so counting these as disconnects and reconnects put
  // events in the reviewer's log that never happened (BIG-147). An end the
  // agent's loop reported is the one edge that is not a guess, and it is
  // counted apart from them (BIG-156).
  let quietPeriods = 0;
  let sessionsEnded = 0;
  let resumed = 0;
  let hasConnected = false;
  let endedThisDeparture = false;
  ordered.forEach((event, index) => {
    // Counted on the edge itself rather than on the transition into it, because
    // an end the reviewer asked for can follow a gap Big Plan had already
    // written down: the agent went quiet, and then the reviewer ended it, and
    // both happened. A quiet period is still only ever a departure from a
    // connection, so nothing counts one twice.
    //
    // One departure ends one session, however many times it is explained. A
    // better account of the same absence - the reviewer's decision arriving
    // after the loop's own report - replaces the reason on the log's last row
    // rather than adding a second agent to the tally.
    if (event.connected) endedThisDeparture = false;
    if (!event.connected && hasConnected && connectionEventEnded(event)) {
      if (!endedThisDeparture) sessionsEnded += 1;
      endedThisDeparture = true;
    } else if (!event.connected && ordered[index - 1]?.connected) {
      quietPeriods += 1;
    }
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
    sessionsEnded,
    resumed,
  };
};

/*
The consequence of disconnecting, on demand rather than in the card.

It is a real trade and the reviewer deserves to know it, but it is the same
sentence every time and printing it beside the control would make a card about
the agent's work mostly about a button. A quiet mark answers it when asked, and
the confirmation states the part that depends on what the agent is doing right
now (BIG-184's pattern).
*/
const DISCONNECT_HELP =
  "Tell the agent to end its session so a different agent can become the primary. Work in flight is dropped; your comments stay.";

/** Explains, on hover or keyboard focus, what disconnecting costs. */
const DisconnectHelp = () => (
  <Tooltip label={DISCONNECT_HELP} placement="above" asChild>
    <button
      type="button"
      /* The mark takes its colour from the card it sits on rather than from
         the grey ramp: a tinted ground gets its own steps, never grey. */
      className="inline-flex size-5 flex-none cursor-help items-center justify-center rounded-full border-0 bg-transparent p-0 leading-none opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&>svg]:size-3.5"
      aria-label="About disconnecting the agent"
    >
      <Icon icon={INFO_ICON} />
    </button>
  </Tooltip>
);

/**
 * Takes the agent off the review, once the reviewer has confirmed it.
 *
 * One dialog and no more. The two cases differ by a sentence - whether an
 * answer is dropped - and asking twice, or asking again after the answer was
 * already stated, would make the cheap case feel dangerous and teach the
 * reviewer to click through the expensive one (BIG-190).
 */
const DisconnectAgentControl = ({
  dropsWork,
  isPending,
  onDisconnect,
}: {
  /** Whether the agent is holding an answer this would drop. */
  readonly dropsWork: boolean;
  /** Whether the reviewer has already asked and the agent has not yet gone. */
  readonly isPending: boolean;
  readonly onDisconnect: () => void;
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1">
      <DisconnectHelp />
      <Button
        variant="toned"
        size="micro"
        disabled={isPending}
        data-review-agent-disconnect=""
        onClick={() => setIsConfirming(true)}
      >
        {isPending ? "Disconnecting…" : "Disconnect agent"}
      </Button>
      <AlertDialog
        open={isConfirming}
        title="Disconnect this agent?"
        /* The destructive copy names the claim, never the agent's health.
           `agentDisconnectDropsWork` is true for working, stalled AND errored,
           because it is the live claim that costs something rather than how
           well its holder is doing. Wording that said the agent was answering
           right now asserted a state the card directly above it denied - it
           reads "Agent may be stalled" - so this says the one thing true in all
           three, and cannot drift out of step with that headline again. */
        description={
          dropsWork
            ? "This agent is holding work on this review. Disconnecting tells it to stop, and the answer it has in flight is dropped rather than delivered. Your comments and questions stay where they are, and the next agent you connect picks them up."
            : "The agent is told to end its session, and the review is free for a different agent to connect. Your comments and questions stay where they are."
        }
        actionLabel="Disconnect agent"
        /* Drama in proportion to the cost. Dropping an answer the agent is
           composing is destructive and is dressed as such; taking a quiet agent
           off the review destroys nothing, and painting that red would teach
           the reviewer to click through the red that matters. */
        tone={dropsWork ? "destructive" : "neutral"}
        onCancel={() => setIsConfirming(false)}
        onAction={() => {
          setIsConfirming(false);
          onDisconnect();
        }}
      />
    </span>
  );
};

const CurrentActivityCard = ({
  activity,
  status,
  modelName,
  modelEffort,
  modelClient,
  sessionUrl,
  sessionId,
  writerId,
  carriesRosterAgent,
  connection,
  nowMs,
  isPrimary,
  disconnectRequestedAtMs,
  isDisconnectingAgent,
  onViewRequest,
  onDisconnect,
}: {
  readonly activity: CurrentAgentActivity;
  readonly status: AgentHealth;
  readonly modelName?: string;
  readonly modelEffort?: string;
  readonly modelClient?: string;
  readonly sessionUrl?: string;
  readonly sessionId?: string;
  /**
   * The roster id of the agent this card is drawing, which names its session
   * when the connector declared no handle of its own.
   */
  readonly writerId?: string;
  /**
   * Whether this card has absorbed the roster's own card for the same agent,
   * which is what makes this the one place its role and its disconnect live.
   */
  readonly carriesRosterAgent: boolean;
  readonly connection: ReturnType<typeof summarizeAgentConnection>;
  readonly nowMs: number;
  /**
   * Whether this card is the primary's card, which is the only role it can
   * hold. It is set only while a second agent is on the rail: with one agent
   * there is nothing to tell it apart from, and a badge saying so is a word
   * the reader has to read and cannot use.
   */
  readonly isPrimary: boolean;
  /** When the reviewer disconnected this agent, if they already have. */
  readonly disconnectRequestedAtMs?: number;
  /** Whether a disconnect the reviewer confirmed has not been answered yet. */
  readonly isDisconnectingAgent: boolean;
  readonly onViewRequest: (requestId: string, kind: string) => void;
  readonly onDisconnect: () => void;
}) => {
  const body =
    activity.state === "working" ? activity.latestStep : activity.supporting;
  /*
  A live connection is the fact a reviewer checks this card for; what the agent
  happens to be doing is the detail underneath it. Only the working state
  buries the connection behind the activity, so only it is retitled.

  The borrowed label is taken only while the health really is this agent's
  health. A pending primacy question moves the shared indicator to a state that
  describes a DIFFERENT agent (BIG-171), and titling this card with it read as
  "Second agent needs an answer" above the working primary's own progress. When
  the indicator is speaking for someone else, the card states its own activity.
  */
  const title =
    activity.state === "working" && status.indicator === "working"
      ? status.label
      : activity.headline;
  const targetLabel =
    activity.state !== "disconnected" &&
    activity.state !== "never-connected" &&
    "targetLabel" in activity
      ? activity.targetLabel
      : undefined;
  /*
  What the agent is doing and which thread it is doing it to are two facts,
  not one label. Joining them put a thread name in a section-title face and
  read as though the status itself were called "start here, disconnected".

  Withheld when the title above is already this sentence. The title borrows the
  shared status label only while that label is still about this agent, so a
  pending question from a SECOND agent hands the title back to the activity's
  own headline - and the card then printed "Responding to a comment" twice,
  once as its heading and once as its body (BIG-171).
  */
  const workHeadline =
    activity.state === "working" && activity.headline !== title
      ? activity.headline
      : undefined;
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
  const sessionAffordance = agentSessionAffordance({
    ...(sessionUrl === undefined ? {} : { sessionUrl }),
    ...(sessionId === undefined ? {} : { sessionId }),
  });
  /* The handle the fact row states. A declared session is the answer; an agent
     that declared none is named by its roster id, the only name it has. */
  const sessionHandle = sessionId ?? writerId;
  // Since and Events describe a connection at rest; the session identifies the
  // agent whatever it is doing. The working card carries the second without the
  // first, and every other state carries both.
  const showsSinceAndEvents =
    activity.state !== "working" &&
    connection.sinceAtMs !== undefined &&
    connection.everConnected;
  const showsConnectionFacts =
    showsSinceAndEvents || sessionHandle !== undefined;
  const requestId = "requestId" in activity ? activity.requestId : undefined;
  const requestKind = "requestId" in activity ? activity.requestKind : "";
  /*
  Offered wherever there is an agent to disconnect, and nowhere else.

  "Nobody attached" is two questions, not one. The activity answers whether the
  agent is answering; the roster answers whether a record - and the claim it
  holds - is still there to release. A disconnected agent whose roster record is
  still standing is exactly the case where the reviewer needs the control, and
  it is the case that used to draw a SECOND card for the same agent underneath
  this one just to carry it (BIG-273).
  */
  const canDisconnect = agentActivityIsAttached(activity) || carriesRosterAgent;
  const footerLabel =
    "updatedAtMs" in activity
      ? `Updated ${relativeSignalLabel({ now: nowMs, at: activity.updatedAtMs })}`
      : activity.state === "idle"
        ? "No unanswered requests"
        : null;
  return (
    <article
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 rounded-lg border p-3 text-xs leading-[1.45] ${STATUS_CARD_TONE[status.indicator]}`}
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
        {/* The role sits in the corner opposite the title, which is where the
            roster cards below carry theirs: one place to look down the rail for
            who is who, whatever else a card happens to be saying. */}
        {isPrimary ? <AgentRoleBadge isPrimary /> : null}
      </div>
      {/*
      The same identity line the roster cards below carry, so the agent holding
      the plan is named exactly as it is named everywhere else on this rail
      (BIG-273). Identity is shown only where it exists: a session that declared
      nothing and has no roster id renders nothing here, because a line saying
      so would occupy the space an answer occupies while carrying none.
      */}
      <AgentIdentityLine
        {...(modelName === undefined ? {} : { model: modelName })}
        {...(modelEffort === undefined ? {} : { effort: modelEffort })}
        {...(modelClient === undefined ? {} : { client: modelClient })}
      />
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
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 rounded-md border border-current/25 bg-[color-mix(in_srgb,currentColor_6%,transparent)] p-2"
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
          {sessionHandle === undefined ? null : (
            /* The one place a session identifier is offered. It cannot be
               followed, so it belongs with the facts a reader consults rather
               than beside the state they are reading - and having it here is
               what lets the identity line above it carry no session at all. */
            <AgentSessionFact
              handle={sessionHandle}
              isCopyable={sessionId !== undefined}
            />
          )}
          {showsSinceAndEvents ? (
            <div className="min-w-0">
              <dt className="font-semibold">Events</dt>
              <dd className="m-0 grid grid-cols-[minmax(0,1fr)] text-ink [overflow-wrap:anywhere]">
                <span>
                  {connection.quietPeriods} quiet{" "}
                  {connection.quietPeriods === 1 ? "period" : "periods"}
                </span>
                {/* A reported end is a fact rather than an inference, so it is
                    named apart from a quiet period - but only once one has
                    happened, so an unbroken session reads no differently. */}
                {connection.sessionsEnded === 0 ? null : (
                  <span>
                    {connection.sessionsEnded} ended{" "}
                    {connection.sessionsEnded === 1 ? "session" : "sessions"}
                  </span>
                )}
                <span>{connection.resumed} resumed</span>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {/* The control sits with the card's other standing facts rather than
          beside the state it would change: the reader comes here to learn how
          the agent is doing, and an action in that line reads as the thing to
          do about it. */}
      {footerLabel === null && !canDisconnect ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-current/20 pt-1.5 text-2xs">
          {footerLabel === null ? null : (
            <span className="min-w-0 text-muted">{footerLabel}</span>
          )}
          {canDisconnect ? (
            <DisconnectAgentControl
              dropsWork={agentDisconnectDropsWork(activity)}
              /* Either the runtime has recorded the directive, or this page is
                 still waiting to hear that it did. Both are the same fact to a
                 reader: they have asked, and the agent has not gone yet. */
              isPending={
                isDisconnectingAgent || disconnectRequestedAtMs !== undefined
              }
              onDisconnect={onDisconnect}
            />
          ) : null}
        </div>
      )}
    </article>
  );
};

const AgentPresenceUnavailableCard = () => (
  <article
    className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 rounded-lg border border-edge bg-raised p-3 text-xs leading-[1.45] text-muted"
    data-review-connection-health="unobservable"
  >
    <strong className="text-sm text-ink">Agent status unavailable</strong>
    {/* "Unreachable", the same word the offline card and the toolbar use, so
        one condition is not reported in two vocabularies (BIG-273). */}
    <p className="m-0 [overflow-wrap:anywhere]">
      The review session is unreachable, so agent presence cannot be checked.
    </p>
  </article>
);

const AgentPresenceLoadingCard = () => (
  <article
    className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 rounded-lg border border-edge bg-raised p-3 text-xs leading-[1.45] text-muted"
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
    <span data-leading-icon="" aria-hidden="true">
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
  reason,
  nextConnected,
  knownSession,
}: {
  readonly connected: boolean;
  readonly ended: boolean;
  /** The stored reason, which decides whether the row still needs to state it. */
  readonly reason?: string;
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
  // An end states what happened, so its reason usually repeats the label back.
  // A disconnect is the exception worth keeping: "Session ended" does not say
  // the reviewer ended it, and that is the fact the row is for.
  const showReason = !ended || reason === AGENT_DISCONNECTED_REASON;
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

/**
 * Paints one timeline marker: a dot, filled by what the entry is.
 *
 * The paint lives here rather than inline so it has one owner and one test.
 * Its rule is that a marker names exactly one background utility. Two of them
 * in one class list are not resolved by the order they are written, because
 * they carry equal specificity and the generated stylesheet decides which
 * comes last - and it emits a named utility after an arbitrary-value one. A
 * `bg-paper` ground carried in the base therefore outranked the connected
 * entry's own fill no matter where it was written, and the marker rendered
 * hollow (BIG-176). Each state names its ground or its fill, never both.
 */
export const connectionMarkerClassName = ({
  connected,
  isLatest,
}: {
  readonly connected: boolean;
  readonly isLatest: boolean;
}): string =>
  `relative size-[6px] shrink-0 self-center rounded-full border ${
    connected
      ? "border-[var(--diff-add-c)] bg-[var(--diff-add-c)]"
      : isLatest
        ? "border-warning bg-warning"
        : "border-muted bg-paper"
  }`;

/**
 * True when this edge carries a reported end rather than an inferred gap.
 *
 * Two things count, and both for the same reason: the loop's own report that
 * its session ended, and the reviewer's own decision to disconnect it. Neither
 * is a silence anybody had to interpret, which is the whole distinction this
 * predicate exists to draw (BIG-156).
 */
export const connectionEventEnded = (
  event: Pick<BrowserConnectionEvent, "connected" | "reason">,
): boolean =>
  !event.connected &&
  (event.reason === AGENT_SESSION_ENDED_REASON ||
    event.reason === AGENT_DISCONNECTED_REASON);

/*
The log is the history and nothing else. State, since, last signal, and the
event tally are the status card's answers, and the card is on screen directly
above this section: repeating them here made the reader check two renderings of
one fact for agreement, and gave the same answer a second voice that could drift
from the first (BIG-176).
*/
const ConnectionLog = ({
  events,
  nowMs,
}: {
  readonly events: ReadonlyArray<BrowserConnectionEvent>;
  readonly nowMs: number;
}) => {
  const ordered = events
    .map((event) => ({ ...event, atMs: Date.parse(event.at) }))
    .filter((event) => Number.isFinite(event.atMs))
    .sort((left, right) => left.atMs - right.atMs);
  const latest = ordered.at(-1);
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
          {Array.from(groups).map(([date, rows]) => (
            <section key={date} className="mt-2 [&+section]:mt-3">
              <h3 className="mt-0 mb-1 border-b border-edge pb-1 text-2xs font-semibold text-muted">
                {date}
              </h3>
              <ol className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-1.5 p-0">
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
                    ...(event.reason === undefined
                      ? {}
                      : { reason: event.reason }),
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
                      /* The minimum line box belongs to the row's text, which
                         is what has to keep a common baseline rhythm. The
                         marker is a drawn dot with its own geometry, and a
                         floor applied to it stretches the circle into a pill
                         instead of aligning anything (BIG-176). */
                      className="relative grid min-w-0 grid-cols-[0.65rem_4.6rem_minmax(0,1fr)_auto] items-baseline gap-x-1.5 gap-y-0.5 py-1 leading-none first:pt-0.5 last:pb-0 [&>*:not([data-review-connection-marker])]:min-h-4 [&_*]:leading-[1.2]"
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
                        className={connectionMarkerClassName({
                          connected: event.connected,
                          isLatest: event === latest,
                        })}
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
                        <span
                          /* A disconnect the reviewer performed is a normal
                             outcome, not a hazard, so it is set in the log's own
                             quiet voice rather than in the amber the inferred
                             gaps use. */
                          className={`col-start-3 col-end-5 text-2xs ${
                            ended ? "text-muted" : "text-warning"
                          }`}
                        >
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
  modelName,
  modelEffort,
  modelClient,
  sessionUrl,
  sessionId,
  writerId,
  carriesRosterAgent,
  connectionLog,
  recoveryPrompt,
  isReadOnly,
  replacementUrl,
  roster,
  isActivityPrimary,
  hasAttachedAgent,
  disconnectRequestedAtMs,
  isDisconnectingAgent,
  onViewRequest,
  onDisconnect,
}: {
  readonly activity: CurrentAgentActivity;
  readonly status: AgentHealth;
  readonly presenceState: ReviewAgentProjection["state"];
  readonly modelName?: string;
  readonly modelEffort?: string;
  readonly modelClient?: string;
  readonly sessionUrl?: string;
  readonly sessionId?: string;
  /** The roster id of the agent the status card is drawing, when there is one. */
  readonly writerId?: string;
  /** Whether the roster's card for that agent has been merged into this one. */
  readonly carriesRosterAgent: boolean;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  readonly recoveryPrompt: string;
  readonly isReadOnly: boolean;
  readonly replacementUrl: string | null;
  /**
   * The cards for the other agents attached to this review, drawn directly
   * under the status card.
   *
   * It arrives as a slot rather than being composed above this panel because
   * the order is the point: the reviewer asked for the status card at the top
   * of the rail, and the cards for everyone else belong with it rather than
   * after the connect instructions and the log. One component owning that
   * order is what keeps the two from drifting apart.
   */
  readonly roster?: ReactNode;
  /**
   * Whether the status card is the primary's, with a second agent on the rail.
   */
  readonly isActivityPrimary: boolean;
  /**
   * Whether any agent is attached to this review.
   *
   * What the connect section says is gated on this rather than on held work.
   * Held work answers a different question - whether a claim is open - and
   * answered this one wrong in both directions: an agent attached between two
   * turns got the copy written for a review with nobody on it, and an open
   * claim inside the recovery horizon with nobody behind it warned the reviewer
   * about replacing an agent that had already gone (BIG-171).
   */
  readonly hasAttachedAgent: boolean;
  /** When the reviewer disconnected the attached agent, if they already have. */
  readonly disconnectRequestedAtMs?: number;
  /** Whether a disconnect the reviewer confirmed has not been answered yet. */
  readonly isDisconnectingAgent: boolean;
  readonly onViewRequest: (requestId: string, kind: string) => void;
  readonly onDisconnect: () => void;
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
  return (
    <section className="min-w-0">
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
            writerId={writerId}
            carriesRosterAgent={carriesRosterAgent}
            connection={connection}
            nowMs={currentNowMs}
            isPrimary={isActivityPrimary}
            {...(disconnectRequestedAtMs === undefined
              ? {}
              : { disconnectRequestedAtMs })}
            isDisconnectingAgent={isDisconnectingAgent}
            onViewRequest={onViewRequest}
            onDisconnect={onDisconnect}
          />
        )
      ) : presenceState === "loading" ? (
        <AgentPresenceLoadingCard />
      ) : (
        <AgentPresenceUnavailableCard />
      )}
      {roster === undefined ? null : <div className="mt-3">{roster}</div>}
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
          data-review-agent-recovery={hasAttachedAgent ? "joining" : "plain"}
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className="inline-flex transition-transform group-open:rotate-90 [&>svg]:size-3.5">
              <Icon icon={CHEVRON_RIGHT_ICON} />
            </span>
            {hasAttachedAgent
              ? "Connect another agent"
              : neverConnected
                ? "Connect your agent"
                : "Reconnect your agent"}
          </summary>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 border-t border-edge px-3 py-3">
            {hasAttachedAgent ? (
              /*
              What arriving actually does, which is no longer what this section
              used to say. It described a takeover - the new agent replaces the
              old one, and the old one's work is dropped - and every clause of
              that has been false since an arriving agent started attaching as
              an observer. It now names the two things the reader is about to
              meet: an observer, and a question addressed to them (BIG-171).

              "Primary" throughout, never "primacy": the reviewer's word, and
              the one the cards above already use.
              */
              <>
                <p className="m-0">
                  An agent is already answering this review. This is the{" "}
                  <strong className="font-semibold text-ink">primary</strong>{" "}
                  agent.
                </p>
                {/*
                "Read the plan", and not the conversation. An observer's
                `agent next` returns the plan path and the review URL and
                nothing else - no comment, no history, no request state - so a
                promise of the conversation was one the protocol never kept.
                */}
                <p className="m-0">
                  If you invite a new agent, it will join as an{" "}
                  <strong className="font-semibold text-ink">observer</strong>{" "}
                  agent, which means it can read the plan, but it cannot read
                  your comments or answer you unless you make it the primary
                  agent.
                </p>
                <p className="m-0">
                  If you make the new agent the primary while the current one is
                  mid answer, you choose whether that unfinished answer is
                  passed to it or dropped.
                </p>
              </>
            ) : null}
            <p className="m-0">
              {hasAttachedAgent
                ? "To connect another agent, paste this exact prompt into your coding agent:"
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
          <ConnectionLog events={connectionLog} nowMs={currentNowMs} />
        </>
      )}
    </section>
  );
};
