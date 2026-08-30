// Owns the status vocabulary for review-wide agent activity and one request.
// It derives presentation facts from runtime input. It stores no state and
// does not depend on the browser or Node.

import { progressStepCodeIsAgentOwned } from "./progress-code.js";
import type { ProgressStepCode } from "./progress-code.js";
import {
  claimExplainsQuiet,
  claimIsLive,
  claimSignalAtMs,
  requestWasClaimed,
  type ClaimedRequest,
} from "./agent-claim.js";
import {
  requestIsTerminal,
  type TerminalAgentRequest,
} from "./agent-request-state.js";
import { AGENT_DISCONNECTED_REASON } from "./agent-disconnect.js";
import {
  AGENT_RECOVERY_HORIZON_MS,
  AGENT_STALL_MS,
  AGENT_STALL_WINDOW_LABEL,
} from "./agent-timing.js";
import type { AgentPrimacyHealth } from "./agent-primacy.js";
import type { BrowserConnectionEvent } from "./review-wire.js";
import { compactDurationLabel } from "./time-label.js";

// Agents are asked to send a progress note at least once per minute while
// working, and the extra 15 seconds absorbs scheduling and filesystem jitter.
// The window bounds how long silence stays presented as progress; it does not
// decide whether an agent is attached, because no signal renews while a turn
// runs (BIG-147).
export {
  AGENT_RECOVERY_HORIZON_MS,
  AGENT_STALL_MS,
  AGENT_STALL_WINDOW_LABEL,
} from "./agent-timing.js";

export type AgentActivityRequest = ClaimedRequest &
  TerminalAgentRequest & {
    readonly requestId: string;
    readonly kind: "feedback" | "reply" | "chat" | "push" | "approval";
    readonly createdAt: string;
    readonly claimedAt?: string;
    readonly baselineSnapshot?: string;
    readonly targetLabel?: string;
  };

/**
 * The settled answer to one request, as the card needs to read it: an approval
 * that carries a refusal, or one that carries none.
 */
export type AgentActivityAnswer = {
  readonly requestId: string;
  readonly hardStop?: string;
};

export type AgentActivityProgress = {
  readonly requestId?: string;
  readonly atMs?: number;
  readonly stepCode: ProgressStepCode;
  readonly step: string;
  readonly state: string;
  readonly detail?: string;
};

type ActivityRequestFacts = {
  readonly requestId: string;
  readonly requestKind: AgentActivityRequest["kind"];
  readonly targetLabel?: string;
};

export type CurrentAgentActivity =
  | ({
      readonly state: "working";
      readonly tone: "working";
      readonly headline: string;
      readonly latestStep: string;
      readonly updatedAtMs: number;
    } & ActivityRequestFacts)
  // A queue position is ordinary, not a problem, so it stays out of the
  // warning register the stalled and errored states own.
  | ({
      readonly state: "waiting";
      readonly tone: "neutral";
      readonly headline: "Waiting for agent";
      readonly supporting: "Feedback is queued and will start when the agent is available.";
    } & ActivityRequestFacts)
  | ({
      readonly state: "stalled";
      readonly tone: "warning";
      readonly headline: "Agent may be stalled";
      readonly supporting: string;
      readonly updatedAtMs: number;
    } & ActivityRequestFacts)
  | ({
      readonly state: "errored";
      readonly tone: "danger";
      readonly headline: "The agent reported a problem";
      readonly supporting: string;
    } & ActivityRequestFacts)
  | {
      readonly state: "never-connected";
      readonly tone: "neutral";
      readonly headline: "No agent has connected to this session yet.";
      readonly supporting: "Connect one to continue. All comments are safe.";
    }
  | {
      readonly state: "disconnected";
      readonly tone: "danger";
      /* Two headlines, because there are two facts. "The agent has
         disconnected" reports something the agent did, which is right for a
         lease Big Plan watched lapse and wrong for a departure the reviewer
         ordered. */
      readonly headline: "The agent has disconnected." | "Agent disconnected";
      readonly supporting: string;
    }
  | {
      readonly state: "offline";
      readonly tone: "danger";
      /* Never "Agent is unreachable". This state is the page losing contact
         with the review session, which is the only thing Big Plan can observe
         from here: the agent may be working away in its own terminal, and
         saying it is unreachable asserts something nobody checked. The remedy
         has always named the session - "Restart `big-plan review`" - so the
         headline naming the agent was the half of this state that did not
         match the other half (BIG-273). */
      readonly headline: "Review session unreachable";
      readonly supporting: string;
    }
  | {
      readonly state: "idle";
      readonly tone: "neutral";
      readonly headline: "Agent connected";
      readonly supporting: "The agent is connected and waiting for feedback.";
    };

