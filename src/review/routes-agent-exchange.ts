// The routes that carry the conversation with the agent: the exchange the
// browser polls, and the progress events the runtime and the agent append to
// it.

import { readFile } from "node:fs/promises";
import { jsonResponse, payloadOf, refusal } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import {
  AgentExchangeRejected,
  deriveSnapshotDigest,
  messageAgentRequest,
  readAgentExchange,
  readValidatedAgentRequests,
  requestIsTerminal,
} from "./agent-exchange.js";
import { readMutationStage } from "./staged-plan-mutation.js";
import type { ReviewStore } from "./store.js";
import {
  appendProgressEvent,
  cancelAgentRequest,
  deleteQueuedRequest,
  ensureAgentRequest,
  recordAgentConnectionState,
  releaseClaimsForPrimacyHandoff,
  releaseClaimsHeldBy,
  reviseQueuedRequest,
  withPlanClaimLock,
  type ProgressEventDraft,
} from "./request-mailbox.js";
import {
  anchorReviewStore,
  freezeRequestAttachments,
  randomId,
  readAgentConnectionEvents,
  readAgentDisconnectRequestFor,
  declineAgentPrimacy,
  detachAgentFromRoster,
  grantAgentPrimacy,
  readAgentPresence,
  readAgentRoster,
  readProgress,
  writeAgentDisconnectRequest,
  writeSnapshot,
  type AgentRequestDeletionResult,
} from "./store.js";
import {
  imageReferencesForBodies,
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_IMAGE_BYTES,
} from "./shared/review-image.js";
import { readCommittedRevisionsToObserve } from "./change-set-commit.js";
import { settleInterruptedCommitsFor } from "./staged-plan-mutation.js";
import { encodeAgentSnapshot, encodeProgress } from "./shared/review-wire.js";
import { AGENT_DISCONNECTED_REASON } from "./shared/agent-disconnect.js";
import { heldAgentClaim } from "./shared/agent-claim.js";
import { settlementRefusal } from "./review-route-settlement.js";
import { agentIsAttached } from "./shared/agent-primacy.js";

const appendProgressBestEffort = async ({
  context,
  event,
  failureMessage,
}: {
  readonly context: ReviewRouteContext;
  readonly event: ProgressEventDraft;
  readonly failureMessage: string;
}): Promise<void> => {
  try {
    await appendProgressEvent({ store: context.store, event });
  } catch (error: unknown) {
    context.reportDiagnostic({ message: failureMessage, error });
  }
};

/**
 * Reading the exchange is also how the runtime learns that a revision landed,
 * so it advances reader progress before answering.
 *
 * The committed revision log is what moves the reader, not the response file.
 * A revision is recorded only inside the terminal commit, after the source
 * swap, so the snapshot the reader is sent is always one the plan file really
 * reached.
 *
 * The browser polls this route for the life of the review, so only the
 * revisions the reader can be moved onto right now are read; the rest of the
 * log costs a directory listing and nothing more.
 */
