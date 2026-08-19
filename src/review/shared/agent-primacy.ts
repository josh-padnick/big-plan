// Owns who speaks for a plan when more than one agent is attached to it.
//
// Every other fact in this subsystem has one authority: request terminality is
// `answeredAt` or `canceledAt`, pickup is a live durable claim, and the plan
// source has one writer. Primacy had none. It was decided by whichever agent
// process wrote the shared presence record most recently, which is why two
// live connection loops answered as each other and reaped each other's turns
// at the lease boundary (BIG-171).
//
// This module is that missing authority, and nothing here stores state or
// depends on the browser or Node. It answers three questions from plain data:
// whether two loops are really contending, which attached agent is the
// primary, and whether the reviewer is being asked to decide something.

import { AGENT_RECOVERY_HORIZON_MS, AGENT_STALL_MS } from "./agent-timing.js";
import { agentModelDisplayName } from "./agent-identity-catalog.js";
import type { AgentModelIdentity } from "./agent-model.js";

/**
 * What an attached agent is allowed to do.
 *
 * A primary owns the plan's work: it may claim a request, renew that claim,
 * and publish. An observer is attached and reading - the plan, the
 * conversation, request state - and may do none of those things. The role is
 * the whole permission model, so a reader of this type has read the rule.
 */
export type AgentRole = "primary" | "observer";

/**
 * How long a presence record stays fresh enough to prove its writer is alive,
 * for the contention test alone.
 *
 * The connection loop writes twice a second, so two cadences is the smallest
 * window that cannot be crossed by a dead process: a writer that returns
 * within it was demonstrably running when the record that displaced it was
 * written. Nothing here uses AGENT_STALL_MS's 75 seconds, because that window
 * answers a different question - has anyone been here lately - and would call
 * an ordinary reconnect a contention.
 */
export const AGENT_CONTENTION_WINDOW_MS = 1_500;

/** The plan-wide presence facts the contention rule reads. */
export type ContendedPresence = {
  /** The writer the stored record currently names. */
  readonly writerId?: string;
  /** The writer the stored record displaced when it was written. */
  readonly displacedWriterId?: string;
  readonly updatedAtMs?: number;
};

/**
 * True when a presence write proves two connection loops are live at once.
 *
 * The rule is a return trip, and the asymmetry is the whole point. A writer
 * changing once is the healthiest transition Big Plan has: a fresh connector
 * replacing one that died writes a different id, and so does the loop that
 * takes over after an observed end. Treating that as contention would put a
 * warning on a clean reconnect.
 *
 * A writer coming BACK - writing again while the record that displaced it is
 * still fresh - cannot be explained that way. Nothing dead reclaims a record
 * it already lost, so both writers were running inside the same window. That
 * is contention, proven rather than inferred.
 *
 * The freshness bound is required, not decorative. Without it, two loops that
 * ran hours apart and happened to alternate across a long-idle store would
 * read as contending.
 */
export const writersAreContending = ({
  stored,
  writerId,
  nowMs,
}: {
  readonly stored: ContendedPresence;
  /** The writer performing this presence write. */
  readonly writerId: string;
  readonly nowMs: number;
}): boolean => {
  const { writerId: storedWriterId, displacedWriterId, updatedAtMs } = stored;
  if (
    storedWriterId === undefined ||
    displacedWriterId === undefined ||
    updatedAtMs === undefined ||
    !Number.isFinite(updatedAtMs)
  ) {
    return false;
  }
  // A writer that never left cannot have returned.
  if (writerId === storedWriterId) return false;
  // Only the writer the stored record displaced proves a return trip. A third
  // writer arriving is one more handover, not evidence about the first two.
  if (writerId !== displacedWriterId) return false;
  const age = nowMs - updatedAtMs;
  return age >= 0 && age <= AGENT_CONTENTION_WINDOW_MS;
};

/** One agent attached to a review, as the store records it. */
export type AttachedAgent = {
  /** The connection loop's own identity, minted per invocation. */
  readonly writerId: string;
  readonly role: AgentRole;
  /** When this agent first attached to the review. */
  readonly attachedAtMs: number;
  /** When it last proved it was alive. */
  readonly signalAtMs: number;
  /** When it asked to become the primary, if it has. */
  readonly requestedPrimacyAtMs?: number;
  /**
   * The pickup token this loop last claimed with.
   *
   * It is what lets `agent note` and `agent respond` - separate processes that
   * know their token and not their loop - find out whose role they are acting
   * under, so a displaced agent can be told at its next command instead of at
   * publication.
   */
  readonly claimToken?: string;
  readonly model?: AgentModelIdentity;
};

