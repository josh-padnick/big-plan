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
// depends on the browser or Node. It answers two questions from plain data:
// which attached agent is the primary, and whether the reviewer is being asked
// to decide something.
//
// Contention is not one of them, and deliberately so. Under the observer model
// two live loops cannot interleave: the second one attaches without the right
// to claim, so there is nothing left to detect. The roster below is the whole
// evidence, and every agent on it signed its own record.

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

/** One agent attached to a review, as the store records it. */
export type AttachedAgent = {
  /**
   * This agent's identity on the roster, carried across its processes.
   *
   * One agent answers a reviewer through a series of short-lived commands -
   * `next` hands over the work and exits, `note` and `respond` are separate
   * processes again - so an id minted per invocation would rename the agent
   * several times a turn. It is minted by the first process that registers and
   * then adopted by every later one, which is what lets the browser hold a
   * handle on an agent for longer than one command.
   */
  readonly writerId: string;
  readonly role: AgentRole;
  /** When this agent first attached to the review. */
  readonly attachedAtMs: number;
  /** When it last proved it was alive. */
  readonly signalAtMs: number;
  /** When it asked to become the primary, if it has. */
  readonly requestedPrimacyAtMs?: number;
  /**
   * The pickup token this agent last claimed with.
   *
   * It is what lets `agent note` and `agent respond` - separate processes that
   * know their token and not their loop - find out whose role they are acting
   * under, so a displaced agent can be told at its next command instead of at
   * publication. It is also how the agent's own next `next` finds its way back
   * to this record instead of arriving as a stranger.
   */
  readonly claimToken?: string;
  /**
   * When the claim named above stopped being open, if it has.
   *
   * Holding an open claim is the one thing that makes an unheard-from agent
   * presumed busy rather than gone, so the roster has to know when that stops
   * being true. Without it, "has ever claimed" was read as "is mid turn", and
   * an agent that finished answering half an hour ago went on counting as the
   * plan's primary.
   */
  readonly claimClosedAtMs?: number;
  /**
   * A displaced agent's unpublished draft, handed to this agent as reference.
   *
   * Set only when the reviewer chose to carry it over. It is a path to read,
   * never a candidate to publish: the new primary starts from the last
   * published revision like any other pickup, and this is one more input it
   * may consult.
   */
  readonly inheritedDraftPath?: string;
  /**
   * When this agent arrived into a roster that could not yet say what it is.
   *
   * A record whose claim has just closed is either the incumbent between two
   * turns or an agent that has gone for good, and for the length of its return
   * trip nobody can tell which. An observer that arrives in that window is
   * therefore not yet known to be a second agent, so it holds its question
   * instead of putting "a second agent wants to answer you" in front of the
   * reviewer for the ordinary single-agent loop coming back (BIG-171).
   *
   * It is a deferral and not a refusal: once the roster can say, the question
   * is raised for real, or the record has become the primary and there is
   * nothing to ask.
   */
  readonly unsettledArrivalAtMs?: number;
  readonly model?: AgentModelIdentity;
};

/**
 * True while a record describes an agent between two turns.
 *
 * Its claim is closed and nothing has been heard from it since, which is the
 * one state where the roster genuinely does not know whether this agent is
 * coming back: the `next` command `respond` handed it reclaims this record
 * within a moment, and an agent that has stopped never touches it again.
 */
export const agentIsBetweenTurns = (
  agent: Pick<AttachedAgent, "signalAtMs" | "claimClosedAtMs">,
): boolean =>
  agent.claimClosedAtMs !== undefined &&
  agent.signalAtMs <= agent.claimClosedAtMs;

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
 *
 * Four, at the captain's measurement: six put a run of digits inside the
 * parentheses that the eye tried to read as a word, in a label that already
 * carries a model name and a client. Two agents in one review is the case this
 * has to separate, and four hex characters separate them.
 */
const SHORT_WRITER_ID_LENGTH = 4;

