// The routes that own what the reviewer has done with the changes an agent
// made: the record read back on load, and the one mutation that changes it.
//
// A verdict is a review fact rather than a browser preference, which is the
// whole reason these routes exist. Two surfaces show one change set's standing
// at the same moment, a reload must not reopen work the reviewer closed, and
// approval will later count what is still open. A record only one browser
// holds cannot answer any of those.
//
// One verdict also owns bytes. Accepting a change leaves the plan exactly as
// the agent published it, so accepting writes nothing; rejecting takes that
// change back out, so the plan has to follow the record. The two stay in step
// because the source is derived rather than edited: after every mutation the
// plan is the agent's proposed revision with the whole rejected set of that
// revision put back to the thread's baseline. Undo is the same derivation with
// the place taken out of the set, which is what makes it exact rather than an
// edit that tries to invert an earlier one.

import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";
import { jsonResponse, payloadOf, refusal } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import {
  applyChangeVerdictMutation,
  ChangeVerdictsRejected,
  rejectedPlaceIdsFor,
  validateChangeVerdictMutation,
} from "./change-verdicts-store.js";
import type {
  ChangeVerdictMutation,
  StoredChangeVerdicts,
} from "./change-verdicts-store.js";
import {
  changedPlaceIds,
  ChangeRestoreRejected,
  restoreRejectedPlaces,
} from "./change-restore.js";
import {
  readCommittedChangeSets,
  recordRejectRevision,
} from "./change-set-commit.js";
import { readChangeOwnership } from "./change-ownership.js";
import { buildSnapshotDiff } from "./snapshot-diff.js";
import { renderDocument } from "../render/render-document.js";
import { carryForwardChangeVerdicts } from "./change-carry-forward.js";
import { settlementRefusal } from "./review-route-settlement.js";
import { deriveSnapshotDigest } from "./agent-exchange.js";
import { revertPlanSource } from "./staged-plan-mutation.js";
import { readSnapshot, writeSnapshot } from "./store.js";
import { encodeChangeVerdicts } from "./shared/review-wire.js";

/** What the reviewer reads when the plan is no longer where the record left it. */
const PLAN_MOVED_REASON =
  "The plan changed after this proposal, so this change cannot be put back without overwriting newer work";

// The stored record carries a version this build understands; the wire carries
// the facts a browser counts. Answering with the record itself would publish a
// storage detail no reader has any use for.
const verdictState = (verdicts: StoredChangeVerdicts): ReviewRouteResponse =>
  jsonResponse({
    status: 200,
    value: encodeChangeVerdicts({
      decided: verdicts.decided,
      revision: verdicts.revision,
    }),
  });

/**
 * Brings the plan source into agreement with a revision's rejected places.
 *
 * Both sources are derived rather than remembered: the one the plan should
 * already hold, and the one it should hold next. Proving the first is what
 * keeps this from writing over a revision the reviewer has not seen - an agent
 * that published while the reviewer was deciding leaves the plan somewhere
 * neither derivation describes, and that is a refusal rather than a write.
 */