/**
 * The states the Agent Status control can be in. Each owns a distinct glyph
 * shape as well as a colour, so a reader who cannot separate green from amber
 * from red still reads the state from the mark alone.
 *
 * `working` is the closest pair, because it is a live connection that happens
 * to be busy rather than a different kind of health: it keeps the connected
 * state's colour and separates itself by shape and motion, drawing the
 * product's one working mark - a rotating ring - where the connected state
 * fills a disc.
 */
export type AgentHealthIndicator =
  | "healthy"
  | "working"
  /**
   * A second agent is attached and the reviewer owes an answer about which one
   * speaks for the plan.
   *
   * It ranks below every fault and above every healthy state, because nothing
   * is broken - the primary is still answering - but the reviewer is being
   * asked for something and the toolbar is the only place they will see it
   * without opening the sidebar (BIG-171).
   */
  | "decision-owed"
  | "read-only"
  | "stalled"
  | "error"
  | "unavailable";

export type AgentHealth = {
  readonly indicator: AgentHealthIndicator;
  /** Names the state in words, for the control's accessible name and tooltip. */
  readonly label: string;
};

/**
 * What every surface says when this page cannot reach the review session.
 *
 * One string, because four surfaces report this one condition - the agent
 * card, the toolbar's accessible name, the feedback rail, and a thread's own
 * status strip - and a reviewer meets several of them at once. Written out at
 * each of them, they drifted into three claims about two different subjects:
 * the agent was unreachable, the agent had disconnected, and the runtime was
 * offline (BIG-273).
 *
 * The subject is the review session throughout, because that is the only thing
 * this page lost contact with, and it is what the remedy has always named.
 */
export const REVIEW_SESSION_UNREACHABLE_HEADLINE = "Review session unreachable";

/** The way back, and the promise that nothing typed was lost by getting here. */
export const REVIEW_SESSION_UNREACHABLE_SUPPORTING =
  "Restart `big-plan review`, then open the new URL it prints. All comments are safe.";

/**
 * Maps runtime facts to the single agent status shown in viewer chrome and at
 * the head of the agent sidebar. It is one derivation because the chrome and
 * the sidebar must never disagree about what state the agent is in.
 *
 * A queued request is not a fault: the agent is attached and will pick it up,
 * so it reads as connected rather than as a warning.
 *
 * `isObservable` is false while the review session itself is down: agent
 * presence is then unknown rather than bad, and claiming either would be a lie.
 */
export const deriveAgentHealth = ({
  activity,
  hasAgentRuntime,
  isReadOnly,
  isObservable,
  primacy = "settled",
}: {
  readonly activity: CurrentAgentActivity;
  readonly hasAgentRuntime: boolean;
  readonly isReadOnly: boolean;
  readonly isObservable: boolean;
  /** Whether a second agent has asked to speak for this plan (BIG-171). */
  readonly primacy?: AgentPrimacyHealth;
}): AgentHealth => {
  if (!hasAgentRuntime) {
    return { indicator: "unavailable", label: "No agent session" };
  }
  if (isReadOnly) {
    return { indicator: "read-only", label: "Using read-only session" };
  }
  if (!isObservable) {
    return { indicator: "unavailable", label: "Agent status unavailable" };
  }
  if (activity.state === "never-connected") {
    return { indicator: "unavailable", label: "No agent connected yet" };
  }
  /* Two faults, two sentences. An agent that stopped answering and a review
     session this page cannot reach are different facts with different remedies,
     and calling both of them "Agent disconnected" told a reviewer whose runtime
     had gone that their agent had left (BIG-273). The mark stays the same,
     because both are the same severity. */
  if (activity.state === "offline") {
    return { indicator: "error", label: REVIEW_SESSION_UNREACHABLE_HEADLINE };
  }
  if (activity.state === "disconnected") {
    return { indicator: "error", label: "Agent disconnected" };
  }
  if (activity.state === "errored") {
    return { indicator: "error", label: "Agent error" };
  }
  if (activity.state === "stalled") {
    return { indicator: "stalled", label: "Agent not responding" };
  }
  /*
  A pending primacy question outranks the healthy states and nothing else.

  It sits below every fault because a fault is the worse news and the toolbar
  has one mark to spend: a reviewer whose agent has disconnected is not helped
  by being told a second one is waiting to be introduced. It sits above working
  and idle because otherwise the steady-state mark would stay green while the
  reviewer owed an answer, and they would never learn it without opening the
  sidebar (BIG-171).
  */
  if (primacy === "decision-owed") {
    return {
      indicator: "decision-owed",
      label: "Second agent needs an answer",
    };
  }
  if (activity.state === "working") {
    return { indicator: "working", label: "Agent working" };
  }
  // Waiting and idle both read as connected: a queued request is the agent
  // being available, not the agent being at fault.
  return { indicator: "healthy", label: "Agent connected" };
};