/**
 * Names one attached agent, always carrying the disambiguating id.
 *
 * This is the answer for a caller that has one agent and no roster to compare
 * it against. A caller that can see the whole roster should use
 * `agentLabelResolver` instead, which spends the id only where two agents
 * would otherwise read as the same name.
 *
 * An agent that declared no model is named by its id alone rather than by an
 * invented word like "Unknown agent": the id is true, and the placeholder
 * would only look like a name.
 */
export const agentModelLabel = (
  agent: Pick<AttachedAgent, "writerId" | "model">,
): string => {
  // The END of the id, because the ellipsis in front of it promises exactly
  // that. It read from the front for as long as this label existed, so every
  // card said "…586687" about an id that starts with those characters - a
  // reader checking the card against the id the CLI printed found the two
  // disagreeing about which end had been cut.
  const short = `…${agent.writerId.slice(-SHORT_WRITER_ID_LENGTH)}`;
  const name = agent.model?.name;
  return name === undefined
    ? short
    : `${agentModelDisplayName(name)} (${short})`;
};

/**
 * Names every agent on one roster, spending an id only where a name repeats.
 *
 * The id is a disambiguator and nothing else, so it is drawn only when it has
 * something to disambiguate. One Claude Opus 5 and one GPT-5.6-sol are told
 * apart by their names, and printing "(…a38a)" after each of them charges the
 * reader for a distinction the names already made - across a card, a dialog
 * title, three bullets and a checkbox, which is where the reviewer met it.
 * Two connectors running the same model is the case that needs it, and there
 * both of them get it: showing the id on only one of a matching pair would
 * read as a difference between the agents rather than between their names.
 *
 * An agent with no declared model is always named by its id, because that id
 * is the only name it has.
 */
export const agentLabelResolver = (
  agents: ReadonlyArray<Pick<AttachedAgent, "writerId" | "model">>,
): ((agent: Pick<AttachedAgent, "writerId" | "model">) => string) => {
  const timesNamed = new Map<string, number>();
  for (const agent of agents) {
    const name = agent.model?.name;
    if (name === undefined) continue;
    const display = agentModelDisplayName(name);
    timesNamed.set(display, (timesNamed.get(display) ?? 0) + 1);
  }
  return (agent) => {
    const name = agent.model?.name;
    if (name === undefined) return agentModelLabel(agent);
    const display = agentModelDisplayName(name);
    return (timesNamed.get(display) ?? 0) > 1
      ? agentModelLabel(agent)
      : display;
  };
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
  readonly agent: Pick<
    AttachedAgent,
    "signalAtMs" | "claimToken" | "claimClosedAtMs"
  > & {
    readonly attached?: boolean;
  };
  readonly nowMs: number;
}): boolean => {
  // A record that crossed the wire carries the server's own answer, and that
  // answer is the whole membership fact it is given. The browser used to hold
  // the inputs instead and re-derive this, which it could not do: the fields
  // that make a working agent patient are server-only, so a primary mid turn
  // vanished from the rail and the hand-off confirmation was skipped for it.
  if (agent.attached !== undefined) return agent.attached;
  /*
  An agent that has not been heard from since its turn ended is on its way out,
  and it is given the stall window to come back before it is gone.

  This is the one case where silence says something definite. Every other
  quiet agent might be mid answer, because `agent next` hands its work to the
  harness and the process exits, so nothing renews anything for the length of
  a turn (BIG-147). But a claim closes only when the answer is published, and
  at that moment the process that ran the turn has already exited and the
  commands that finished it have too. Nobody is behind this record.

  Leaving it standing forever is what made a single agent unable to keep
  working: it came back for its next turn, found the seat still held by the
  record of its own last one, and attached as an observer of itself - taking no
  further work and asking the reviewer, every turn, whether to promote a second
  agent that did not exist (BIG-171).

  Dropping it the instant the claim closed was just as wrong the other way. The
  agent publishes and the seat is empty in the same millisecond, so a waiting
  observer the reviewer had explicitly left as an observer promoted itself on
  its very next refresh - silently reversing an answer the reviewer had given.
  The window between the two is the outgoing agent's own return trip: the
  `next` command `respond` hands back carries its token and reclaims this
  record at once, and nothing else may take the seat until that chance has
  passed.
  */
  if (agentIsBetweenTurns(agent) && agent.claimClosedAtMs !== undefined) {
    return agentIsLive({
      agent: { signalAtMs: agent.claimClosedAtMs },
      nowMs,
      maximumAgeMs: AGENT_STALL_MS,
    });
  }
  return agentIsLive({
    agent,
    nowMs,
    /*
    Patience is for agents whose silence might mean "busy", and only an agent
    holding an open claim can be busy. One that holds none is either running -
    in which case it is signalling twice a second and this window is
    irrelevant - or gone, and dropping it costs nothing because it re-attaches
    on its next command.

    The distinction also bounds a real pile-up: a harness that polls without
    --wait would otherwise accumulate one dead record per poll for the whole
    horizon.
    */
    maximumAgeMs:
      agent.claimToken === undefined || agent.claimClosedAtMs !== undefined
        ? AGENT_STALL_MS
        : AGENT_RECOVERY_HORIZON_MS,
  });
};