const reconcilePlanSource = async ({
  context,
  changeSetId,
  from,
  to,
  before,
  after,
}: {
  readonly context: ReviewRouteContext;
  /** The set whose proposed content this write takes back out, or puts back. */
  readonly changeSetId?: string;
  readonly from: string;
  readonly to: string;
  readonly before: ReadonlyArray<string>;
  readonly after: ReadonlyArray<string>;
}): Promise<void> => {
  const { store, resolvedPlanPath, readerProgress } = context;
  const fallbackTitle = basename(resolvedPlanPath, extname(resolvedPlanPath));
  const [baselineSource, proposedSource, ownership] = await Promise.all([
    readSnapshot({ store, snapshot: from }),
    readSnapshot({ store, snapshot: to }),
    readChangeOwnership({
      store,
      sessionId: context.sessionId,
      planId: context.planId,
      from,
      to,
    }),
  ]);
  const restored = (placeIds: ReadonlyArray<string>): string =>
    restoreRejectedPlaces({
      baselineSource,
      proposedSource,
      from,
      to,
      placeIds,
      fallbackTitle,
      ...(ownership === undefined ? {} : { ownership }),
    });
  const expectedSource = restored(before);
  const nextSource = restored(after);
  if (expectedSource === nextSource) return;
  const currentSource = await readFile(resolvedPlanPath, "utf8");
  if (currentSource === nextSource) return;
  const expectedSnapshot = deriveSnapshotDigest(expectedSource);
  if (deriveSnapshotDigest(currentSource) !== expectedSnapshot) {
    throw new ChangeRestoreRejected(PLAN_MOVED_REASON);
  }
  const nextSnapshot = deriveSnapshotDigest(nextSource);
  // The derived revision is stored before it is published so every surface
  // that resolves the plan's current digest - the change-set fold, a later
  // diff - can read the bytes behind it rather than finding a digest with no
  // snapshot under it.
  await writeSnapshot({ store, snapshot: nextSnapshot, source: nextSource });
  await revertPlanSource({
    store,
    planPath: resolvedPlanPath,
    expectedSnapshot,
    source: nextSource,
  });
  // The write landed, so the log is told how the plan got from the digest it
  // held to the one it holds now. An unrecorded move leaves the chain broken
  // at exactly the point a reviewer acted, and everything derived by walking
  // that chain goes with it.
  if (changeSetId !== undefined) {
    await recordRejectRevision({
      store,
      changeSetIds: [changeSetId],
      baseSnapshot: expectedSnapshot,
      resultSnapshot: nextSnapshot,
      committedAt: new Date().toISOString(),
    });
  }
  readerProgress.accept(nextSnapshot);
};