/** The attached agent acting under one pickup token, if it is still attached. */
export const agentForClaimToken = ({
  agents,
  claimToken,
}: {
  readonly agents: ReadonlyArray<AttachedAgent>;
  readonly claimToken: string;
}): AttachedAgent | undefined =>
  agents.find((agent) => agent.claimToken === claimToken);

/**
 * How many characters of a writer id are worth showing.
 *
 * Enough to separate two agents in one review, and no more. The id is a
 * disambiguator, not an identifier the reader is expected to use, so it earns
 * a glance rather than a line.
 */
const SHORT_WRITER_ID_LENGTH = 6;

/**
 * Names one attached agent well enough to tell it from another.
 *
 * The model alone is not an identity here. Two connectors running the same
 * model is the ordinary case - a reviewer opening a second terminal - and a
 * card offering "Make GPT-5.6-sol the primary" beside another GPT-5.6-sol asks
 * them to choose between two identical labels. The short writer id is what
 * makes the choice answerable.
 *
 * An agent that declared no model is named by its id alone rather than by an
 * invented word like "Unknown agent": the id is true, and the placeholder
 * would only look like a name.
 */
export const agentModelLabel = (
  agent: Pick<AttachedAgent, "writerId" | "model">,
): string => {
  const short = `…${agent.writerId.slice(0, SHORT_WRITER_ID_LENGTH)}`;
  const name = agent.model?.name;
  return name === undefined
    ? short
    : `${agentModelDisplayName(name)} (${short})`;
};

/**
 * True while an attached agent has reported recently.
 *
 * This is a presentation fact and nothing else: it decides what a card says
 * about an agent, never whether that agent still holds the plan. `agent next`
 * hands its work item to the harness and the process exits, so nothing renews
 * anything for the length of a turn (BIG-147) - which means every working
 * agent fails this test, and deciding primacy by it would hand the plan to a
 * newcomer exactly while the primary was busy answering.
 */
export const agentIsLive = ({
  agent,
  nowMs,
  maximumAgeMs = AGENT_STALL_MS,
}: {
  readonly agent: Pick<AttachedAgent, "signalAtMs">;
  readonly nowMs: number;
  readonly maximumAgeMs?: number;
}): boolean => {
  const age = nowMs - agent.signalAtMs;
  return age >= 0 && age <= maximumAgeMs;
};

/**
 * True while an agent is still a member of this review.
 *
 * Membership is what every primacy question is answered from, and it is
 * deliberately far more patient than liveness. A quiet agent is usually an
 * agent mid turn, and dropping it after 75 seconds would delete the plan's
 * own primary while it was working - re-creating, by a different route, the
 * interleaving this whole change removes.
 *
 * The recovery horizon is the bound that already exists for exactly this
 * judgment: past it, silence has stopped meaning "busy" everywhere else the
 * reviewer can see (BIG-147), so it is the honest moment to stop counting an
 * agent as here.
 */
export const agentIsAttached = ({
  agent,
  nowMs,
}: {
  readonly agent: Pick<AttachedAgent, "signalAtMs">;
  readonly nowMs: number;
}): boolean =>
  agentIsLive({ agent, nowMs, maximumAgeMs: AGENT_RECOVERY_HORIZON_MS });

/**
 * The agents a reviewer should be shown, oldest attachment first.
 *
 * Order is by attachment rather than by role, because the rail lists agents as
 * a history of who arrived and the reviewer's mental model is "who was here,
 * and who turned up". Ties fall back to the writer id so the order is total
 * and two records written in the same millisecond cannot swap between polls.
 */
export const orderAttachedAgents = (
  agents: ReadonlyArray<AttachedAgent>,
): ReadonlyArray<AttachedAgent> =>
  [...agents].sort(
    (left, right) =>
      left.attachedAtMs - right.attachedAtMs ||
      left.writerId.localeCompare(right.writerId),
  );

