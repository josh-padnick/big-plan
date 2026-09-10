// Owns persisted agent attachment, heartbeat continuity, disconnects, and
// primacy. Keeping their read-modify-write rules together preserves the lock
// ordering that prevents an old agent from reclaiming a disconnected seat.

import {
  agentDisconnectAddresses,
  type AgentDisconnectDirective,
} from "./shared/agent-disconnect.js";
import {
  decodeAgentModelIdentity,
  type AgentModelIdentity,
} from "./shared/agent-model.js";
import {
  agentIsAttached,
  agentIsBetweenTurns,
  applyPrimacyDeclined,
  applyPrimacyHandoff,
  roleForArrivingAgent,
  selectPrimaryAgent,
  type AgentRole,
  type AttachedAgent,
} from "./shared/agent-primacy.js";
import {
  AGENT_RECOVERY_HORIZON_MS,
  AGENT_STALL_MS,
} from "./shared/agent-timing.js";

import { readStoreJson, writeStoreJson } from "./store-files.js";
import type { ReviewStore } from "./store.js";
import { withReviewStoreLock } from "./store.js";

export type AgentPresence = {
  readonly connected: boolean;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  /**
   * The connection loop the record names, in every state it can be read in.
   *
   * It outlives the connection for the same reason the declared identity does:
   * a disconnect the reviewer addressed to one loop has to stay matched to that
   * loop after it has gone, or the end it explains would be reported against
   * whichever agent attached next (BIG-190).
   */
  readonly writerId?: string;
  readonly updatedAtMs?: number;
  /**
   * When the loop that wrote this heartbeat observed its own session ending.
   * Its presence is the whole difference between a silence Big Plan is still
   * inferring from and an end it was told about.
   */
  readonly endedAtMs?: number;
  readonly model?: AgentModelIdentity;
};

/** The heartbeat lock stayed held for the whole waiting budget. */
class AgentHeartbeatLockContended extends Error {
  constructor() {
    super("Another process is writing the agent heartbeat");
    this.name = "AgentHeartbeatLockContended";
  }
}

/**
 * Runs one agent heartbeat write, reporting a lock it never took instead of
 * raising it.
 *
 * The two failures are not the same fact and are not answered the same way.
 * Never reaching the write - a lock held to the end of the budget, a lock path
 * something else has taken over, a filesystem that would not hand one out - says
 * nothing about the agent, and the write repeats in half a second, so both
 * heartbeat writers report it and let the next one answer it; neither may end a
 * session it still vouches for over a race it lost. A write that ran and failed
 * is a different claim, and it keeps being raised exactly as it was before
 * there was a lock to lose.
 */
const withAgentHeartbeatLock = async ({
  store,
  change,
  lockAttempts,
}: {
  readonly store: ReviewStore;
  readonly change: () => Promise<boolean>;
  readonly lockAttempts?: number;
}): Promise<boolean> => {
  let wrote = false;
  try {
    return await withReviewStoreLock({
      lockPath: store.agentHeartbeatLockPath,
      change: () => {
        wrote = true;
        return change();
      },
      timeoutError: () => new AgentHeartbeatLockContended(),
      lockAttempts,
    });
  } catch (error: unknown) {
    if (wrote) throw error;
    return false;
  }
};

type StoredHeartbeatContinuity = {
  readonly writerId?: string;
  readonly updatedAtMs?: number;
  readonly model?: AgentModelIdentity;
};

/** Reads facts an omitted heartbeat field must carry forward in one session. */
const storedHeartbeatContinuity = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<StoredHeartbeatContinuity> => {
  const value = await readStoreJson(store.agentHeartbeatPath);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("sessionId" in value) ||
    value.sessionId !== sessionId
  ) {
    return {};
  }
  const writerId =
    "writerId" in value && typeof value.writerId === "string"
      ? value.writerId
      : undefined;
  const updatedAtMs =
    "updatedAtMs" in value &&
    typeof value.updatedAtMs === "number" &&
    Number.isFinite(value.updatedAtMs)
      ? value.updatedAtMs
      : undefined;
  const model =
    "model" in value ? decodeAgentModelIdentity(value.model) : undefined;
  return {
    ...(writerId === undefined ? {} : { writerId }),
    ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
    ...(model === undefined ? {} : { model }),
  };
};

/**
 * Refreshes the coding-agent liveness signal with its observable state.
 *
 * `writerId` identifies the invocation doing the writing, because the session
 * id is shared by every agent process attached to this review and so cannot
 * tell two of them apart. Passing one claims the signal for this invocation.
 * Omitting one keeps whichever writer the heartbeat already names, so a
 * process that only reports progress cannot take the connection loop's
 * identity away from it and leave a session with no one able to report its
 * end. Reading that name is part of the write and not a step before it: a
 * newer loop may claim the signal at any moment, and the two would otherwise
 * race the same way the end marker's guard already refuses to.
 *
 * `lockAttempts` bounds the wait for the heartbeat lock.
 *
 * Returns whether the signal was refreshed. Contention is reported rather than
 * raised because this runs every half second inside the connection loop's own
 * wait: the next refresh answers a lost race, while an exception there would
 * end the session this signal exists to vouch for.
 */