export const readAgentSnapshot = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const { store, sessionId, planId, readerProgress } = context;
  const exchange = await readAgentExchange({ store, sessionId, planId });
  // One payload describes one instant, so the reader is moved only onto a
  // revision whose request this very exchange already reports as answered. A
  // commit that landed mid-read leaves its revision for the next poll, which
  // is 1.5 seconds away, rather than sending a snapshot whose response the
  // same payload still calls pending.
  const answered = new Set(
    exchange.requests.flatMap((request) =>
      request.answeredAt === undefined ? [] : [request.requestId],
    ),
  );
  for (const revision of await readCommittedRevisionsToObserve({
    store,
    shouldObserve: (requestId) =>
      answered.has(requestId) && !readerProgress.hasObserved(requestId),
  })) {
    readerProgress.observe(revision);
  }
  const presence = await readAgentPresence({ store, sessionId });
  // Read against this presence record, so a disconnect the reviewer asked for
  // reports itself only while the agent it addressed is still the one the
  // review names. The browser draws the control's pending state from it.
  const disconnect = await readAgentDisconnectRequestFor({
    store,
    ...(presence.writerId === undefined ? {} : { writerId: presence.writerId }),
  });
  const connectionLog = await readAgentConnectionEvents({ store, sessionId });
  const agents = await readAgentRoster({ store, sessionId });
  return jsonResponse({
    status: 200,
    value: encodeAgentSnapshot(
      {
        // The browser reloads only revisions the response command has
        // rendered, linted, and accepted. Watching the raw file here would
        // navigate the reviewer onto a transient parse error while an agent
        // is midway through editing the authoritative MDX.
        currentSnapshot: readerProgress.currentSnapshot(),
        presence: {
          ...presence,
          ...(disconnect === undefined
            ? {}
            : { disconnectRequestedAtMs: disconnect.requestedAtMs }),
        },
        agents,
        connectionLog,
        plan: context.resolvedPlanPath,
        agentCommand: context.agentCommand,
        recoveryPrompt: context.recoveryPrompt,
        requests: exchange.requests,
        responses: exchange.responses,
      },
      { nowMs: Date.now() },
    ),
  });
};

export const readProgressEvents = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const events = await readProgress({
    store: context.store,
    sessionId: context.sessionId,
  });
  return jsonResponse({ status: 200, value: encodeProgress({ events }) });
};

/**
 * Queues one reply or plan question for the agent. The plan as it stands right
 * now becomes the request's premise, so the agent can tell what the reviewer
 * was looking at when they wrote it.
 */