/**
 * One attached agent as the browser is allowed to see it.
 *
 * Two things are true of this shape and neither is cosmetic. The pickup token
 * is the capability that fences publication, so it never leaves the server;
 * and membership arrives already decided, because the fields it is decided
 * from are among the ones withheld. A browser handed the inputs would answer a
 * different question from the server it is drawing, which is exactly what it
 * did: it dropped a working primary from the rail after 75 seconds and then
 * offered a hand-off with no confirmation, because as far as it could tell
 * there was nobody to displace.
 */
export type RosterAgent = Omit<
  AttachedAgent,
  | "claimToken"
  | "claimClosedAtMs"
  | "inheritedDraftPath"
  | "unsettledArrivalAtMs"
> & {
  readonly attached: boolean;
};

/**
 * What every selector below needs of a record, from either side of the wire.
 *
 * The server passes its own `AttachedAgent`s and the browser passes the
 * projection above, so the rules that decide who is primary are one
 * implementation rather than two that can drift.
 */
export type RosterMember = Pick<
  AttachedAgent,
  | "writerId"
  | "role"
  | "attachedAtMs"
  | "signalAtMs"
  | "requestedPrimacyAtMs"
  | "claimToken"
  | "claimClosedAtMs"
  | "model"
> & {
  readonly attached?: boolean;
};

/**
 * Projects the roster into the browser's copy, membership already answered.
 *
 * This is the single place that fact is computed for a reviewer's surface,
 * which is what keeps the rail, the request card, and the confirmation dialog
 * unable to disagree with the roster they are drawn from.
 */
export const projectRosterForBrowser = ({
  agents,
  nowMs,
}: {
  readonly agents: ReadonlyArray<AttachedAgent>;
  readonly nowMs: number;
}): ReadonlyArray<RosterAgent> =>
  agents.map((agent) => ({
    writerId: agent.writerId,
    role: agent.role,
    attachedAtMs: agent.attachedAtMs,
    signalAtMs: agent.signalAtMs,
    ...(agent.requestedPrimacyAtMs === undefined
      ? {}
      : { requestedPrimacyAtMs: agent.requestedPrimacyAtMs }),
    ...(agent.model === undefined ? {} : { model: agent.model }),
    attached: agentIsAttached({ agent, nowMs }),
  }));

/**
 * The agents a reviewer should be shown, oldest attachment first.
 *
 * Order is by attachment rather than by role, because the rail lists agents as
 * a history of who arrived and the reviewer's mental model is "who was here,
 * and who turned up". Ties fall back to the writer id so the order is total
 * and two records written in the same millisecond cannot swap between polls.
 */
export const orderAttachedAgents = <Agent extends RosterMember>(
  agents: ReadonlyArray<Agent>,
): ReadonlyArray<Agent> =>
  [...agents].sort(
    (left, right) =>
      left.attachedAtMs - right.attachedAtMs ||
      left.writerId.localeCompare(right.writerId),
  );