export const writeAgentHeartbeat = async ({
  store,
  sessionId,
  state,
  requestId,
  writerId,
  model,
  now = Date.now(),
  lockAttempts,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  readonly writerId?: string;
  /** Which model is running the connector. */
  readonly model?: AgentModelIdentity;
  readonly now?: number;
  readonly lockAttempts?: number;
}): Promise<boolean> =>
  withAgentHeartbeatLock({
    store,
    lockAttempts,
    change: async () => {
      /*
      A writer the roster has never heard of may not speak for the review.

      There is one presence record per review and it is replaced whole, so
      whoever writes it becomes, to every reviewer-facing surface, the agent
      attached to this plan. Every shipped path registers on the roster before
      it heartbeats - the work loop's `refreshRoster` runs first, on every pass
      - but that was a property of the call sites rather than a rule, and the
      failure it leaves open is silent: the write lands, the card renames
      itself, and nothing refuses. This is that rule (BIG-171).

      An empty roster is not evidence of an unregistered writer, only of a
      review no agent has attached to yet, so it is allowed through: there is
      no one there to be spoken over.
      */
      if (writerId !== undefined) {
        const roster = await readAgentRoster({ store, sessionId });
        if (
          roster.length > 0 &&
          !roster.some((agent) => agent.writerId === writerId)
        ) {
          return false;
        }
      }
      const stored = await storedHeartbeatContinuity({ store, sessionId });
      const writer = writerId ?? stored.writerId;
      /*
      Identity carries forward within one agent's session, never across agents.

      A write that names no model is a continuation - `agent note` renewing a
      claim, say - so it keeps what that agent already declared rather than
      erasing it. But a DIFFERENT writer arriving with nothing to declare has
      declared nothing, and inheriting the last agent's identity would show a
      reader the wrong agent's name at the moment a new one took over, which is
      the one thing this whole surface exists not to do.
      */
      const isSameWriter =
        writerId === undefined || stored.writerId === undefined
          ? true
          : writerId === stored.writerId;
      const declaredModel = model ?? (isSameWriter ? stored.model : undefined);
      await writeStoreJson({
        path: store.agentHeartbeatPath,
        value: {
          sessionId,
          state,
          ...(requestId === undefined ? {} : { requestId }),
          ...(writer === undefined ? {} : { writerId: writer }),
          ...(declaredModel === undefined ? {} : { model: declaredModel }),
          updatedAtMs: now,
        },
      });
      return true;
    },
  });

/**
 * Records that this loop observed its own session end, and refuses to speak
 * for any other.
 *
 * The guard is the point: by the time a loop can write this, a newer agent may
 * already own the heartbeat, and marking that live session ended would be a
 * worse lie than the stale connection this marker exists to remove. Every
 * other field is carried through untouched, so whatever the live heartbeat
 * says about the agent's identity keeps saying it after the session ends.
 *
 * The lock is what makes that guard worth stating: reading the writer and
 * overwriting it are one step against every other heartbeat writer, so a newer
 * loop's first heartbeat cannot land inside the comparison and be marked
 * ended by the loop it replaced.
 *
 * Returns whether the marker was written. A refusal, including a contended
 * lock, leaves the unchanged aging window to report the silence instead.
 */
export const writeAgentHeartbeatEnded = async ({
  store,
  sessionId,
  writerId,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly writerId: string;
  readonly now?: number;
}): Promise<boolean> =>
  withAgentHeartbeatLock({
    store,
    change: async () => {
      const value = await readStoreJson(store.agentHeartbeatPath);
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        !("sessionId" in value) ||
        value.sessionId !== sessionId ||
        !("writerId" in value) ||
        value.writerId !== writerId
      ) {
        return false;
      }
      await writeStoreJson({
        path: store.agentHeartbeatPath,
        value: {
          ...(value as Readonly<Record<string, unknown>>),
          state: "ended",
          updatedAtMs: now,
          endedAtMs: now,
        },
      });
      return true;
    },
  });

/**
 * How many disconnected agents the record remembers.
 *
 * One entry per agent the reviewer has taken off this review, and a review that
 * has been through sixteen of them has long since stopped being able to hear
 * from the first. The bound exists because the record is never pruned by time -
 * it is the log's evidence for who ended a session - and an unbounded list in a
 * long review is a file that only grows.
 */
const REMEMBERED_DISCONNECTS = 16;

/**
 * Records the reviewer's decision to disconnect the agent they were looking at.
 *
 * The directive is addressed to that agent and to nobody else, and is never
 * cleared: an agent that attaches afterwards brings no connection token of its
 * own, so it mints a different one and the rule that matches them simply stops
 * matching. What the record buys by staying is the connection log's ability to
 * say who ended the session, long after the agent that answered it has gone
 * (BIG-190).
 */
export const writeAgentDisconnectRequest = async ({
  store,
  directive,
}: {
  readonly store: ReviewStore;
  readonly directive: AgentDisconnectDirective;
}): Promise<void> =>
  withReviewStoreLock({
    lockPath: store.agentRosterLockPath,
    change: async () => {
      const kept = (await readAgentDisconnectRequests({ store })).filter(
        // One standing directive per agent. A reviewer disconnecting the same
        // agent twice is restating the same decision, not making a second one.
        (existing) => existing.writerId !== directive.writerId,
      );
      await writeStoreJson({
        path: store.agentDisconnectPath,
        value: {
          directives: [...kept, directive].slice(-REMEMBERED_DISCONNECTS),
        },
      });
    },
    timeoutError: () =>
      new Error("Another process is updating agent disconnect directives"),
  });