const requestHeadline = (request: AgentActivityRequest): string =>
  request.kind === "feedback"
    ? "Responding to a comment"
    : request.kind === "reply"
      ? "Responding in a comment thread"
      : request.kind === "push"
        ? "Preparing a pushed plan change"
        : request.kind === "approval"
          ? "Acknowledging a plan approval"
          : "Answering a plan question";

const requestFacts = (request: AgentActivityRequest): ActivityRequestFacts => ({
  requestId: request.requestId,
  requestKind: request.kind,
  ...(request.targetLabel === undefined
    ? {}
    : { targetLabel: request.targetLabel }),
});

const meaningfulWork = (
  event: AgentActivityProgress,
  requestId: string,
): boolean =>
  event.requestId === requestId &&
  (event.state === "live" || event.state === "waiting") &&
  progressStepCodeIsAgentOwned(event.stepCode);

const stalledHint =
  "Check the agent terminal - it may be waiting for your approval, out of usage or rate-limited, or stopped. This updates by itself once the agent resumes.";

// The stalled hint promises a self-resolving wait, which nothing will keep once
// a claim is this old. Past the recovery horizon the reviewer needs the route
// forward and the cost of taking it, not another reassurance (BIG-147).
const abandonedHint =
  "The agent has reported nothing for far longer than a turn takes. Connect a coding agent from Agent Status to pick this up; doing so takes the work over, so anything the original agent has in flight is dropped rather than delivered.";

// The two reasons a connection edge can carry, and the rule that picks one.
// A disconnect Big Plan inferred from silence and one the agent's own loop
// reported are different facts, and the reviewer's log is worth only as much
// as it keeps them apart.
export const AGENT_SESSION_ENDED_REASON = "The agent session ended";
export const AGENT_NO_SIGNAL_REASON = `No agent signal within ${AGENT_STALL_WINDOW_LABEL}`;

/**
 * The reasons a connection edge can carry, ordered by how much each is known
 * rather than inferred.
 *
 * The order is the same precedence `agentDisconnectReason` picks by, stated
 * once so the two cannot drift: silence is the weakest account of a connection
 * that stopped, the loop's own report of its end is stronger, and the
 * reviewer's decision to end it is the strongest, because it is the only one
 * that was a fact before Big Plan looked.
 */
const CONNECTION_END_REASONS: ReadonlyArray<string> = [
  AGENT_NO_SIGNAL_REASON,
  AGENT_SESSION_ENDED_REASON,
  AGENT_DISCONNECTED_REASON,
];

/**
 * True when a new reason for an already-ended connection says more than the
 * reason the log has recorded for it.
 *
 * A log that appended on any change of reason could be talked backwards: the
 * connection check runs several times a second, and one quiet reading landing
 * after a reported end would leave the story finishing on the inference it
 * replaced. Movement is one way, toward what is known, so the same silence
 * gains at most one row per reason and the last row is always its best account.
 *
 * A reason from outside the ordered set moves nothing, which keeps an
 * unrecognized string from displacing an account the reviewer can rely on.
 *
 * An edge that named no reason is the log opening on a review no agent has
 * reached yet. It ranks with silence rather than below it, so the check that
 * runs several times a second cannot follow it with a row inferring that a
 * signal was lost from an agent that never arrived - while an end somebody
 * reported still earns its row.
 */
export const agentConnectionReasonSupersedes = ({
  recorded,
  next,
}: {
  /** The reason on the last recorded edge, absent when it named none. */
  readonly recorded?: string;
  readonly next: string;
}): boolean =>
  CONNECTION_END_REASONS.indexOf(next) >
  (recorded === undefined ? 0 : CONNECTION_END_REASONS.indexOf(recorded));

/**
 * Names why presence stopped, from what the review already knows.
 *
 * A disconnect the reviewer asked for outranks both other readings, and it
 * outranks them whether or not the agent got as far as acknowledging: the
 * reviewer's own act is the fact, so the end is reported rather than inferred
 * even when the agent was killed before it could report anything (BIG-190).
 */
export const agentDisconnectReason = ({
  endedAtMs,
  disconnectRequestedAtMs,
}: {
  readonly endedAtMs?: number;
  /** When the reviewer asked this agent to disconnect, if they did. */
  readonly disconnectRequestedAtMs?: number;
}): string =>
  disconnectRequestedAtMs !== undefined
    ? AGENT_DISCONNECTED_REASON
    : endedAtMs === undefined
      ? AGENT_NO_SIGNAL_REASON
      : AGENT_SESSION_ENDED_REASON;

/**
 * Dates a connection edge from the report when there is one.
 *
 * Only the observer of an event knows when it happened. A checker that polls
 * can date what it inferred no better than the moment it looked, but it must
 * not overwrite a reported instant with that, or the durable log lands one
 * polling interval behind the fact and behind the instant every browser has
 * already projected for it.
 */