export const sendAgentRequest = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { planId, sessionId, resolvedPlanPath, planRenderer } = context;
  let { store } = context;
  const payload = payloadOf(body);
  const kind = payload.kind;
  if (kind !== "reply" && kind !== "chat") {
    return refusal({
      status: 400,
      reason: 'An agent request kind must be "reply" or "chat"',
    });
  }
  const messageBody =
    typeof payload.body === "string" ? payload.body.trim() : "";
  if (messageBody === "") {
    return refusal({ status: 400, reason: "An agent request needs a body" });
  }
  // A requestId turns the same submission into an edit of the message already
  // waiting, so an edit rides the validation of the send it replaces and can
  // never create a second message.
  if (payload.requestId !== undefined) {
    const requestId = payload.requestId;
    if (typeof requestId !== "string") {
      return refusal({ status: 400, reason: "A request id is required" });
    }
    const exchange = await readAgentExchange({ store, sessionId, planId });
    const existing = exchange.requests.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (existing === undefined) {
      return refusal({ status: 404, reason: "No such agent request" });
    }
    if (existing.kind !== kind) {
      return refusal({
        status: 409,
        reason: "A revision cannot change the kind of a message",
      });
    }
    // An interrupted commit is settled before the mailbox is touched, so the
    // journal guard refuses only an answer that really is published or one rename
    // away from it, never one an abandoned commit left in its own stage - which
    // would relock exactly the request an abandoned claim hands back (BIG-120).
    try {
      await settleInterruptedCommitsFor({
        store,
        planPath: resolvedPlanPath,
        requestIds: [requestId],
      });
    } catch (error: unknown) {
      return settlementRefusal(error);
    }
    let revised;
    try {
      revised = await reviseQueuedRequest({
        store,
        requestId,
        body: messageBody,
        // Presence is half the proof that a claim was abandoned, and the
        // mailbox refuses on the same rule the browser offered on (BIG-120).
        agentConnected: (await readAgentPresence({ store, sessionId }))
          .connected,
      });
    } catch (error: unknown) {
      if (!(error instanceof AgentExchangeRejected)) throw error;
      return refusal({ status: 409, reason: error.message });
    }
    await appendProgressBestEffort({
      context,
      event: {
        sessionId,
        requestId,
        atMs: Date.now(),
        stepCode: "queued-message-revised",
        step: "Queued message edited by reviewer",
        state: "waiting",
      },
      failureMessage: `Review progress update failed after revising request ${requestId}`,
    });
    return jsonResponse({
      status: 200,
      value: { requestId, kind: revised.kind, request: revised },
    });
  }
  const requestId = randomId(8);
  const source = await readFile(resolvedPlanPath, "utf8");
  const premiseSnapshot = deriveSnapshotDigest(source);
  let requestDraft: ReturnType<typeof messageAgentRequest>;
  try {
    requestDraft = messageAgentRequest({
      kind,
      requestId,
      sessionId,
      planId,
      premiseSnapshot,
      createdAt: new Date().toISOString(),
      body: messageBody,
      ...(kind === "reply" && typeof payload.commentId === "string"
        ? { commentId: payload.commentId }
        : {}),
    });
  } catch (error: unknown) {
    if (!(error instanceof AgentExchangeRejected)) throw error;
    return refusal({ status: 400, reason: error.message });
  }
  store = await (await anchorReviewStore(store)).resolveStore();
  await writeSnapshot({ store, snapshot: premiseSnapshot, source });
  const imageReferences = imageReferencesForBodies([messageBody]);
  if (imageReferences.length > MAX_IMAGES_PER_MESSAGE) {
    return refusal({
      status: 400,
      reason: `A message can contain at most ${MAX_IMAGES_PER_MESSAGE} images`,
    });
  }
  let attachments;
  try {
    attachments = await freezeRequestAttachments({
      store,
      requestId,
      references: imageReferences,
      totalByteLimit: MAX_MESSAGE_IMAGE_BYTES,
    });
  } catch (error: unknown) {
    return refusal({
      status: 400,
      reason:
        error instanceof Error
          ? error.message
          : "An image could not be attached",
    });
  }
  const agentRequest = {
    ...requestDraft,
    attachmentManifest: attachments,
    attachments,
  };
  if (agentRequest.kind === "reply") {
    const sent = await planRenderer.readStoredComments(store.sentPath);
    if (!sent.some((comment) => comment.id === agentRequest.commentId)) {
      return refusal({
        status: 400,
        reason: "The reply points at a comment this session did not send",
      });
    }
  }
  let storedRequest;
  try {
    storedRequest = await ensureAgentRequest({
      store,
      request: agentRequest,
    });
  } catch (error: unknown) {
    if (!(error instanceof AgentExchangeRejected)) throw error;
    return refusal({ status: 409, reason: error.message });
  }
  await appendProgressBestEffort({
    context,
    event: {
      sessionId,
      atMs: Date.now(),
      stepCode: storedRequest.kind === "reply" ? "reply-sent" : "chat-sent",
      step:
        storedRequest.kind === "reply"
          ? "Reply sent to agent"
          : "Plan question sent to agent",
      state: "waiting",
    },
    failureMessage: `Review progress update failed after queuing request ${storedRequest.requestId}`,
  });
  return jsonResponse({
    status: 200,
    value: {
      requestId: storedRequest.requestId,
      kind: storedRequest.kind,
      request: storedRequest,
    },
  });
};