const decodeDisconnectDirective = (
  value: unknown,
): AgentDisconnectDirective | undefined => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("requestedAtMs" in value) ||
    typeof value.requestedAtMs !== "number" ||
    !Number.isFinite(value.requestedAtMs)
  ) {
    return undefined;
  }
  if (!("writerId" in value) || typeof value.writerId !== "string") {
    // A directive naming nobody would be a standing order against every agent
    // that ever attaches, so an unaddressed record is discarded rather than
    // read as one that matches everyone.
    return undefined;
  }
  return { requestedAtMs: value.requestedAtMs, writerId: value.writerId };
};

/**
 * Every standing disconnect, oldest first.
 *
 * They are kept per agent rather than as one current decision. A reviewer who
 * disconnects one agent, connects another, and disconnects that one too has
 * made two decisions, and the first agent may not run another command until
 * after the second was recorded: a single slot would answer it with an
 * ordinary claim failure instead of telling it what happened (BIG-190).
 */
export const readAgentDisconnectRequests = async ({
  store,
}: {
  readonly store: ReviewStore;
}): Promise<ReadonlyArray<AgentDisconnectDirective>> => {
  const value = await readStoreJson(store.agentDisconnectPath);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("directives" in value) ||
    !Array.isArray(value.directives)
  ) {
    return [];
  }
  return value.directives.flatMap((entry) => {
    const directive = decodeDisconnectDirective(entry);
    return directive === undefined ? [] : [directive];
  });
};

/** The standing disconnect addressed to one agent, if the reviewer issued one. */
export const readAgentDisconnectRequestFor = async ({
  store,
  writerId,
}: {
  readonly store: ReviewStore;
  readonly writerId?: string;
}): Promise<AgentDisconnectDirective | undefined> =>
  (await readAgentDisconnectRequests({ store })).find((directive) =>
    agentDisconnectAddresses({
      directive,
      ...(writerId === undefined ? {} : { writerId }),
    }),
  );

const asAttachedAgent = (value: unknown): AttachedAgent | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const writerId = record["writerId"];
  const role = record["role"];
  const attachedAtMs = record["attachedAtMs"];
  const signalAtMs = record["signalAtMs"];
  if (
    typeof writerId !== "string" ||
    writerId === "" ||
    (role !== "primary" && role !== "observer") ||
    typeof attachedAtMs !== "number" ||
    !Number.isFinite(attachedAtMs) ||
    typeof signalAtMs !== "number" ||
    !Number.isFinite(signalAtMs)
  ) {
    return undefined;
  }
  const requestedPrimacyAtMs = record["requestedPrimacyAtMs"];
  const unsettledArrivalAtMs = record["unsettledArrivalAtMs"];
  const claimToken = record["claimToken"];
  const claimClosedAtMs = record["claimClosedAtMs"];
  const inheritedDraftPath = record["inheritedDraftPath"];
  const model = decodeAgentModelIdentity(record["model"]);
  return {
    writerId,
    role,
    attachedAtMs,
    signalAtMs,
    ...(typeof requestedPrimacyAtMs === "number" &&
    Number.isFinite(requestedPrimacyAtMs)
      ? { requestedPrimacyAtMs }
      : {}),
    ...(typeof unsettledArrivalAtMs === "number" &&
    Number.isFinite(unsettledArrivalAtMs)
      ? { unsettledArrivalAtMs }
      : {}),
    ...(typeof claimToken === "string" && claimToken !== ""
      ? { claimToken }
      : {}),
    ...(typeof claimClosedAtMs === "number" && Number.isFinite(claimClosedAtMs)
      ? { claimClosedAtMs }
      : {}),
    ...(typeof inheritedDraftPath === "string" && inheritedDraftPath !== ""
      ? { inheritedDraftPath }
      : {}),
    ...(model === undefined ? {} : { model }),
  };
};

/**
 * One agent the reviewer disconnected, and the moment they did.
 *
 * Removing the record cannot be the whole answer, because the agent it
 * describes is usually still running: a waiting loop refreshes its
 * registration twice a second, finds no record under its id, and registers
 * again as an arrival - so the card the reviewer just dismissed comes back
 * within half a second, with its question re-raised, and no number of clicks
 * can clear it (BIG-171). This is the fact that outlives the record: the
 * reviewer's answer, which the loop reads and stops on.
 *
 * It is deliberately about one registration and not about the connector. A
 * fresh invocation mints a new id and attaches like any other new agent, which
 * is what keeps "disconnect" an answer about this loop rather than a ban on
 * the terminal it is running in.
 */
export type AgentDisconnect = {
  readonly writerId: string;
  /**
   * The pickup token that registration last claimed with, when it held one.
   *
   * `agent note` and `agent respond` are separate processes that know their
   * token and not their registration, so without it a disconnected agent's
   * in-flight commands would meet a refusal about claims rather than the
   * answer the reviewer actually gave.
   */
  readonly claimToken?: string;
  readonly atMs: number;
};

const asAgentDisconnect = (value: unknown): AgentDisconnect | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const writerId = record["writerId"];
  const atMs = record["atMs"];
  if (
    typeof writerId !== "string" ||
    writerId === "" ||
    typeof atMs !== "number" ||
    !Number.isFinite(atMs)
  ) {
    return undefined;
  }
  const claimToken = record["claimToken"];
  return {
    writerId,
    ...(typeof claimToken === "string" && claimToken !== ""
      ? { claimToken }
      : {}),
    atMs,
  };
};

/** Refuses a registration the reviewer has disconnected from this review. */
export class AgentDisconnectedByReviewer extends Error {
  readonly writerId: string;

  constructor(writerId: string) {
    super("The reviewer disconnected this agent from this review");
    this.name = "AgentDisconnectedByReviewer";
    this.writerId = writerId;
  }
}