/** The live agent holding primacy, when there is one. */
export const selectPrimaryAgent = ({
  agents,
  nowMs,
}: {
  readonly agents: ReadonlyArray<AttachedAgent>;
  readonly nowMs: number;
}): AttachedAgent | undefined =>
  orderAttachedAgents(agents).find(
    (agent) => agent.role === "primary" && agentIsAttached({ agent, nowMs }),
  );

/** The live observers, in the order the rail lists them. */
export const selectObserverAgents = ({
  agents,
  nowMs,
}: {
  readonly agents: ReadonlyArray<AttachedAgent>;
  readonly nowMs: number;
}): ReadonlyArray<AttachedAgent> =>
  orderAttachedAgents(agents).filter(
    (agent) => agent.role === "observer" && agentIsAttached({ agent, nowMs }),
  );

/**
 * The oldest live observer waiting on an answer about primacy.
 *
 * Only one is surfaced at a time. A reviewer asked two questions at once
 * cannot tell which answer applies to which agent, and the second question is
 * still there after the first is answered.
 */
export const pendingPrimacyRequest = ({
  agents,
  nowMs,
}: {
  readonly agents: ReadonlyArray<AttachedAgent>;
  readonly nowMs: number;
}): AttachedAgent | undefined =>
  selectObserverAgents({ agents, nowMs }).find(
    (agent) => agent.requestedPrimacyAtMs !== undefined,
  );

/**
 * What the Agent Status control in the toolbar shows.
 *
 * Two states and no third, by the reviewer's own rule: everything is fine, or
 * something needs them. Counts, names, and roles live on the cards, because a
 * toolbar that reports standing facts is noise in the steady state and the
 * reader has to interpret it every time they glance at it.
 *
 * "Hazard" is reserved for a decision the reviewer actually owes. An attached
 * observer that has asked for nothing is a settled arrangement, not a problem,
 * so it keeps the calm mark.
 */
export type AgentPrimacyHealth = "settled" | "decision-owed";

export const agentPrimacyHealth = ({
  agents,
  nowMs,
}: {
  readonly agents: ReadonlyArray<AttachedAgent>;
  readonly nowMs: number;
}): AgentPrimacyHealth =>
  pendingPrimacyRequest({ agents, nowMs }) === undefined
    ? "settled"
    : "decision-owed";

/**
 * The role a connector gets when it attaches.
 *
 * First one in owns the plan; everyone after it observes. Primacy is never
 * taken by arriving, which is the behavior BIG-171 exists to remove: the
 * newcomer may ask, and the reviewer answers.
 */
export const roleForArrivingAgent = ({
  agents,
  nowMs,
}: {
  readonly agents: ReadonlyArray<AttachedAgent>;
  readonly nowMs: number;
}): AgentRole =>
  selectPrimaryAgent({ agents, nowMs }) === undefined ? "primary" : "observer";

/**
 * Applies a reviewer's decision to make one observer the primary.
 *
 * The demotion and the promotion are one step on purpose. Two writes would
 * leave an instant with two primaries or none, and every surface downstream
 * reads this list to answer "who is answering me" - a question that must never
 * have two answers, even for a poll.
 *
 * The request is cleared on both sides: the promoted agent got what it asked
 * for, and the demoted one never asked. A stale flag would keep the toolbar in
 * hazard after the reviewer had already decided.
 */
export const applyPrimacyHandoff = ({
  agents,
  writerId,
}: {
  readonly agents: ReadonlyArray<AttachedAgent>;
  /** The observer the reviewer chose. */
  readonly writerId: string;
}): ReadonlyArray<AttachedAgent> =>
  agents.map((agent) => {
    const { requestedPrimacyAtMs: _dropped, ...rest } = agent;
    if (agent.writerId === writerId) return { ...rest, role: "primary" };
    return agent.role === "primary" ? { ...rest, role: "observer" } : rest;
  });

/**
 * Applies a reviewer's decision to leave an agent where it is.
 *
 * Only the request is dropped. The agent stays attached and readable, which is
 * the answer the reviewer gave: not "go away", just "not you".
 */
export const applyPrimacyDeclined = ({
  agents,
  writerId,
}: {
  readonly agents: ReadonlyArray<AttachedAgent>;
  readonly writerId: string;
}): ReadonlyArray<AttachedAgent> =>
  agents.map((agent) => {
    if (agent.writerId !== writerId) return agent;
    const { requestedPrimacyAtMs: _declined, ...rest } = agent;
    return rest;
  });