/** Deletes a request the agent has not started. */
export const deleteQueuedAgentRequest = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, planId, sessionId, resolvedPlanPath } = context;
  const payload = payloadOf(body);
  const requestId = payload.requestId;
  if (typeof requestId !== "string") {
    return refusal({ status: 400, reason: "A request id is required" });
  }
  const exchange = await readAgentExchange({ store, sessionId, planId });
  if (
    !exchange.requests.some((candidate) => candidate.requestId === requestId)
  ) {
    return refusal({ status: 404, reason: "No such agent request" });
  }
  // An interrupted commit is settled before the mailbox is touched, so the
  // journal guard refuses only an answer that really is published or one rename
  // away from it, never one an abandoned commit left in its own stage - which
  // would relock exactly the request an abandoned claim hands back (BIG-120).
  try {
    await settleInterruptedCommitsFor({
      store,
      planPath: resolvedPlanPath,
      requestIds: [requestId],
    });
  } catch (error: unknown) {
    return settlementRefusal(error);
  }
  let deletion: AgentRequestDeletionResult;
  try {
    deletion = await deleteQueuedRequest({
      store,
      requestId,
      agentConnected: (await readAgentPresence({ store, sessionId })).connected,
    });
  } catch (error: unknown) {
    if (!(error instanceof AgentExchangeRejected)) throw error;
    return refusal({ status: 409, reason: error.message });
  }
  if (deletion.attachmentCleanup === "failed") {
    context.reportDiagnostic({
      message: `Review attachment cleanup failed after deleting request ${requestId}`,
      error: deletion.cleanupError,
    });
  }
  // The request is gone, so the event belongs to the session rather than to a
  // requestId no reader can resolve.
  await appendProgressBestEffort({
    context,
    event: {
      sessionId,
      atMs: Date.now(),
      stepCode: "queued-message-deleted",
      step: "Queued message deleted",
      state: "done",
    },
    failureMessage: `Review progress update failed after deleting request ${requestId}`,
  });
  return jsonResponse({ status: 200, value: { requestId } });
};

/** What the claim gate decided: who was disconnected, or why nobody was. */
type DisconnectDecision =
  | { readonly refusal: string }
  | {
      readonly requestedAtMs: number;
      readonly presenceWasConnected: boolean;
      /**
       * Whether the live presence record describes the agent just addressed.
       *
       * False whenever a second agent owns the heartbeat, which is what tells
       * the caller that no ordinary edge will ever report this departure.
       */
      readonly presenceNamedAddressee: boolean;
      readonly claimToken?: string;
      readonly requestId?: string;
    };

/**
 * Tells the attached agent to disconnect, and frees the review for the next one.
 *
 * The directive is a message, not a kill: nothing here reaches into the agent's
 * process. It records who the reviewer disconnected, and the agent reads that at
 * its next command and ends its own session, which is what makes the connection
 * log's end a reported one rather than a gap Big Plan inferred (BIG-156).
 *
 * The claim is released here rather than waiting for that acknowledgment,
 * because a mid-turn agent may not run another command for minutes and the
 * whole point of disconnecting is that the review is free now. The reviewer was
 * told the in-flight answer would be dropped before they confirmed; this is that
 * sentence coming true.
 */