const rosterDocument = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<Readonly<Record<string, unknown>> | undefined> => {
  const value = await readStoreJson(store.agentRosterPath);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("sessionId" in value) ||
    value.sessionId !== sessionId
  ) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
};

/**
 * Reads the roster of agents attached to this review.
 *
 * A record that does not decode disappears rather than throwing, on the same
 * rule the rest of this store follows: a malformed file must not be able to
 * stop a reviewer from seeing the agents that are fine. A roster belonging to
 * another session is not this session's roster and reads as empty.
 */
export const readAgentRoster = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<ReadonlyArray<AttachedAgent>> => {
  const document = await rosterDocument({ store, sessionId });
  const agents = document?.["agents"];
  if (!Array.isArray(agents)) return [];
  return agents
    .map(asAttachedAgent)
    .filter((agent): agent is AttachedAgent => agent !== undefined);
};

/**
 * True while a disconnection still answers the registration it named.
 *
 * The registration is a running loop that re-registers twice a second, so the
 * stall window is all it takes to outlast one: past it the id belongs to
 * nobody, and a connector the reviewer invited back mints a new one anyway.
 */
export const disconnectBarsWriter = ({
  entry,
  writerId,
  now,
}: {
  readonly entry: AgentDisconnect;
  readonly writerId: string;
  readonly now: number;
}): boolean =>
  entry.writerId === writerId && now - entry.atMs <= AGENT_STALL_MS;

/**
 * True while a disconnection still answers the turn it interrupted.
 *
 * This half is owed the recovery horizon rather than the stall window,
 * because the processes it answers are the long-lived halves of one turn: an
 * agent disconnected mid turn goes on working and reaches `agent note` or
 * `agent respond` minutes later, and a turn routinely outlives 75 seconds -
 * which is the whole reason that horizon exists. Expiring here left it with a
 * generic refusal naming an agent that does not exist, instead of the answer
 * the reviewer actually gave.
 */
export const disconnectBarsClaimToken = ({
  entry,
  claimToken,
  now,
}: {
  readonly entry: AgentDisconnect;
  readonly claimToken: string;
  readonly now: number;
}): boolean =>
  entry.claimToken === claimToken &&
  now - entry.atMs <= AGENT_RECOVERY_HORIZON_MS;

/**
 * Reads the reviewer's still-standing disconnections.
 *
 * They expire rather than lasting the session, because a disconnection answers
 * one running loop and one turn, and both are over within the horizon. Kept
 * forever, the answer would start refusing agents the reviewer never spoke
 * about - the same connector, invoked again, reconnecting at their request.
 * Which half of an entry still answers is the two rules above; this is only
 * how long the entry is kept at all.
 */
export const readAgentDisconnects = async ({
  store,
  sessionId,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly now?: number;
}): Promise<ReadonlyArray<AgentDisconnect>> => {
  const document = await rosterDocument({ store, sessionId });
  const disconnected = document?.["disconnected"];
  if (!Array.isArray(disconnected)) return [];
  return disconnected
    .map(asAgentDisconnect)
    .filter(
      (entry): entry is AgentDisconnect =>
        entry !== undefined && now - entry.atMs <= AGENT_RECOVERY_HORIZON_MS,
    );
};

/**
 * When the plan last lost the agent that answered it, and to what.
 *
 * Succession needs to know more than "there is no primary right now", because
 * a seat is empty for an instant on every ordinary path: a turn ends, a
 * polling loop gives its registration back, a reviewer moves primacy. Promoting
 * on that instant is how a waiting observer took a review that was never
 * offered to it. This records the moment the seat actually emptied, so an
 * observer can be asked to prove the emptiness lasted.
 */
export type AgentSeat = {
  readonly emptiedAtMs: number;
  /**
   * Whether the reviewer emptied it.
   *
   * A seat the reviewer emptied is not a vacancy to be filled; it is their
   * answer. Nothing succeeds into it automatically, however long it stands -
   * which is the rule `detachAgentFromRoster` already documents, and which
   * outranks any automatic succession.
   */
  readonly byReviewer: boolean;
};

const asAgentSeat = (value: unknown): AgentSeat | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const emptiedAtMs = record["emptiedAtMs"];
  if (typeof emptiedAtMs !== "number" || !Number.isFinite(emptiedAtMs)) {
    return undefined;
  }
  return { emptiedAtMs, byReviewer: record["byReviewer"] === true };
};

/** The standing record of an empty seat, when the plan has one. */
export const readAgentSeat = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<AgentSeat | undefined> =>
  asAgentSeat((await rosterDocument({ store, sessionId }))?.["seat"]);

/**
 * Runs one change against the roster under its own lock.
 *
 * Every mutation goes through here because the invariant is about the set, not
 * about any one agent: exactly one primary. A caller that read the roster,
 * decided, and wrote it back outside this lock could promote an observer whose
 * primary another caller had just replaced, and the file would then name two.
 */