export const agentConnectionEdgeAtMs = ({
  endedAtMs,
  nowMs,
}: {
  readonly endedAtMs?: number;
  readonly nowMs: number;
}): number =>
  endedAtMs === undefined || !Number.isFinite(endedAtMs) ? nowMs : endedAtMs;

/** Expires a browser-held presence snapshot at the same lease as the store. */
export const agentPresenceIsFresh = ({
  connected,
  heartbeatAt,
  now,
}: {
  readonly connected: boolean;
  readonly heartbeatAt: number;
  readonly now: number;
}): boolean =>
  connected &&
  Number.isFinite(heartbeatAt) &&
  Number.isFinite(now) &&
  heartbeatAt > 0 &&
  Math.max(0, now - heartbeatAt) <= AGENT_STALL_MS;

/**
 * Reconciles persisted connection events with the current presence lease.
 *
 * Presence is the only evidence admitted here. Work an agent is holding says
 * nothing about whether anyone is still attached - a claim outlives the process
 * that took it - so it may inform the activity reading but never this one
 * (BIG-147).
 */
export const projectAgentConnectionState = ({
  presenceConnected,
  heartbeatAt,
  endedAtMs,
  now,
  events,
}: {
  readonly presenceConnected: boolean;
  readonly heartbeatAt: number;
  /** When the agent's own loop reported the session ending, if it did. */
  readonly endedAtMs?: number;
  readonly now: number;
  readonly events: ReadonlyArray<BrowserConnectionEvent>;
}): {
  readonly connected: boolean;
  readonly events: ReadonlyArray<BrowserConnectionEvent>;
} => {
  const connected = agentPresenceIsFresh({
    connected: presenceConnected,
    heartbeatAt,
    now,
  });
  let latest: { readonly connected: boolean; readonly atMs: number } | null =
    null;
  for (const event of events) {
    const atMs = Date.parse(event.at);
    if (Number.isFinite(atMs) && (latest === null || atMs >= latest.atMs)) {
      latest = { connected: event.connected, atMs };
    }
  }
  if (latest === null || latest.connected === connected) {
    return { connected, events };
  }

  const leaseExpired =
    Number.isFinite(heartbeatAt) &&
    Number.isFinite(now) &&
    heartbeatAt > 0 &&
    now - heartbeatAt > AGENT_STALL_MS;
  // An observed end is dated by the loop that observed it. Aging only ever
  // estimates when presence lapsed, so a reported instant outranks it.
  const observedAtMs = connected
    ? heartbeatAt
    : (endedAtMs ?? (leaseExpired ? heartbeatAt + AGENT_STALL_MS + 1 : now));
  const projectedAtMs = Math.max(observedAtMs, latest.atMs + 1);
  const projectedAt = new Date(projectedAtMs);
  if (Number.isNaN(projectedAt.getTime())) return { connected, events };

  return {
    connected,
    events: [
      ...events,
      {
        eventId: `presence-${connected ? "connected" : "disconnected"}-${projectedAtMs}`,
        connected,
        at: projectedAt.toISOString(),
        ...(!connected && (endedAtMs !== undefined || leaseExpired)
          ? {
              reason: agentDisconnectReason({
                ...(endedAtMs === undefined ? {} : { endedAtMs }),
              }),
            }
          : {}),
      },
    ],
  };
};

/**
 * Reports the silence itself rather than a verdict about the agent. Nothing
 * renews a claim while the turn runs, so a quiet lease is evidence of quiet and
 * of nothing else - and telling the reviewer to reconnect here would invite a
 * second agent to take the plan from the one still working (adr/0002).
 */
const stalledSupporting = ({
  signalAtMs,
  now,
}: {
  readonly signalAtMs: number;
  readonly now: number;
}): string => {
  const quietFor = compactDurationLabel({
    start: signalAtMs,
    end: Math.max(now, signalAtMs),
  });
  return quietFor === null
    ? `The agent picked this up and has not reported progress since. ${stalledHint}`
    : `The agent picked this up and has reported nothing for ${quietFor}. ${stalledHint}`;
};

/**
 * Explains a lost lease without claiming why the external agent stopped.
 *
 * When a claim is still open this reading is only reached past the recovery
 * horizon, so the reviewer is one click from a recovery prompt that would take
 * that claim over. The card has to tell the same story as the prompt below it
 * rather than end on a bare invitation to reconnect (BIG-147).
 */