export const disconnectAgent = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const { store, sessionId, planId } = context;
  /*
  Deciding who to address and recording it are one step against every claim
  transition on this plan.

  Read them apart and a pickup landing in between is addressed by neither name:
  the read sees no claim so the directive carries only the loop's writer id,
  while `agent note` and `agent respond` know only their pickup token, so the
  agent the reviewer just disconnected keeps working and publishes. Taking the
  gate `claimAgentRequest` already takes means the claim is either visible here
  and named, or taken afterwards - and a loop that claims afterwards rechecks
  this directive before it hands the work over (BIG-190).
  */
  const decision = await withPlanClaimLock<DisconnectDecision>({
    store,
    change: async (claimStore): Promise<DisconnectDecision> => {
      const presence = await readAgentPresence({
        store: claimStore,
        sessionId,
      });
      const exchange = await readAgentExchange({
        store: claimStore,
        sessionId,
        planId,
      });
      // The same evidence the card shows the control from: an agent is here if
      // it is signalling, or if it is holding work. Nothing renews the heartbeat
      // while a turn runs (BIG-147), so requiring a live signal would refuse a
      // disconnect in the one state where the reviewer most wants one.
      const claimed = heldAgentClaim(exchange.requests);
      if (!presence.connected && claimed === undefined) {
        return { refusal: "No agent is connected to this review" };
      }
      const claimToken = claimed?.claimedBy;
      /*
      One agent, named once, by a name that outlives this decision.

      Presence and the live claim are read from two different agents whenever
      two are attached: a waiting loop writes the heartbeat every half second
      while the agent that is actually working renews only its claim, so the
      card can describe one agent's work under the other's name. Naming both
      ended a bystander the reviewer never saw.

      So the claim decides who, when there is one - the claim-derived state is
      exactly what the card showed and exactly what the dialog's "the answer it
      has in flight is dropped" warned about. But it decides who by the
      connection the claim records rather than by the pickup token, because the
      release below destroys that token within milliseconds and an address
      nobody can resolve afterwards leaves the reviewer's own decision reported
      as silence. A claim taken without a declared connection is answered from
      presence only when presence names that very request, which is the proof
      that presence describes the holder and not a bystander (BIG-190).
      */
      const addressee =
        claimed === undefined
          ? presence.writerId
          : (claimed.claimedByConnection ??
            (presence.requestId === claimed.requestId
              ? presence.writerId
              : undefined));
      if (addressee === undefined) {
        // A directive addressed to nobody would be a standing order against
        // every agent that ever attaches, so it is refused rather than written.
        return {
          refusal:
            "This agent cannot be identified, so it cannot be disconnected",
        };
      }
      const requestedAtMs = Date.now();
      await writeAgentDisconnectRequest({
        store: claimStore,
        directive: { requestedAtMs, writerId: addressee },
      });
      return {
        requestedAtMs,
        presenceWasConnected: presence.connected,
        presenceNamedAddressee: presence.writerId === addressee,
        ...(claimToken === undefined ? {} : { claimToken }),
        ...(claimed === undefined ? {} : { requestId: claimed.requestId }),
      };
    },
  });
  if ("refusal" in decision) {
    return refusal({ status: 409, reason: decision.refusal });
  }
  const { requestedAtMs } = decision;
  const claimToken = "claimToken" in decision ? decision.claimToken : undefined;
  // Released outside the claim gate, in the order `claimAgentRequest`
  // established: that call takes this gate and then each request lock, so
  // taking a request lock while still holding the gate would invert it.
  const released =
    claimToken === undefined
      ? []
      : await releaseClaimsHeldBy({
          store,
          sessionId,
          planId,
          claimedBy: claimToken,
          step: "Claim released when the reviewer disconnected the agent",
          detail:
            "The answer that agent had in flight was dropped; the message itself is back in the queue for the next agent",
        });
  /*
  The reviewer's decision, recorded on the connection log at the instant it was
  taken rather than left for the agent to confirm.

  It is written only when the review's presence has already stopped - a stalled
  turn, an agent killed mid-answer, a session restarted underneath a live claim.
  In every one of those the connection the log describes has ended and the
  reviewer is the only one left who can say why, and a restarted session no
  longer names the writer the ordinary edge would look the directive up by.
  While presence is still live the log is still describing a connected review,
  and the ordinary edge reports the end when it arrives.

  The record supersedes an inferred gap and never replaces it, so the silence
  Big Plan honestly wrote down keeps its row and the end somebody asked for is
  stated after it (BIG-156).

  It is written for a live presence too, in the one case where that presence is
  somebody else: with two agents attached, a waiting loop owns the heartbeat
  while the agent being disconnected owns only its claim. "The ordinary edge
  reports it" holds only while the log is describing the agent that left, and
  here it never will - presence goes on describing the bystander, healthy and
  connected, long after the addressee has gone. Left to that edge the reviewer's
  own decision is reported as nothing at all, which is the inferred gap
  requirement 1 exists to rule out (BIG-190).
  */
  if (!decision.presenceWasConnected || !decision.presenceNamedAddressee) {
    await recordAgentConnectionState({
      store,
      sessionId,
      connected: false,
      at: new Date(requestedAtMs).toISOString(),
      disconnectReason: AGENT_DISCONNECTED_REASON,
    }).catch(() => undefined);
  }
  await appendProgressBestEffort({
    context,
    event: {
      sessionId,
      atMs: requestedAtMs,
      stepCode: "agent-disconnect-requested",
      step: "Disconnect requested by reviewer",
      state: "done",
      detail:
        "The agent is told at its next command; the review is free for another agent now",
      ...("requestId" in decision ? { requestId: decision.requestId } : {}),
    },
    failureMessage: `Review progress update failed after requesting an agent disconnect for session ${sessionId}`,
  });
  return jsonResponse({
    status: 200,
    value: { requestedAtMs, releasedRequestIds: released },
  });
};

