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
  ChangeRestoreRejected,
  restoreRejectedPlaces,
} from "./change-restore.js";
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

/** Reads the recorded verdicts with the revision that produced them. */
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
  for (const entry of verdicts.decided) {
    if (entry.verdict !== "rejected") continue;
    revisions.set(`${entry.from}:${entry.to}`, {
      from: entry.from,
      to: entry.to,
    });
  }
  for (const { from, to } of revisions.values()) {
    const after = rejectedPlaceIdsFor({ verdicts, from, to });
    const rejected = verdicts.decided.filter(
      (entry) =>
        entry.verdict === "rejected" && entry.from === from && entry.to === to,
    );
    const latestDecision = rejected.reduce(
      (latest, entry) =>
        entry.decidedAt > latest ? entry.decidedAt : latest,
      "",
    );
    const before = rejected
      .filter((entry) => entry.decidedAt !== latestDecision)
      .map((entry) => entry.placeId);
    try {
      await reconcilePlanSource({ context, from, to, before, after });
    } catch (error: unknown) {
      if (
        error instanceof ChangeRestoreRejected &&
        error.message === PLAN_MOVED_REASON
      ) {
        continue;
      }
      throw error;
    }
  }
};

/** Reads the recorded verdicts and repairs an interrupted rejection publish. */
export const readChangeVerdictState = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const verdicts = await context.changeVerdicts.read();
  await reconcileRecordedRejections({ context, verdicts });
  return verdictState(verdicts);
};

const inverseOf = (
  mutation: ChangeVerdictMutation,
  previous: StoredChangeVerdicts,
): ChangeVerdictMutation | undefined => {
  const restored = previous.decided.filter((entry) =>
    mutation.placeIds.some(
      (placeId) =>
        entry.from === mutation.from &&
        entry.to === mutation.to &&
        entry.placeId === placeId,
    ),
  );
  // Compensation only has to answer the shapes a browser can send. A mutation
  // whose places did not all share one previous verdict cannot be undone with
  // a single operation, and is left to the caller to report.
  if (restored.length === 0) {
    return { ...mutation, op: "undo" };
  }
  if (restored.length !== mutation.placeIds.length) return undefined;
  const [first] = restored;
  if (first === undefined) return undefined;
  if (restored.some((entry) => entry.verdict !== first.verdict)) {
    return undefined;
  }
  return {
    ...mutation,
    op: first.verdict === "accepted" ? "accept" : "reject",
    decidedAt: first.decidedAt,
    actor: first.actor ?? "reviewer",
  };
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
  let before: ReadonlyArray<string>;
  let verdicts: StoredChangeVerdicts;
  let previous: StoredChangeVerdicts;
  try {
    mutation = validateChangeVerdictMutation({
      value: payloadOf(request.body),
      now: new Date().toISOString(),
    });
    previous = await changeVerdicts.read();
    before = rejectedPlaceIdsFor({
      verdicts: previous,
      from: mutation.from,
      to: mutation.to,
    });
    verdicts = await changeVerdicts.update((current) =>
      applyChangeVerdictMutation({ verdicts: current, mutation }),
    );
  } catch (error: unknown) {
    if (error instanceof ChangeVerdictsRejected) {
      return refusal({ status: 400, reason: error.message });
    }
    throw error;
  }
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
    const compensation = inverseOf(mutation, previous);
    if (compensation !== undefined) {
      await changeVerdicts.update((current) =>
        applyChangeVerdictMutation({
          verdicts: current,
          mutation: compensation,
        }),
      );
    }
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
