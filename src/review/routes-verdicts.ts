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
import { readCommittedChangeSets } from "./change-set-commit.js";
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
  from,
  to,
  before,
  after,
}: {
  readonly context: ReviewRouteContext;
  readonly from: string;
  readonly to: string;
  readonly before: ReadonlyArray<string>;
  readonly after: ReadonlyArray<string>;
}): Promise<void> => {
  const { store, resolvedPlanPath, readerProgress } = context;
  const fallbackTitle = basename(resolvedPlanPath, extname(resolvedPlanPath));
  const [baselineSource, proposedSource] = await Promise.all([
    readSnapshot({ store, snapshot: from }),
    readSnapshot({ store, snapshot: to }),
  ]);
  const restored = (placeIds: ReadonlyArray<string>): string =>
    restoreRejectedPlaces({
      baselineSource,
      proposedSource,
      from,
      to,
      placeIds,
      fallbackTitle,
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
  const matches: Array<string> = [];
  for (const { from, to } of revisions.values()) {
    const fallbackTitle = basename(resolvedPlanPath, extname(resolvedPlanPath));
    const [baselineSource, proposedSource] = await Promise.all([
      readSnapshot({ store, snapshot: from }),
      readSnapshot({ store, snapshot: to }),
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
    if (matchingNeighbors === 1) matches.push(intendedSource);
  }
  if (matches.length !== 1) return;
  const intendedSource = matches[0];
  if (intendedSource === undefined) return;
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
  readerProgress.accept(nextSnapshot);
};

/** Reads the recorded verdicts and repairs an interrupted rejection publish. */
export const readChangeVerdictState = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
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
  const previousByPlace = new Map(
    previous.decided
      .filter(
        (entry) => entry.from === mutation.from && entry.to === mutation.to,
      )
      .map((entry) => [entry.placeId, entry]),
  );
  const resultByPlace = new Map(
    result.decided
      .filter(
        (entry) => entry.from === mutation.from && entry.to === mutation.to,
      )
      .map((entry) => [entry.placeId, entry]),
  );
  const currentByPlace = new Map(
    current.decided
      .filter(
        (entry) => entry.from === mutation.from && entry.to === mutation.to,
      )
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
  for (const placeId of mutation.placeIds) {
    const expected = resultByPlace.get(placeId);
    if (same(currentByPlace.get(placeId), expected)) eligible.add(placeId);
  }
  if (eligible.size === 0) return current;
  const restored = current.decided.filter(
    (entry) =>
      entry.from !== mutation.from ||
      entry.to !== mutation.to ||
      !eligible.has(entry.placeId),
  );
  for (const placeId of mutation.placeIds) {
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