/*
Explains a lost lease without claiming why the external agent stopped, and
without measuring it. How long the reader has been without an agent, and the
threshold that decided it, both read as diagnostics to explain away rather than
as a state to act on; the card's own SINCE field already says when the agent was
last here, so the copy says what happened and what to do about it.

The takeover sentence stays: it is not a measurement but a consequence, and a
reviewer who connects over held work has to be told what it costs them.
*/
const disconnectedSupporting = ({
  heartbeatAt,
  endedAtMs,
  disconnectRequestedAtMs,
  now,
  claimStillOpen,
}: {
  readonly heartbeatAt: number;
  readonly endedAtMs?: number;
  /** When the reviewer asked this agent to disconnect, if they did. */
  readonly disconnectRequestedAtMs?: number;
  readonly now: number;
  readonly claimStillOpen: boolean;
}): string => {
  const takeover = claimStillOpen
    ? " An agent still holds work here, so connecting a session takes that work over and its answer will no longer be accepted."
    : "";
  /*
  An end the reviewer performed is never explained as one Big Plan inferred.

  Every sentence below this exists to account for an absence nobody witnessed -
  how long the signal has been gone, which threshold decided it, whether the
  session may merely be idle - and offers a reconnect as the way out. Said to a
  reviewer who has just disconnected the agent on purpose, all of it reads as
  the product failing to notice what they did, and the invitation to reconnect
  reads as an instruction to undo it (BIG-171).
  */
  if (disconnectRequestedAtMs !== undefined) {
    return `You disconnected this agent. Connect another when you want your comments answered.${takeover} All comments are safe.`;
  }
  // The threshold sentence explains an inference. Once the loop has reported
  // its own end there is no inference left to explain, and naming the
  // threshold anyway would offer the reviewer a guess in place of a fact.
  if (endedAtMs !== undefined) {
    const endedFor = compactDurationLabel({
      start: endedAtMs,
      end: Math.max(now, endedAtMs),
    });
    return endedFor === null
      ? `The agent session ended. Reconnect the coding agent to continue.${takeover} All comments are safe.`
      : `The agent session ended ${endedFor} ago. Reconnect the coding agent to continue.${takeover} All comments are safe.`;
  }
  const quietFor = compactDurationLabel({
    start: heartbeatAt,
    end: Math.max(now, heartbeatAt),
  });
  return quietFor === null
    ? `Reconnect the coding agent to continue.${takeover} All comments are safe.`
    : `No agent signal for ${quietFor} (disconnect threshold: ${AGENT_STALL_WINDOW_LABEL}); the session may have ended or gone idle. Reconnect to continue.${takeover} All comments are safe.`;
};

/**
 * Answers whether this session has ever recorded an agent being present.
 *
 * The presence lease cannot answer it: a lease that has expired and a lease
 * that was never taken both read as absent. Only the connection log
 * distinguishes them, and the difference decides whether the reader is told a
 * connection ended or that none has begun.
 */
export const agentHasEverConnected = ({
  events,
}: {
  readonly events: ReadonlyArray<BrowserConnectionEvent>;
}): boolean => events.some((event) => event.connected);

/** What the plan's open claims say about why nothing is being reported. */
export type HeldWorkQuiet =
  /** Nobody has picked anything up, so held work explains nothing. */
  | "none"
  /** Someone picked work up recently enough that the quiet is accounted for. */
  | "explained"
  /** A claim is open but so old it no longer accounts for anything. */
  | "stale";

type OpenClaimedRequest = ClaimedRequest &
  TerminalAgentRequest & { readonly requestId: string };

/**
 * The one definition of what held work says about a silence. Deliberately blind
 * to the lease, and bounded by the recovery horizon so a claim nothing ever
 * reaps cannot explain silence forever.
 *
 * An explanation may inform the activity reading, hold a later message in the
 * queue rather than calling it blocked, and put the takeover warning on advice
 * that would otherwise read as a bare invitation to reconnect. It is never
 * evidence that an agent is attached, and it must not reach any connection
 * surface (BIG-147).
 */
export const heldWorkQuiet = ({
  requests,
  cancelPendingRequestIds,
  now,
}: {
  readonly requests: ReadonlyArray<OpenClaimedRequest>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly now: number;
}): HeldWorkQuiet => {
  const open = requests.filter(
    (request) =>
      !requestIsTerminal(request) &&
      !cancelPendingRequestIds.has(request.requestId) &&
      requestWasClaimed(request),
  );
  if (open.length === 0) return "none";
  return open.some((request) => claimExplainsQuiet({ request, nowMs: now }))
    ? "explained"
    : "stale";
};

/** True while held work still accounts for the plan being quiet. */
export const agentHoldsClaimedWork = (input: {
  readonly requests: ReadonlyArray<OpenClaimedRequest>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly now: number;
}): boolean => heldWorkQuiet(input) === "explained";

/** Selects the first live, nonterminal claim. */
export const selectActiveAgentRequest = <Request extends AgentActivityRequest>({
  requests,
  cancelPendingRequestIds,
  now,
}: {
  readonly requests: ReadonlyArray<Request>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly now: number;
}): Request | undefined =>
  requests.find(
    (request) =>
      !requestIsTerminal(request) &&
      !cancelPendingRequestIds.has(request.requestId) &&
      claimIsLive({ request, nowMs: now }),
  );