/** Repairs a verdict write whose following derived-source write was interrupted. */
const reconcileRecordedRejections = async ({
  context,
  verdicts,
}: {
  readonly context: ReviewRouteContext;
  readonly verdicts: StoredChangeVerdicts;
}): Promise<void> => {
  // One span, not one span per owner: the bytes a repair writes are derived
  // from every rejection recorded against the revision, whoever made it. The
  // owners are read back from those rejections below rather than carried here,
  // because a map keyed by the span alone can only remember the last one seen -
  // and recording the repair under an owner that never rejected that place is
  // exactly the cross-owner attribution this feature exists to prevent.
  const revisions = new Map<string, { from: string; to: string }>();
  for (const changeSet of await readCommittedChangeSets({
    store: context.store,
  })) {
    revisions.set(`${changeSet.baseSnapshot}:${changeSet.resultSnapshot}`, {
      from: changeSet.baseSnapshot,
      to: changeSet.resultSnapshot,
    });
  }
  for (const entry of verdicts.decided) {
    revisions.set(`${entry.from}:${entry.to}`, {
      from: entry.from,
      to: entry.to,
    });
  }
  const { store, resolvedPlanPath, readerProgress } = context;
  const currentSource = await readFile(resolvedPlanPath, "utf8");
  const matches: Array<{
    readonly source: string;
    readonly changeSetIds: ReadonlyArray<string>;
  }> = [];
  for (const { from, to } of revisions.values()) {
    // A revision from a digest to itself describes no change, so there is
    // nothing for a rejection to have been interrupted in the middle of.
    if (from === to) continue;
    const fallbackTitle = basename(resolvedPlanPath, extname(resolvedPlanPath));
    const [baselineSource, proposedSource, ownership] = await Promise.all([
      readSnapshot({ store, snapshot: from }),
      readSnapshot({ store, snapshot: to }),
      readChangeOwnership({
        store,
        sessionId: context.sessionId,
        planId: context.planId,
        from,
        to,
      }),
    ]);
    const rejected = rejectedPlaceIdsFor({ verdicts, from, to });
    const restored = (placeIds: ReadonlyArray<string>): string =>
      restoreRejectedPlaces({
        baselineSource,
        proposedSource,
        from,
        to,
        placeIds,
        fallbackTitle,
        ...(ownership === undefined ? {} : { ownership }),
      });
    const intendedSource = restored(rejected);
    if (currentSource === intendedSource) return;
    const rejectedSet = new Set(rejected);
    const places = changedPlaceIds({
      baselineSource,
      proposedSource,
      from,
      to,
      fallbackTitle,
      ...(ownership === undefined ? {} : { ownership }),
    });
    let matchingNeighbors = 0;
    for (const placeId of places) {
      const neighbor = rejectedSet.has(placeId)
        ? rejected.filter((candidate) => candidate !== placeId)
        : [...rejected, placeId];
      try {
        if (restored(neighbor) === currentSource) {
          matchingNeighbors += 1;
        }
      } catch (error: unknown) {
        if (!(error instanceof ChangeRestoreRejected)) throw error;
      }
    }
    if (matchingNeighbors === 1) {
      // The revision names every set whose proposed content this repair takes
      // back out, read from the rejections that produced these bytes.
      matches.push({
        source: intendedSource,
        changeSetIds: [
          ...new Set(
            verdicts.decided
              .filter(
                (entry) =>
                  entry.verdict === "rejected" &&
                  entry.from === from &&
                  entry.to === to,
              )
              .map((entry) => entry.changeSetId),
          ),
        ],
      });
    }
  }
  if (matches.length !== 1) return;
  const match = matches[0];
  if (match === undefined) return;
  const intendedSource = match.source;
  const expectedSnapshot = deriveSnapshotDigest(currentSource);
  const nextSnapshot = deriveSnapshotDigest(intendedSource);
  await writeSnapshot({
    store,
    snapshot: nextSnapshot,
    source: intendedSource,
  });
  await revertPlanSource({
    store,
    planPath: resolvedPlanPath,
    expectedSnapshot,
    source: intendedSource,
  });
  // The repair completes a write the reviewer's decision started, so the log
  // records it for the same reason the decision itself does.
  if (match.changeSetIds.length > 0) {
    await recordRejectRevision({
      store,
      changeSetIds: match.changeSetIds,
      baseSnapshot: expectedSnapshot,
      resultSnapshot: nextSnapshot,
      committedAt: new Date().toISOString(),
    });
  }
  readerProgress.accept(nextSnapshot);
};

/**
 * Reads the recorded verdicts, carries any that a committed round left behind
 * onto the span their change set now spans, and repairs an interrupted
 * rejection publish.
 *
 * Carrying here as well as at the commit itself is what closes the race the
 * commit alone cannot: a reviewer deciding a change while the next round is
 * landing writes at the span that was current when they started, and only a
 * later pass can see both that write and the round that superseded it. It
 * answers from the record alone when nothing is behind, so the ordinary read
 * costs no reading of plan sources at all.
 */
export const readChangeVerdictState = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  await carryForwardChangeVerdicts({
    store: context.store,
    sessionId: context.sessionId,
    planId: context.planId,
    planPath: context.resolvedPlanPath,
  });
  const verdicts = await context.changeVerdicts.read();
  await reconcileRecordedRejections({ context, verdicts });
  return verdictState(verdicts);
};