const withAgentRoster = async ({
  store,
  sessionId,
  change,
  disconnect,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly change: (
    agents: ReadonlyArray<AttachedAgent>,
    disconnected: ReadonlyArray<AgentDisconnect>,
    seat: AgentSeat | undefined,
  ) => ReadonlyArray<AttachedAgent>;
  /**
   * A disconnection this change records, read after the change has run.
   *
   * The roster and the reviewer's answer about it are one file and one write,
   * because a record removed without its answer beside it is exactly the state
   * the answer exists to prevent: the loop it named registers again.
   */
  readonly disconnect?: () => AgentDisconnect | undefined;
  readonly now?: number;
}): Promise<ReadonlyArray<AttachedAgent>> =>
  withReviewStoreLock({
    lockPath: store.agentRosterLockPath,
    change: async () => {
      // Read before the change, and written back after it: every roster write
      // carries the reviewer's standing answers forward, and drops the ones
      // whose window has passed.
      const standing = await readAgentDisconnects({ store, sessionId, now });
      const seat = await readAgentSeat({ store, sessionId });
      const next = change(
        await readAgentRoster({ store, sessionId }),
        standing,
        seat,
      );
      const recorded = disconnect?.();
      const disconnected =
        recorded === undefined
          ? standing
          : [
              ...standing.filter(
                (entry) => entry.writerId !== recorded.writerId,
              ),
              recorded,
            ];
      /*
      The seat is settled here because this is the one place it can change.

      A seat that is filled has nothing to record. One that is empty keeps the
      moment it emptied rather than restamping it on every later write, since
      what succession needs to know is how long the emptiness has lasted - and
      it remembers whether the reviewer is the one who emptied it, because that
      answer is theirs to reverse and nobody else's.
      */
      const filled =
        selectPrimaryAgent({ agents: next, nowMs: now }) !== undefined;
      const seatNext = filled
        ? undefined
        : (seat ?? { emptiedAtMs: now, byReviewer: recorded !== undefined });
      await writeStoreJson({
        path: store.agentRosterPath,
        value: {
          sessionId,
          agents: next,
          disconnected,
          ...(seatNext === undefined ? {} : { seat: seatNext }),
        },
      });
      return next;
    },
    timeoutError: () =>
      new Error("Another process is updating the agent roster"),
  });

/** What one process's registration leaves it holding on the roster. */
export type AgentRegistration = {
  readonly agents: ReadonlyArray<AttachedAgent>;
  /** The record this process is now acting as. */
  readonly agent: AttachedAgent;
};

/**
 * Registers this agent, or refreshes the registration it already has.
 *
 * The role is decided here rather than by the caller, because it is a fact
 * about the set: the first live agent owns the plan and every later one
 * observes. An arriving loop can therefore never take primacy by arriving,
 * which is the behavior this whole change exists to remove (BIG-171).
 *
 * `writerId` is only a proposal. A process that names a pickup token this
 * review has already seen is the agent that used it, coming back, so it
 * assumes that record's identity instead of its own - which is what keeps one
 * agent one row on the reviewer's rail across the several short-lived
 * processes a single turn takes, and what stops an agent returning from its
 * own answered turn from being mistaken for a second agent arriving.
 *
 * A refresh keeps the role, the attachment time, and any pending request. Only
 * the signal moves, so a long working turn cannot demote the agent running it,
 * and a reviewer's answer cannot be undone by the next heartbeat.
 *
 * Agents that have been silent past their window are dropped in the same step.
 * Reaping on write rather than on a timer keeps the roster honest with no
 * scheduler, and it means a departed primary frees the role for the next
 * arrival instead of holding it forever.
 */