/** The open requests a selector may still choose between. */
const openAgentRequests = <Request extends AgentActivityRequest>({
  requests,
  cancelPendingRequestIds,
  accepts,
}: {
  readonly requests: ReadonlyArray<Request>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly accepts: (request: Request) => boolean;
}): ReadonlyArray<Request> =>
  requests.filter(
    (request) =>
      !requestIsTerminal(request) &&
      !cancelPendingRequestIds.has(request.requestId) &&
      accepts(request),
  );

/**
 * Selects the work an agent is holding, preferring a renewed lease over one
 * that has lapsed. A lapsed lease says nothing about the holder, so a quiet
 * turn keeps its request here rather than falling back to the queue - but only
 * while the claim is still inside the recovery horizon, because past it the
 * pickup no longer accounts for anything.
 *
 * Among lapsed claims it takes the most recent pickup rather than the first in
 * list order. Requests arrive oldest-first, so list order would describe an
 * abandoned claim's age and link its thread while a later turn is the one
 * actually in flight (BIG-147).
 */
export const selectClaimedAgentRequest = <
  Request extends AgentActivityRequest,
>({
  requests,
  cancelPendingRequestIds,
  now,
}: {
  readonly requests: ReadonlyArray<Request>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly now: number;
}): Request | undefined =>
  selectActiveAgentRequest({ requests, cancelPendingRequestIds, now }) ??
  openAgentRequests({
    requests,
    cancelPendingRequestIds,
    accepts: (request) => claimExplainsQuiet({ request, nowMs: now }),
  }).reduce<Request | undefined>(
    (newest, request) =>
      newest === undefined ||
      (claimSignalAtMs(request) ?? 0) > (claimSignalAtMs(newest) ?? 0)
        ? request
        : newest,
    undefined,
  );

/** Selects live work before falling back to the oldest queued request. */
export const selectPendingAgentRequest = <
  Request extends AgentActivityRequest,
>({
  requests,
  cancelPendingRequestIds,
  now,
}: {
  readonly requests: ReadonlyArray<Request>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly now: number;
}): Request | undefined =>
  selectActiveAgentRequest({ requests, cancelPendingRequestIds, now }) ??
  openAgentRequests({
    requests,
    cancelPendingRequestIds,
    accepts: () => true,
  })[0];