const restorePreviousVerdicts = ({
  current,
  previous,
  result,
  mutation,
}: {
  readonly current: StoredChangeVerdicts;
  readonly previous: StoredChangeVerdicts;
  readonly result: StoredChangeVerdicts;
  readonly mutation: ChangeVerdictMutation;
}): StoredChangeVerdicts => {
  // Every lookup is scoped to the mutation's own change set as well as its
  // bounds. Two sets can attribute one place inside a shared revision, and
  // taking a failed write back by bounds alone would revoke the other set's
  // verdict on a gesture its reviewer never made.
  const ownedByMutation = (entry: {
    readonly changeSetId: string;
    readonly from: string;
    readonly to: string;
  }): boolean =>
    entry.changeSetId === mutation.changeSetId &&
    entry.from === mutation.from &&
    entry.to === mutation.to;
  const previousByPlace = new Map(
    previous.decided
      .filter(ownedByMutation)
      .map((entry) => [entry.placeId, entry]),
  );
  const resultByPlace = new Map(
    result.decided
      .filter(ownedByMutation)
      .map((entry) => [entry.placeId, entry]),
  );
  const currentByPlace = new Map(
    current.decided
      .filter(ownedByMutation)
      .map((entry) => [entry.placeId, entry]),
  );
  const same = (
    left: (typeof current.decided)[number] | undefined,
    right: (typeof current.decided)[number] | undefined,
  ): boolean =>
    left?.verdict === right?.verdict &&
    left?.decidedAt === right?.decidedAt &&
    left?.actor === right?.actor;
  const eligible = new Set<string>();
  for (const { placeId } of mutation.places) {
    const expected = resultByPlace.get(placeId);
    if (same(currentByPlace.get(placeId), expected)) eligible.add(placeId);
  }
  if (eligible.size === 0) return current;
  const restored = current.decided.filter(
    (entry) => !ownedByMutation(entry) || !eligible.has(entry.placeId),
  );
  for (const { placeId } of mutation.places) {
    if (!eligible.has(placeId)) continue;
    const prior = previousByPlace.get(placeId);
    if (prior !== undefined) restored.push(prior);
  }
  return restored.length !== current.decided.length ||
    restored.some((entry, index) => entry !== current.decided[index])
    ? { ...current, revision: current.revision + 1, decided: restored }
    : current;
};

/**
 * Refuses a verdict whose places belong to a different change set.
 *
 * The address a verdict is stored under is a claim about ownership, and until
 * this existed nothing proved it: the boundary checked that the change-set id
 * was well formed and that each place id was bounded text, so a caller could
 * record a decision for one thread's change under another thread's set. That
 * is the very leak ownership-scoped acceptance exists to close, and a boundary
 * that only checks shapes closes it for honest callers alone.
 *
 * A place nobody declared has no owner to contradict, so it passes: the
 * partition is deliberately partial, and refusing on an absent fact would
 * block ordinary work to punish a claim nothing disputes. The cost is one diff
 * of the span, which is why it runs only where the span has an ownership
 * partition at all.
 */
const refuseForeignPlaces = async ({
  context,
  mutation,
}: {
  readonly context: ReviewRouteContext;
  readonly mutation: ChangeVerdictMutation;
}): Promise<void> => {
  const { store, resolvedPlanPath } = context;
  const exactTransaction = (await readCommittedChangeSets({ store })).find(
    (changeSet) =>
      changeSet.changeSetId === mutation.changeSetId &&
      changeSet.baseSnapshot === mutation.from &&
      changeSet.resultSnapshot === mutation.to &&
      (changeSet.provenance === "chat" || changeSet.provenance === "push"),
  );
  // A chat or push is an immutable request-keyed transaction, so its exact
  // committed span proves ownership of the revision directly. This also
  // handles a digest reached more than once: the span-only ownership fold can
  // select an earlier path to identical bytes, but that does not erase the
  // later transaction recorded in the immutable log.
  if (exactTransaction !== undefined) return;
  const ownership = await readChangeOwnership({
    store,
    sessionId: context.sessionId,
    planId: context.planId,
    from: mutation.from,
    to: mutation.to,
  });
  if (ownership === undefined) return;
  let before: string;
  let after: string;
  try {
    [before, after] = await Promise.all([
      readSnapshot({ store, snapshot: mutation.from }),
      readSnapshot({ store, snapshot: mutation.to }),
    ]);
  } catch {
    throw new ChangeVerdictsRejected(
      "This change's revision could not be read, so its ownership could not be verified and the decision was not recorded",
    );
  }
  const fallbackTitle = basename(resolvedPlanPath, extname(resolvedPlanPath));
  const blocksOf = (markdown: string) =>
    renderDocument({ markdown, fallbackTitle, identity: {} }).blocks;
  const diff = buildSnapshotDiff({
    from: mutation.from,
    to: mutation.to,
    before: blocksOf(before),
    after: blocksOf(after),
    ownership,
  });
  const placesById = new Map(
    diff.places.map((place) => [place.placeId, place]),
  );
  for (const { placeId } of mutation.places) {
    const owners = placesById.get(placeId)?.ownerChangeSetIds ?? [];
    if (owners.length > 0 && !owners.includes(mutation.changeSetId)) {
      throw new ChangeVerdictsRejected(
        "This change belongs to another change set, so it cannot be decided here",
      );
    }
  }
};