/** Withdraws a request the agent has not answered yet. */
export const cancelPendingAgentRequest = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, planId, sessionId, resolvedPlanPath } = context;
  const payload = payloadOf(body);
  const requestId = payload.requestId;
  if (typeof requestId !== "string") {
    return refusal({ status: 400, reason: "A request id is required" });
  }
  // An interrupted commit is settled before the mailbox is touched, and under
  // the plan-mutation lock this releases before any request lock is taken. A
  // journal an abandoned commit left behind is rolled back here, so the cancel
  // refuses only an answer that really is published or one rename away from
  // it, rather than one that never left the agent's stage.
  try {
    await settleInterruptedCommitsFor({
      store,
      planPath: resolvedPlanPath,
      requestIds: [requestId],
    });
  } catch (error: unknown) {
    return settlementRefusal(error);
  }
  const exchange = await readAgentExchange({ store, sessionId, planId });
  const agentRequest = exchange.requests.find(
    (candidate) => candidate.requestId === requestId,
  );
  if (agentRequest === undefined) {
    return refusal({ status: 404, reason: "No such agent request" });
  }
  if (
    exchange.responses.some(
      (candidate) => candidate.requestId === agentRequest.requestId,
    )
  ) {
    return refusal({
      status: 409,
      reason: "The agent has already answered this request",
    });
  }
  let canceled;
  try {
    canceled = await cancelAgentRequest({
      store,
      requestId: agentRequest.requestId,
      now: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (!(error instanceof AgentExchangeRejected)) throw error;
    return refusal({ status: 409, reason: error.message });
  }
  await appendProgressBestEffort({
    context,
    event: {
      sessionId,
      requestId: canceled.requestId,
      atMs: Date.now(),
      stepCode: "request-canceled",
      step: "Request canceled by reviewer",
      state: "done",
    },
    failureMessage: `Review progress update failed after canceling request ${requestId}`,
  });
  return jsonResponse({ status: 200, value: { request: canceled } });
};

/**
 * The candidate file the current holder has been editing, if there is one.
 *
 * Read before the claim is released, because the claim is what names the stage
 * the file lives in. Returns nothing when no claim is open or the stage was
 * never created, so the reviewer's choice degrades to "there was nothing to
 * carry" rather than to a broken path in the next agent's work item.
 */
const outgoingDraftPath = async ({
  store,
  sessionId,
  planId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
}): Promise<string | undefined> => {
  const held = (
    await readValidatedAgentRequests({ store, sessionId, planId })
  ).find(
    (request) => !requestIsTerminal(request) && request.claimedBy !== undefined,
  );
  if (held?.claimedBy === undefined) return undefined;
  try {
    const stage = await readMutationStage({
      store,
      requestId: held.requestId,
      claimedBy: held.claimedBy,
    });
    return stage.candidatePath;
  } catch {
    return undefined;
  }
};

/**
 * Applies the reviewer's answer about which agent speaks for this plan.
 *
 * The three answers are one route because they are one decision with three
 * outcomes, and because they share every precondition: a live session, a named
 * agent, and a roster whose invariant must hold across the write. Splitting
 * them would duplicate those checks and let the three drift apart.
 *
 * Nothing here stops a process. Disconnecting removes the registration, and the
 * agent is told at its next command; Big Plan cannot kill a process on the
 * reviewer's machine, and a button implying otherwise would promise what the
 * product cannot deliver.
 */
export const answerAgentPrimacy = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, sessionId, planId } = context;
  const payload = payloadOf(body);
  const writerId = payload.writerId;
  const answer = payload.answer;
  if (typeof writerId !== "string" || writerId === "") {
    return refusal({ status: 400, reason: "An answer must name an agent" });
  }
  if (
    answer !== "primary" &&
    answer !== "observer" &&
    answer !== "disconnect"
  ) {
    return refusal({
      status: 400,
      reason: 'An answer must be "primary", "observer", or "disconnect"',
    });
  }
  const attached = await readAgentRoster({ store, sessionId });
  const nowMs = Date.now();
  // The same test the cards are drawn from. A record the roster has stopped
  // counting as here describes a process that is gone, and answering a
  // question about it would install a dead agent as the plan's primary.
  const target = attached.find(
    (agent) => agent.writerId === writerId && agentIsAttached({ agent, nowMs }),
  );
  if (target === undefined) {
    return refusal({ status: 404, reason: "That agent is not attached" });
  }
  /*
  The turn this answer leaves in flight, when it leaves one.

  Removing the record is not by itself a fence: the commands that finish a turn
  know their token and not their registration, so a disconnected agent whose
  claim was left open still publishes the revision the reviewer had just
  removed it from - and the card promised the opposite. The release below is
  the same boundary a hand-off uses, named to this agent's own token so an
  answer about one agent can never reach into a turn another one is mid way
  through.
  */
  const disconnectedTurn =
    answer === "disconnect" && target.claimClosedAtMs === undefined
      ? target.claimToken
      : undefined;
  /*
  The reviewer may hand the outgoing agent's unpublished draft to the new
  primary. It is resolved before anything moves, because the release below is
  what frees the claim that names the stage the draft lives in.

  Carrying it over is deliberately a pointer and not a seed: the new primary
  still starts from the last published revision, and the draft is one more
  input it may read. Seeding the candidate with another model's half-finished
  work would publish it by default, which is the opposite of what the toggle
  promises.
  */
  const carryWorkInProgress = payload.carryWorkInProgress === true;
  const inheritedDraftPath =
    answer === "primary" && carryWorkInProgress
      ? await outgoingDraftPath({ store, sessionId, planId })
      : undefined;
  const agents =
    answer === "primary"
      ? await grantAgentPrimacy({
          store,
          sessionId,
          writerId,
          now: nowMs,
          ...(inheritedDraftPath === undefined ? {} : { inheritedDraftPath }),
        })
      : answer === "observer"
        ? await declineAgentPrimacy({ store, sessionId, writerId })
        : await detachAgentFromRoster({ store, sessionId, writerId });
  if (answer === "primary") {
    /*
    The roster moves first, and the claim is freed after it.

    Both have to happen and they cannot be one write, so the order is chosen by
    which half-finished state is survivable. Grant first and the new primary may
    briefly wait behind a lease that is already lapsing - visible, temporary,
    and it resolves itself. Release first and a failed grant leaves the
    incumbent still named primary with the claim it is mid turn on silently
    taken away, so it works on until publication and is refused there with a
    message about an agent that never took anything.

    A grant that changed nothing is a target that left between the check above
    and the write. Nothing is released for it: the incumbent keeps the claim it
    is working on, and the reviewer is told the agent they picked has gone
    rather than being left with a plan no agent speaks for.
    */
    if (
      agents.find((agent) => agent.writerId === writerId)?.role !== "primary"
    ) {
      return refusal({ status: 404, reason: "That agent is not attached" });
    }
    await releaseClaimsForPrimacyHandoff({ store, sessionId, planId });
  }
  if (disconnectedTurn !== undefined) {
    await releaseClaimsForPrimacyHandoff({
      store,
      sessionId,
      planId,
      claimedBy: disconnectedTurn,
      step: "Claim released when you disconnected this agent",
      detail:
        "The disconnected agent can no longer publish it; send this message again for the agent that answers you now",
    });
  }
  await appendProgressBestEffort({
    context,
    event: {
      sessionId,
      atMs: Date.now(),
      stepCode: "agent-primacy-answered",
      step:
        answer === "primary"
          ? "Made this agent the primary"
          : answer === "observer"
            ? "Kept this agent as an observer"
            : "Disconnected this agent",
      state: "done",
    },
    failureMessage: "Could not record the agent primacy answer",
  });
  return jsonResponse({ status: 200, value: { agents } });
};