/** Derives the single current-work card from immutable runtime facts. */
export const deriveCurrentAgentActivity = ({
  requests,
  cancelPendingRequestIds,
  progressEvents,
  agentConnected,
  runtimeOffline,
  now,
  heartbeatAt,
  endedAtMs,
  disconnectRequestedAtMs,
  everConnected,
}: {
  readonly requests: ReadonlyArray<AgentActivityRequest>;
  /** The answers already settled, for the readings a step cannot be trusted for. */
  readonly responses?: ReadonlyArray<AgentActivityAnswer>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly progressEvents: ReadonlyArray<AgentActivityProgress>;
  readonly agentConnected: boolean;
  readonly runtimeOffline: boolean;
  readonly now: number;
  readonly heartbeatAt: number;
  /** When the agent's own loop reported the session ending, if it did. */
  readonly endedAtMs?: number;
  /**
   * When the reviewer asked this agent to disconnect, if they did.
   *
   * It is the difference between an absence Big Plan noticed and one the
   * reviewer created, and only the second can be stated as a fact.
   */
  readonly disconnectRequestedAtMs?: number;
  readonly everConnected: boolean;
}): CurrentAgentActivity => {
  if (runtimeOffline) {
    return {
      state: "offline",
      tone: "danger",
      headline: REVIEW_SESSION_UNREACHABLE_HEADLINE,
      supporting: REVIEW_SESSION_UNREACHABLE_SUPPORTING,
    };
  }
  // Work that has been picked up is judged by its own narration, and never
  // falls through to the presence question below. The two ask different things
  // - "is anyone attached" against "has this turn reported lately" - and the
  // plan-wide heartbeat can only answer the first, because the agent's own
  // process is gone for the length of the turn (BIG-147).
  const claimed = selectClaimedAgentRequest({
    requests,
    cancelPendingRequestIds,
    now,
  });
  if (claimed !== undefined) {
    const facts = requestFacts(claimed);
    const failed = progressEvents
      .filter(
        (event) =>
          event.requestId === claimed.requestId && event.state === "failed",
      )
      .at(-1);
    if (failed !== undefined) {
      return {
        ...facts,
        state: "errored",
        tone: "danger",
        headline: "The agent reported a problem",
        supporting:
          failed.step +
          (failed.detail === undefined ? "" : ` - ${failed.detail}`),
      };
    }
    const signalAtMs = claimSignalAtMs(claimed) ?? 0;
    if (!claimIsLive({ request: claimed, nowMs: now })) {
      return {
        ...facts,
        state: "stalled",
        tone: "warning",
        headline: "Agent may be stalled",
        supporting: stalledSupporting({ signalAtMs, now }),
        updatedAtMs: signalAtMs,
      };
    }
    const meaningful = progressEvents.filter((event) =>
      meaningfulWork(event, claimed.requestId),
    );
    const latest = meaningful.at(-1);
    return {
      ...facts,
      state: "working",
      tone: "working",
      headline: requestHeadline(claimed),
      latestStep: latest?.step ?? "Picked up by the agent",
      updatedAtMs: signalAtMs,
    };
  }

  const request = selectPendingAgentRequest({
    requests,
    cancelPendingRequestIds,
    now,
  });
  if (!agentPresenceIsFresh({ connected: agentConnected, heartbeatAt, now })) {
    // A claim is evidence too. An agent that picked work up was demonstrably
    // here, even in a session whose log never recorded the edge that would have
    // said so, and telling that reader no agent has ever connected would be
    // exactly the false assertion this state exists to avoid.
    if (!everConnected && !requests.some(requestWasClaimed)) {
      return {
        state: "never-connected",
        tone: "neutral",
        headline: "No agent has connected to this session yet.",
        supporting: "Connect one to continue. All comments are safe.",
      };
    }
    return {
      state: "disconnected",
      tone: "danger",
      /* "Has disconnected" reports something the agent did. When the reviewer
         is the one who did it, the headline says so rather than handing their
         own decision back to them as news. */
      headline:
        disconnectRequestedAtMs === undefined
          ? "The agent has disconnected."
          : "Agent disconnected",
      supporting: disconnectedSupporting({
        heartbeatAt,
        ...(endedAtMs === undefined ? {} : { endedAtMs }),
        ...(disconnectRequestedAtMs === undefined
          ? {}
          : { disconnectRequestedAtMs }),
        now,
        claimStillOpen:
          heldWorkQuiet({ requests, cancelPendingRequestIds, now }) === "stale",
      }),
    };
  }
  if (request === undefined) {
    return {
      state: "idle",
      tone: "neutral",
      headline: "Agent connected",
      supporting: "The agent is connected and waiting for feedback.",
    };
  }
  return {
    ...requestFacts(request),
    state: "waiting",
    tone: "neutral",
    headline: "Waiting for agent",
    supporting:
      "Feedback is queued and will start when the agent is available.",
  };
};

/**
 * Whether an agent is attached for the reviewer to act on.
 *
 * The three excluded states are the ones with nobody on the other end: no agent
 * has ever connected, the agent has gone, or the review session itself is
 * unreachable. Every other state has an agent the reviewer can address, however
 * well or badly it is doing.
 */
export const agentActivityIsAttached = (
  activity: Pick<CurrentAgentActivity, "state">,
): boolean =>
  activity.state !== "never-connected" &&
  activity.state !== "disconnected" &&
  activity.state !== "offline";

/**
 * Whether disconnecting right now would drop an answer already in flight.
 *
 * It is the presence of a live claim that costs something, not the health of
 * the agent holding it: a stalled or errored turn is still a turn whose work
 * goes when its agent does. A queued request nobody has picked up costs
 * nothing, because it stays queued for the next agent (BIG-190).
 */
export const agentDisconnectDropsWork = (
  activity: Pick<CurrentAgentActivity, "state">,
): boolean =>
  activity.state === "working" ||
  activity.state === "stalled" ||
  activity.state === "errored";

export type AgentStatusStage =
  | "idle"
  | "waiting"
  | "blocked"
  | "working"
  | "stalled"
  | "failed"
  | "offline"
  | "answered";

export type AgentStatus = {
  readonly stage: AgentStatusStage;
  readonly label: string;
  readonly headline: string;
  readonly detail: string;
  readonly tone: "neutral" | "positive" | "warning" | "danger";
};

export type AgentStatusInput = {
  readonly runtime: "static" | "online" | "offline";
  readonly request: "none" | "pending" | "answered";
  /**
   * What kind of work the request is, where the answer changes what an answer
   * means. An acknowledgment is not a response the reviewer can read or reply
   * to, so the settled reading for one cannot be the settled reading for a
   * question (BIG-131).
   */
  readonly requestKind?: AgentActivityRequest["kind"];
  readonly agentConnected: boolean;
  readonly pickedUp: boolean;
  /**
   * Whether some other request on this plan is being held by an agent. It
   * separates "nobody has picked this up and nobody is here" from "nobody has
   * picked this up because someone is busy" - a queue question, not a
   * connection verdict - and never travels to a connection surface.
   */
  readonly workIsHeld?: boolean;
  /** How many unanswered messages the agent delivers before this one. */
  readonly queuedAhead?: number;
  readonly surface?: "thread" | "chat";
  readonly lastAgentSignalAtMs?: number;
  readonly failure?: string;
  readonly nowMs: number;
};