/**
 * Applies one mutation to the verdict record. Registration in the route
 * table gives this the write gate and the session-authority check, so the whole
 * read-modify-write stays atomic against another browser's mutation and only a
 * session that still holds authority reaches it.
 *
 * The record moves first because the plan source is derived from it: a row is
 * the reviewer's decision, and the bytes are only that decision carried out. A
 * byte write that cannot happen therefore takes its row back rather than
 * standing as a decision the plan never followed.
 */
export const recordChangeVerdicts = async (
  context: ReviewRouteContext,
  request: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { changeVerdicts } = context;
  let mutation: ChangeVerdictMutation;
  let verdicts: StoredChangeVerdicts;
  let captured:
    | {
        readonly previous: StoredChangeVerdicts;
        readonly result: StoredChangeVerdicts;
        readonly rejected: ReadonlyArray<string>;
      }
    | undefined;
  try {
    mutation = validateChangeVerdictMutation({
      value: payloadOf(request.body),
      now: new Date().toISOString(),
    });
    // Ownership is proved before the record moves, because a row written under
    // the wrong set is a false statement about who decided what, and taking it
    // back afterwards cannot unsay it to whoever read the record meanwhile.
    await refuseForeignPlaces({ context, mutation });
    verdicts = await changeVerdicts.update((current) => {
      const result = applyChangeVerdictMutation({
        verdicts: current,
        mutation,
      });
      captured = {
        previous: current,
        result,
        rejected: rejectedPlaceIdsFor({
          verdicts: current,
          from: mutation.from,
          to: mutation.to,
        }),
      };
      return result;
    });
  } catch (error: unknown) {
    if (error instanceof ChangeVerdictsRejected) {
      return refusal({ status: 400, reason: error.message });
    }
    throw error;
  }
  if (captured === undefined) {
    throw new Error("The verdict update did not inspect the stored record");
  }
  const { previous, result, rejected: before } = captured;
  const after = rejectedPlaceIdsFor({
    verdicts,
    from: mutation.from,
    to: mutation.to,
  });
  // Only a rejection owns bytes. An accept, and an undo of one, leave the plan
  // exactly as the agent published it, so the common gesture costs no reading,
  // no rendering, and no write to the plan.
  if (
    before.length === after.length &&
    before.every((placeId) => after.includes(placeId))
  ) {
    return verdictState(verdicts);
  }
  try {
    await reconcilePlanSource({
      context,
      changeSetId: mutation.changeSetId,
      from: mutation.from,
      to: mutation.to,
      before,
      after,
    });
  } catch (error: unknown) {
    await changeVerdicts.update((current) =>
      restorePreviousVerdicts({ current, previous, result, mutation }),
    );
    if (error instanceof ChangeRestoreRejected) {
      return refusal({
        status: error.message === PLAN_MOVED_REASON ? 409 : 422,
        reason: error.message,
      });
    }
    if (error instanceof ChangeVerdictsRejected) {
      return refusal({ status: 400, reason: error.message });
    }
    return settlementRefusal(error);
  }
  return verdictState(await changeVerdicts.read());
};