/** The live agent holding primacy, when there is one. */
export const selectPrimaryAgent = <Agent extends RosterMember>({
  agents,
  nowMs,
}: {
  readonly agents: ReadonlyArray<Agent>;
  readonly nowMs: number;
}): Agent | undefined =>
  orderAttachedAgents(agents).find(
    (agent) => agent.role === "primary" && agentIsAttached({ agent, nowMs }),
  );

/** The live observers, in the order the rail lists them. */
export const selectObserverAgents = <Agent extends RosterMember>({
  agents,
  nowMs,
}: {
  readonly agents: ReadonlyArray<Agent>;
  readonly nowMs: number;
}): ReadonlyArray<Agent> =>
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
export const pendingPrimacyRequest = <Agent extends RosterMember>({
  agents,
  nowMs,
}: {
  readonly agents: ReadonlyArray<Agent>;
  readonly nowMs: number;
}): Agent | undefined =>
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
  readonly agents: ReadonlyArray<RosterMember>;
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
  readonly agents: ReadonlyArray<RosterMember>;
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
 * An answer about an agent that is no longer on the roster changes nothing.
 * The agent may have been reaped between the reviewer's click and this write,
 * and demoting the incumbent for a successor that cannot arrive would leave
 * the plan with no primary at all - a worse state than the one the reviewer
 * was trying to fix, and one no later write repairs on its own.
 *
 * The request is cleared on both sides: the promoted agent got what it asked
 * for, and the demoted one never asked. A stale flag would keep the toolbar in
 * hazard after the reviewer had already decided.
 *
 * The demoted agent's claim is recorded as closed, because the hand-off has
 * just freed it. Left open, that record went on describing an agent mid turn:
 * it was the one thing that made an unheard-from record patient for half an
 * hour, so a dead card sat on the rail offering to be made the primary long
 * after the process behind it had been refused and exited.
 */
export const applyPrimacyHandoff = ({
  agents,
  writerId,
  nowMs,
  inheritedDraftPath,
}: {
  readonly agents: ReadonlyArray<AttachedAgent>;
  /** The observer the reviewer chose. */
  readonly writerId: string;
  /** When the reviewer answered, which is when the outgoing claim ends. */
  readonly nowMs: number;
  /** The outgoing agent's draft, when the reviewer chose to carry it over. */
  readonly inheritedDraftPath?: string;
}): ReadonlyArray<AttachedAgent> => {
  if (!agents.some((agent) => agent.writerId === writerId)) return agents;
  return agents.map((agent) => {
    /*
    Only the two agents this answer was about are touched.

    An answer about one observer says nothing about another. Clearing every
    request would delete a third agent's question along with the answered one,
    and because the surface shows one question at a time, that agent would then
    sit attached and unasked forever - waiting on a prompt the reviewer was
    never given the chance to see.
    */
    if (agent.writerId === writerId) {
      const {
        inheritedDraftPath: _previousDraft,
        requestedPrimacyAtMs: _granted,
        unsettledArrivalAtMs: _settled,
        ...rest
      } = agent;
      return {
        ...rest,
        role: "primary",
        ...(inheritedDraftPath === undefined ? {} : { inheritedDraftPath }),
      };
    }
    if (agent.role !== "primary") return agent;
    // The outgoing primary never asked for anything, but strip the field
    // anyway: a stale request on a demoted agent would re-raise a question
    // nobody posed.
    const {
      requestedPrimacyAtMs: _demoted,
      unsettledArrivalAtMs: _decided,
      ...rest
    } = agent;
    return {
      ...rest,
      role: "observer",
      ...(agent.claimToken === undefined || agent.claimClosedAtMs !== undefined
        ? {}
        : { claimClosedAtMs: nowMs }),
    };
  });
};

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
    // A held question is dropped along with an asked one. The reviewer has
    // answered about this agent, so raising its deferred question later would
    // ask them again about something they have already settled.
    const {
      requestedPrimacyAtMs: _declined,
      unsettledArrivalAtMs: _settled,
      ...rest
    } = agent;
    return rest;
  });