/**
 * The settled label an acknowledgment wears, named once because two surfaces
 * read it: the strip that prints it, and the session pill that must not
 * summarize it as a response there is something to re-review (BIG-131).
 */
export const ACKNOWLEDGED_STATUS_LABEL = "Acknowledged";

/** Derives status from observable runtime, request, and agent-channel facts. */
export const deriveAgentStatus = (input: AgentStatusInput): AgentStatus => {
  if (input.runtime === "static") {
    return {
      stage: "idle",
      label: "Offline file",
      headline: "Open the local review runtime to contact the agent",
      detail: "Your browser drafts remain safe on this device.",
      tone: "neutral",
    };
  }
  if (input.runtime === "offline") {
    return {
      stage: "offline",
      /* The same words the sidebar and the toolbar use for this state. A
         thread strip reading "Runtime offline" beside a rail reading "Agent is
         unreachable" left the reviewer to work out that one condition was
         being reported twice in two vocabularies (BIG-273). */
      label: REVIEW_SESSION_UNREACHABLE_HEADLINE,
      headline: REVIEW_SESSION_UNREACHABLE_HEADLINE,
      detail: REVIEW_SESSION_UNREACHABLE_SUPPORTING,
      tone: "danger",
    };
  }
  if (input.failure !== undefined) {
    return {
      stage: "failed",
      label: "Needs attention",
      headline: "The agent reported a problem",
      detail: input.failure,
      tone: "danger",
    };
  }
  if (input.request === "answered") {
    if (input.requestKind === "approval") {
      return {
        stage: "answered",
        label: ACKNOWLEDGED_STATUS_LABEL,
        headline: "Approval acknowledged",
        detail:
          "The agent has the approved plan and the decisions recorded with it.",
        tone: "positive",
      };
    }
    return {
      stage: "answered",
      label: "Response ready",
      headline: "The agent has answered",
      detail: "Review the response and continue the thread if needed.",
      tone: "positive",
    };
  }
  if (input.request === "none") {
    return {
      stage: "idle",
      label: input.agentConnected ? "Agent connected" : "No agent connected",
      headline: input.agentConnected
        ? "Ready for feedback"
        : "Connect a coding agent when you are ready to send",
      detail: input.agentConnected
        ? "The agent is waiting for a review request."
        : "Draft comments remain local until you send them.",
      tone: input.agentConnected ? "positive" : "neutral",
    };
  }
  if (!input.pickedUp) {
    // Held work explains the silence, so this message is queued behind a turn
    // rather than undeliverable. Calling it blocked would be a connection
    // verdict drawn from the same quiet the agent's own turn produces.
    if (!input.agentConnected && input.workIsHeld !== true) {
      return {
        stage: "blocked",
        label: "Blocked",
        headline: "Blocked - no agent connected",
        detail:
          "Your comment is saved and sends itself as soon as an agent reconnects. Nothing is lost.",
        tone: "warning",
      };
    }
    // The position is what makes a queue feel like a queue rather than a
    // stall, so it replaces the bare label whenever anything is ahead.
    const ahead = input.queuedAhead ?? 0;
    return {
      stage: "waiting",
      label: ahead > 0 ? `Queued, ${ahead} ahead` : "Waiting",
      headline: "Waiting for an agent",
      detail: "",
      tone: "neutral",
    };
  }
  const quietFor =
    input.lastAgentSignalAtMs === undefined
      ? null
      : Math.max(0, input.nowMs - input.lastAgentSignalAtMs);
  if (quietFor === null || quietFor > AGENT_STALL_MS) {
    // Past the recovery horizon the pickup has stopped explaining the quiet
    // everywhere else, so this surface drops the promise that it resolves
    // itself. Measured from the claim's own last signal, never from the lease,
    // which a quiet turn has by definition already let lapse (BIG-147).
    const abandoned = quietFor !== null && quietFor > AGENT_RECOVERY_HORIZON_MS;
    return {
      stage: "stalled",
      label: abandoned ? "No longer reporting" : "Working",
      headline:
        quietFor === null
          ? "No progress reported yet"
          : `No progress for ${Math.max(1, Math.round(quietFor / 60_000))}m`,
      // No claim about the session itself: the same silence that reaches this
      // branch is the only evidence there is either way (BIG-147).
      detail: abandoned ? abandonedHint : stalledHint,
      tone: abandoned ? "danger" : "warning",
    };
  }
  return {
    stage: "working",
    label: "Agent working",
    headline:
      input.surface === "chat"
        ? "Agent is working on your feedback"
        : "Agent is working on this",
    detail: "",
    tone: "positive",
  };
};