export const attachAgentToRoster = async ({
  store,
  sessionId,
  writerId,
  adoptClaimToken,
  model,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  /** The identity to register under when this agent has no record yet. */
  readonly writerId: string;
  /**
   * A pickup token this process is acting under.
   *
   * Every command after the pickup - a progress note, the next `next` once the
   * answer is published - knows the token and not the loop, so the token is
   * how they find the registration they belong to. Without it each of them
   * would arrive as a stranger: mid turn that demotes the plan's own primary
   * to an observer of itself, and after the turn it strands the agent as an
   * observer of a record nothing will ever refresh.
   */
  readonly adoptClaimToken?: string;
  readonly model?: AgentModelIdentity;
  readonly now?: number;
}): Promise<AgentRegistration> => {
  let registered: AttachedAgent | undefined;
  const agents = await withAgentRoster({
    store,
    sessionId,
    now,
    change: (existingAgents, disconnected, seat) => {
      const adopted =
        adoptClaimToken === undefined
          ? undefined
          : existingAgents.find(
              (agent) => agent.claimToken === adoptClaimToken,
            );
      // The identity this process answers to: the record it adopted, or the
      // one it proposed when it has no record here yet.
      const identity = adopted?.writerId ?? writerId;
      /*
      A registration the reviewer disconnected is refused rather than remade.

      Attaching is otherwise unconditional, and that is what let a running loop
      undo the reviewer's answer twice a second: its record was gone, so it
      arrived as a newcomer under the same id and raised its question again.
      The refusal is what the loop reads to stop, and it is matched by token as
      well as by id so the separate processes of one turn are answered the same
      way as the loop that started it.
      */
      if (
        disconnected.some(
          (entry) =>
            disconnectBarsWriter({ entry, writerId: identity, now }) ||
            (adoptClaimToken !== undefined &&
              disconnectBarsClaimToken({
                entry,
                claimToken: adoptClaimToken,
                now,
              })),
        )
      ) {
        throw new AgentDisconnectedByReviewer(identity);
      }
      const live = existingAgents.filter(
        (agent) =>
          agent.writerId === identity ||
          // Membership, never liveness: a working agent's process is gone for
          // the length of its turn, so reaping on the stall window would
          // delete the plan's own primary while it was answering (BIG-147).
          agentIsAttached({ agent, nowMs: now }),
      );
      const existing = live.find((agent) => agent.writerId === identity);
      if (existing !== undefined) {
        /*
        A finished claim is forgotten as its agent comes back.

        The token was this record's way of being found again, and it has now
        done that job. Keeping it would leave the record claiming a turn that
        is over, so the moment the agent returns it goes back to standing on
        its own signal like any waiting loop.
        */
        const returned =
          adopted !== undefined && existing.claimClosedAtMs !== undefined;
        const {
          claimToken: _finished,
          claimClosedAtMs: _closed,
          ...withoutFinishedClaim
        } = existing;
        /*
        An observer whose primary fell silent stops waiting - eventually.

        Roles are assigned on arrival, so an observer whose primary has since
        died would otherwise stay an observer of an empty seat forever - still
        asking a question about an agent that is no longer there, and taking no
        work while the reviewer's requests pile up.

        Three things have to be true before it succeeds, and each of them is a
        way this rule was wrong before. The seat must be empty now. It must
        have been empty for the stall window, because a seat is empty for an
        instant on every ordinary path - a turn ending, a polling loop handing
        its registration back - and promoting on that instant handed the review
        to an observer the reviewer had explicitly left as one. And the
        reviewer must not be the one who emptied it: their disconnect is an
        answer, not a vacancy, and inventing a successor for it would answer a
        question they were asked and deliberately did not answer.
        */
        const succeedsAnEmptySeat =
          existing.role === "observer" &&
          selectPrimaryAgent({
            agents: live.filter((agent) => agent.writerId !== identity),
            nowMs: now,
          }) === undefined &&
          seat !== undefined &&
          !seat.byReviewer &&
          now - seat.emptiedAtMs >= AGENT_STALL_MS;
        const {
          requestedPrimacyAtMs: _answered,
          unsettledArrivalAtMs: _settled,
          ...withoutRequest
        } = returned ? withoutFinishedClaim : existing;
        registered = {
          ...(succeedsAnEmptySeat
            ? { ...withoutRequest, role: "primary" }
            : returned
              ? withoutFinishedClaim
              : existing),
          signalAtMs: now,
          // A refresh that declares nothing keeps what this agent already said
          // about itself; it never inherits another's.
          ...(model === undefined ? {} : { model }),
        };
        const refreshed = registered;
        return live.map((agent) =>
          agent.writerId === identity ? refreshed : agent,
        );
      }
      const role = roleForArrivingAgent({ agents: live, nowMs: now });
      /*
      Whether the roster can yet say this is a second agent.

      Between two turns the incumbent's record says only that a claim closed
      and nobody has been heard from since, which is equally what the agent
      coming back looks like a moment before it arrives. Asking the reviewer
      then puts "a second agent wants to answer you" in front of them for the
      ordinary single-agent loop, and answering it with Disconnect removes the
      only agent they have.
      */
      const incumbent = selectPrimaryAgent({ agents: live, nowMs: now });
      const unsettled =
        role === "observer" &&
        incumbent !== undefined &&
        agentIsBetweenTurns(incumbent);
      registered = {
        writerId: identity,
        role,
        attachedAtMs: now,
        signalAtMs: now,
        /*
        Arriving as an observer is itself the request to be primary.

        Requiring a separate flag would mean the pasted connect prompt never
        carries it, so a second agent would attach in silence and the reviewer
        would never be asked - which is the confusion this change exists to
        end. Showing up is the ask; the reviewer's answer is what settles it.

        Only a new arrival raises it. A refresh above leaves the field alone,
        so "leave it as observer" stays answered instead of being re-asked
        twice a second by the same loop.

        An arrival the roster cannot place holds the question instead of
        dropping it: `requestAgentPrimacy` raises it as soon as the roster can
        say who the incumbent is.
        */
        ...(role !== "observer"
          ? {}
          : unsettled
            ? { unsettledArrivalAtMs: now }
            : { requestedPrimacyAtMs: now }),
        ...(model === undefined ? {} : { model }),
      };
      return [...live, registered];
    },
  });
  if (registered === undefined) {
    throw new Error("The agent roster did not record this registration");
  }
  return { agents, agent: registered };
};

/**
 * Refreshes the registration one pickup token belongs to, and creates none.
 *
 * A progress note is an agent reporting on work it already holds, so its whole
 * identity is the token. Letting it register instead - under an id nobody else
 * knows, because the note process mints its own - would rename the agent the
 * browser is pointing at mid turn, so the reviewer's next click on that card
 * would miss. If the token matches nothing, this agent has been reaped or
 * displaced, and the answer to that is the refusal its next command already
 * gives, not a fresh record standing in for an agent nobody promoted.
 */
export const refreshAgentByClaimToken = async ({
  store,
  sessionId,
  claimToken,
  model,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly claimToken: string;
  readonly model?: AgentModelIdentity;
  readonly now?: number;
}): Promise<ReadonlyArray<AttachedAgent>> =>
  withAgentRoster({
    store,
    sessionId,
    now,
    change: (agents) =>
      agents.map((agent) =>
        agent.claimToken === claimToken
          ? {
              ...agent,
              signalAtMs: now,
              ...(model === undefined ? {} : { model }),
            }
          : agent,
      ),
  });

/**
 * Removes this process's registration as it exits.
 *
 * A record stands for an agent that is here, and the only thing that keeps one
 * standing after its process is gone is a turn still in flight: a claim it
 * holds and has not closed. A record without one describes nobody, and leaving
 * it behind is what turns a harness that polls for work into a queue of ghosts
 * - each poll attaching, finding nothing, exiting, and blocking the next one
 * from ever being the primary.
 *
 * An unanswered question about primacy is deliberately not a reason to stay.
 * Arriving as an observer raises that question, so an observer that polls
 * without --wait could never remove itself, and each poll left the reviewer a
 * card offering to promote a process that had already exited - which demotes
 * the agent actually working and leaves the plan with a primary nobody is
 * behind. An observer that comes back raises its question again on arrival, so
 * the only question the reviewer is shown is one an agent is still waiting on.
 */
export const detachExitingAgent = async ({
  store,
  sessionId,
  writerId,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly writerId: string;
  readonly now?: number;
}): Promise<ReadonlyArray<AttachedAgent>> =>
  withAgentRoster({
    store,
    sessionId,
    now,
    change: (agents) =>
      agents.filter((agent) => {
        if (agent.writerId !== writerId) return true;
        return (
          agent.claimToken !== undefined && agent.claimClosedAtMs === undefined
        );
      }),
  });

/**
 * Links one agent's registration to the pickup token it claimed with.
 *
 * `agent note` and `agent respond` are separate processes that know their token
 * and not their loop, so without this they cannot ask what role they hold and a
 * displaced agent learns of its displacement only when publication is refused.
 *
 * Recording a token also reopens the record: this agent is mid turn again, and
 * the patience that protects a working agent is owed to it from here until the
 * claim closes.
 */
export const recordAgentClaimToken = async ({
  store,
  sessionId,
  writerId,
  claimToken,
  expectedRole,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly writerId: string;
  readonly claimToken: string;
  readonly expectedRole?: AgentRole;
  readonly now?: number;
}): Promise<ReadonlyArray<AttachedAgent>> =>
  withAgentRoster({
    store,
    sessionId,
    now,
    change: (agents) => {
      const acting = agents.find((agent) => agent.writerId === writerId);
      if (acting === undefined) {
        throw new Error("This agent is no longer attached to the review");
      }
      if (expectedRole !== undefined && acting.role !== expectedRole) {
        throw new Error(`This agent is no longer the review's ${expectedRole}`);
      }
      return agents.map((agent) => {
        if (agent.writerId !== writerId) return agent;
        const { claimClosedAtMs: _reopened, ...rest } = agent;
        return { ...rest, claimToken };
      });
    },
  });

/**
 * Records that the claim this token names is over.
 *
 * Holding an open claim is the one reason an unheard-from agent is presumed
 * busy rather than gone, so the moment that stops being true the roster has to
 * say so. Otherwise an agent that answered and exited goes on occupying the
 * primary role for the whole recovery horizon, and the next agent to connect -
 * including that same agent, coming back for its next turn - is told the plan
 * already has someone answering it (BIG-171).
 */
export const closeAgentClaim = async ({
  store,
  sessionId,
  claimToken,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly claimToken: string;
  readonly now?: number;
}): Promise<ReadonlyArray<AttachedAgent>> =>
  withAgentRoster({
    store,
    sessionId,
    now,
    change: (agents) =>
      agents.map((agent) =>
        agent.claimToken === claimToken
          ? { ...agent, claimClosedAtMs: now }
          : agent,
      ),
  });

/**
 * Forgets an inherited draft once its agent has been handed it.
 *
 * The reviewer carried one draft to one agent for one hand-off. Left on the
 * record it would ride every later pickup, pointing a fresh turn at a stage
 * from a request that finished long ago and telling the agent to read it as
 * reference.
 */
export const clearInheritedDraft = async ({
  store,
  sessionId,
  writerId,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly writerId: string;
  readonly now?: number;
}): Promise<ReadonlyArray<AttachedAgent>> =>
  withAgentRoster({
    store,
    sessionId,
    now,
    change: (agents) =>
      agents.map((agent) => {
        if (agent.writerId !== writerId) return agent;
        const { inheritedDraftPath: _handed, ...rest } = agent;
        return rest;
      }),
  });

/**
 * Raises the question an arriving observer held back.
 *
 * An agent that arrives while the incumbent is between turns cannot yet be
 * called a second agent, so it attaches without asking (see
 * `attachAgentToRoster`). This is where that held question is raised, and it is
 * raised whenever a primary is still attached. A closed claim with no later
 * signal proves the incumbent has finished its last turn; keeping the question
 * parked until that departed agent returns strands the newcomer forever
 * (BIG-253).
 *
 * An empty seat raises nothing. There is no second agent to ask about - the
 * one this session arrived beside has gone - and a card reading "a second
 * agent wants to answer you" would be about nobody. An empty seat is answered
 * by succession when silence emptied it, and by the reviewer when they did;
 * the question stays held either way, so it is still there to raise if a
 * primary does turn up.
 *
 * A question the reviewer has already answered is never re-raised: their
 * answer strips the deferral along with the request, so there is nothing left
 * here to act on.
 */
export const requestAgentPrimacy = async ({
  store,
  sessionId,
  writerId,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly writerId: string;
  readonly now?: number;
}): Promise<ReadonlyArray<AttachedAgent>> =>
  withAgentRoster({
    store,
    sessionId,
    now,
    change: (agents) => {
      const incumbent = selectPrimaryAgent({ agents, nowMs: now });
      if (incumbent === undefined) {
        return agents;
      }
      return agents.map((agent) => {
        /*
        Only a held question is raised here.

        The field has one owner - arrival - and this is arrival finishing what
        it started, not a second way to ask. An observer carrying no deferral
        has either asked already or been answered, and re-raising the second
        would put a question back in front of the reviewer that they have
        settled.
        */
        if (
          agent.writerId !== writerId ||
          agent.role !== "observer" ||
          agent.unsettledArrivalAtMs === undefined
        ) {
          return agent;
        }
        const { unsettledArrivalAtMs: _settled, ...rest } = agent;
        return {
          ...rest,
          requestedPrimacyAtMs: agent.requestedPrimacyAtMs ?? now,
        };
      });
    },
  });

/** Applies the reviewer's answer: make this observer the primary. */
export const grantAgentPrimacy = async ({
  store,
  sessionId,
  writerId,
  inheritedDraftPath,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly writerId: string;
  /** The outgoing agent's draft, when the reviewer chose to carry it over. */
  readonly inheritedDraftPath?: string;
  readonly now?: number;
}): Promise<ReadonlyArray<AttachedAgent>> =>
  withAgentRoster({
    store,
    sessionId,
    now,
    change: (agents) =>
      applyPrimacyHandoff({
        agents,
        writerId,
        nowMs: now,
        ...(inheritedDraftPath === undefined ? {} : { inheritedDraftPath }),
      }),
  });

/** Applies the reviewer's answer: leave this agent where it is. */
export const declineAgentPrimacy = async ({
  store,
  sessionId,
  writerId,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly writerId: string;
  readonly now?: number;
}): Promise<ReadonlyArray<AttachedAgent>> =>
  withAgentRoster({
    store,
    sessionId,
    now,
    change: (agents) => applyPrimacyDeclined({ agents, writerId }),
  });

/**
 * Removes one agent from the roster at the reviewer's request.
 *
 * The removal is recorded as well as performed, and both halves are needed.
 * Dropping the record alone is undone by the agent itself: a waiting loop
 * refreshes twice a second, finds nothing under its id, and registers again as
 * an arrival. The recorded answer is what its next refresh reads instead, so
 * the loop is told and stops rather than churning. Big Plan still has no way
 * to stop a process on the reviewer's machine, and the button promises only
 * what this delivers: the agent is out of the review and finds out at its next
 * command.
 *
 * A disconnected primary leaves the role empty rather than handing it to an
 * observer. Who answers the reviewer is the reviewer's decision, and inventing
 * a successor here would make it silently.
 */
export const detachAgentFromRoster = async ({
  store,
  sessionId,
  writerId,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly writerId: string;
  readonly now?: number;
}): Promise<ReadonlyArray<AttachedAgent>> => {
  let removed: AttachedAgent | undefined;
  return withAgentRoster({
    store,
    sessionId,
    now,
    change: (agents) => {
      removed = agents.find((agent) => agent.writerId === writerId);
      return agents.filter((agent) => agent.writerId !== writerId);
    },
    disconnect: () => ({
      writerId,
      ...(removed?.claimToken === undefined
        ? {}
        : { claimToken: removed.claimToken }),
      atMs: now,
    }),
  });
};

/** Reads the coding-agent presence signal without turning stale data into work. */
export const readAgentPresence = async ({
  store,
  sessionId,
  now = Date.now(),
  maximumAgeMs = AGENT_STALL_MS,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly now?: number;
  readonly maximumAgeMs?: number;
}): Promise<AgentPresence> => {
  const value = await readStoreJson(store.agentHeartbeatPath);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("sessionId" in value) ||
    value.sessionId !== sessionId ||
    !("state" in value) ||
    (value.state !== "waiting" &&
      value.state !== "working" &&
      value.state !== "ended") ||
    !("updatedAtMs" in value) ||
    typeof value.updatedAtMs !== "number" ||
    !Number.isFinite(value.updatedAtMs) ||
    now - value.updatedAtMs < 0
  ) {
    return { connected: false, state: "waiting" };
  }
  /*
  Identity outlives the signal that carried it.

  Who the agent is and whether it answered recently are two different questions,
  and this record answers both. Expiring the whole record on the freshness check
  made the second answer erase the first: nothing renews the plan-wide heartbeat
  during a long working turn (BIG-147), so an agent that was mid-answer stopped
  being anyone at all, and the card that should have said which agent had gone
  quiet said nothing instead. What it declared about itself stays until another
  agent declares something else.
  */
  const model =
    "model" in value ? decodeAgentModelIdentity(value.model) : undefined;
  const writerId =
    "writerId" in value && typeof value.writerId === "string"
      ? value.writerId
      : undefined;
  const identity = {
    ...(model === undefined ? {} : { model }),
    ...(writerId === undefined ? {} : { writerId }),
  };
  // An end the loop observed needs no aging: the question aging answers has
  // already been answered, by the only process that could answer it.
  if (value.state === "ended") {
    return {
      connected: false,
      state: "waiting",
      updatedAtMs: value.updatedAtMs,
      ...identity,
      endedAtMs:
        "endedAtMs" in value &&
        typeof value.endedAtMs === "number" &&
        Number.isFinite(value.endedAtMs)
          ? value.endedAtMs
          : value.updatedAtMs,
    };
  }
  if (now - value.updatedAtMs > maximumAgeMs) {
    return {
      connected: false,
      state: "waiting",
      updatedAtMs: value.updatedAtMs,
      ...identity,
    };
  }
  const requestId =
    "requestId" in value &&
    typeof value.requestId === "string" &&
    /^[a-f0-9]{16}$/.test(value.requestId)
      ? value.requestId
      : undefined;
  return {
    connected: true,
    state: value.state,
    ...(requestId === undefined ? {} : { requestId }),
    ...identity,
    updatedAtMs: value.updatedAtMs,
  };
};
