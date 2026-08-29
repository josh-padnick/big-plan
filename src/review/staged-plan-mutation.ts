// Owns the claim-scoped private stage that every supported agent edit is made
// in, and the fenced, recoverable publication that is the only way one of
// those edits reaches the authoritative plan source.
//
// The agent never writes the plan file. It writes its own candidate copy for
// one claim generation, and this module is the plan file's only writer. The
// swap happens once, as an atomic rename, and only after the mailbox has
// re-proved ownership and this module has re-proved that the plan has not
// moved since the candidate began. Everything before that rename can be
// abandoned without a trace; everything after it is bookkeeping recovery can
// finish.
//
// The MDX and the request JSON are separate files, so no filesystem call
// changes both at once. A journal written before the rename is what closes
// that gap: it carries the validated response and the digests on both sides of
// the swap, so a crash resolves to exactly one answer rather than to a guess.

import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentExchangeRejected,
  deriveSnapshotDigest,
  validateAgentResponse,
  validateAgentResponseDraft,
} from "./agent-exchange.js";
import type { AgentRequest, AgentResponse } from "./agent-exchange.js";
import {
  commitRequestTerminal,
  completeRequestTerminal,
  RequestLockContended,
} from "./request-mailbox.js";
import {
  publishPreparedPlanAssets,
  replacePlanSource,
  type PreparedPlanAsset,
} from "./plan-assets.js";
import {
  agentMutationJournalPath,
  anchorReviewStore,
  hasPreparedMutationJournal,
  readStoreJson,
  removeAgentMutationStages,
  ReviewStorePathRejected,
  withReviewStoreLock,
  writeSnapshot,
  writeStoreJson,
} from "./store.js";
import type { ReviewStore } from "./store.js";
import { mkdir, writeFile } from "node:fs/promises";
import { SNAPSHOT_DIGEST } from "./shared/change-verdict.js";
import { autoAcceptChangeSets } from "./change-set-closure.js";
import { readActiveArmedReviewMode } from "./review-mode-store.js";

const REQUEST_ID = /^[a-f0-9]{16}$/;
const JOURNAL_FILE = /^[a-f0-9]{16}\.json$/;
const GENERATION_DIRECTORY = /^[0-9]{1,9}$/;
const MANIFEST_VERSION = 1;
const JOURNAL_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export type StagedPlanMutationCode =
  /** The claim that owns this stage was superseded. */
  | "stale-generation"
  /** Something outside this claim changed the plan while the agent worked. */
  | "source-moved"
  /** No stage exists for the claim the agent is answering for. */
  | "missing-stage"
  /** The plan matches neither side of an interrupted commit. */
  | "external-source-conflict"
  /** The stage area itself could not be read or written. */
  | "unavailable";

/**
 * Refuses one staged mutation with the reason an agent or the runtime can act
 * on. It is an `AgentExchangeRejected`, because every caller already turns one
 * of those into a refusal the agent reads rather than a crash.
 */
export class StagedPlanMutationRejected extends AgentExchangeRejected {
  readonly code: StagedPlanMutationCode;

  constructor(code: StagedPlanMutationCode, message: string) {
    super(message);
    this.name = "StagedPlanMutationRejected";
    this.code = code;
  }
}

/** One claim generation's private copy of the plan and its own record of it. */
export type MutationStage = {
  readonly requestId: string;
  readonly generation: number;
  readonly claimedBy: string;
  readonly baseSnapshot: string;
  readonly directory: string;
  readonly candidatePath: string;
  readonly responseDraftPath: string;
};

const checkedRequestId = (requestId: string): string => {
  if (!REQUEST_ID.test(requestId)) {
    throw new StagedPlanMutationRejected(
      "unavailable",
      "A claim stage must name a 16 hexadecimal character request",
    );
  }
  return requestId;
};

const checkedGeneration = (generation: number): number => {
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new StagedPlanMutationRejected(
      "unavailable",
      "A claim stage must name a positive whole generation",
    );
  }
  return generation;
};

const stagePaths = ({
  store,
  requestId,
  generation,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly generation: number;
}): Omit<MutationStage, "baseSnapshot" | "claimedBy"> => {
  const directory = join(
    store.agentMutationDirectory,
    checkedRequestId(requestId),
    String(checkedGeneration(generation)),
  );
  return {
    requestId,
    generation,
    directory,
    candidatePath: join(directory, "candidate.mdx"),
    responseDraftPath: join(directory, "response.json"),
  };
};

const journalPath = ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): string =>
  agentMutationJournalPath({ store, requestId: checkedRequestId(requestId) });

/**
 * Serializes every change to the plan source across this plan. It is taken
 * before the request lock, and that order is used everywhere both are needed,
 * because one fixed order is what prevents a deadlock.
 */
export const withPlanMutationLock = async <TResult>({
  store,
  change,
}: {
  readonly store: ReviewStore;
  readonly change: (store: ReviewStore) => Promise<TResult>;
}): Promise<TResult> => {
  let lockedStore: ReviewStore;
  try {
    lockedStore = await (await anchorReviewStore(store)).resolveStore();
  } catch (error: unknown) {
    if (!(error instanceof ReviewStorePathRejected)) throw error;
    throw new StagedPlanMutationRejected(
      "unavailable",
      "The plan mutation area is unavailable",
    );
  }
  return withReviewStoreLock({
    lockPath: join(lockedStore.reviewDirectory, ".plan-mutation.lock"),
    change: () => change(lockedStore),
    timeoutError: () =>
      new StagedPlanMutationRejected(
        "unavailable",
        "Another process is changing this plan source. Try again.",
      ),
    invalidLockError: () =>
      new StagedPlanMutationRejected(
        "unavailable",
        "The plan mutation area is unavailable",
      ),
  });
};

type StageManifest = {
  readonly version: typeof MANIFEST_VERSION;
  readonly requestId: string;
  readonly generation: number;
  readonly claimedBy: string;
  readonly baseSnapshot: string;
  readonly candidatePath: string;
  readonly responseDraftPath: string;
  readonly openedAt: string;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateManifest = (value: unknown): StageManifest => {
  if (
    !isRecord(value) ||
    value.version !== MANIFEST_VERSION ||
    typeof value.requestId !== "string" ||
    !REQUEST_ID.test(value.requestId) ||
    typeof value.generation !== "number" ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    typeof value.claimedBy !== "string" ||
    !REQUEST_ID.test(value.claimedBy) ||
    typeof value.baseSnapshot !== "string" ||
    !SNAPSHOT_DIGEST.test(value.baseSnapshot) ||
    typeof value.candidatePath !== "string" ||
    typeof value.responseDraftPath !== "string" ||
    typeof value.openedAt !== "string" ||
    Number.isNaN(Date.parse(value.openedAt))
  ) {
    throw new StagedPlanMutationRejected(
      "missing-stage",
      "This claim stage no longer describes a usable candidate",
    );
  }
  return {
    version: MANIFEST_VERSION,
    requestId: value.requestId,
    generation: value.generation,
    claimedBy: value.claimedBy,
    baseSnapshot: value.baseSnapshot,
    candidatePath: value.candidatePath,
    responseDraftPath: value.responseDraftPath,
    openedAt: value.openedAt,
  };
};

const manifestPathOf = (directory: string): string =>
  join(directory, "manifest.json");

/**
 * Gives one claim generation a candidate copied from the committed source.
 *
 * A generation that already has a stage keeps it untouched. That is what makes
 * `agent next --agent <token>` a resume rather than a restart: the same claim
 * comes back to the edits it left behind.
 */
export const openMutationStage = async ({
  store,
  requestId,
  generation,
  claimedBy,
  baseSnapshot,
  baseSource,
  now,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly generation: number;
  readonly claimedBy: string;
  readonly baseSnapshot: string;
  readonly baseSource: string;
  readonly now: string;
}): Promise<MutationStage> => {
  const paths = stagePaths({ store, requestId, generation });
  await mkdir(paths.directory, { recursive: true, mode: DIRECTORY_MODE });
  const stored = await readStoreJson(manifestPathOf(paths.directory));
  if (stored !== undefined) {
    const manifest = validateManifest(stored);
    if (
      manifest.requestId === requestId &&
      manifest.generation === generation &&
      manifest.claimedBy === claimedBy &&
      manifest.baseSnapshot === baseSnapshot
    ) {
      // The candidate is the agent's, so it is replaced only when it is gone.
      await writeFile(paths.candidatePath, baseSource, {
        mode: FILE_MODE,
        flag: "wx",
      }).catch(() => undefined);
      return {
        ...paths,
        claimedBy: manifest.claimedBy,
        baseSnapshot: manifest.baseSnapshot,
      };
    }
  }
  await writeFile(paths.candidatePath, baseSource, { mode: FILE_MODE });
  await writeStoreJson({
    path: manifestPathOf(paths.directory),
    value: {
      version: MANIFEST_VERSION,
      requestId,
      generation,
      claimedBy,
      baseSnapshot,
      candidatePath: paths.candidatePath,
      responseDraftPath: paths.responseDraftPath,
      openedAt: now,
    } satisfies StageManifest,
  });
  return { ...paths, claimedBy, baseSnapshot };
};

/**
 * Finds the stage the answering agent has been editing.
 *
 * The lookup is by holder, not by the request's current generation, and that
 * is the whole point: a displaced agent still owns a real stage, and finding
 * it is what lets the commit refuse a superseded generation by name instead of
 * reporting a missing candidate.
 */
export const readMutationStage = async ({
  store,
  requestId,
  claimedBy,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly claimedBy: string;
}): Promise<MutationStage> => {
  const requestDirectory = join(
    store.agentMutationDirectory,
    checkedRequestId(requestId),
  );
  let names: ReadonlyArray<string>;
  try {
    names = await readdir(requestDirectory);
  } catch {
    throw new StagedPlanMutationRejected(
      "missing-stage",
      "This claim has no plan candidate to publish. Take the work again with `agent next`.",
    );
  }
  const generations = names
    .filter((name) => GENERATION_DIRECTORY.test(name))
    .map(Number)
    .sort((left, right) => right - left);
  for (const generation of generations) {
    const paths = stagePaths({ store, requestId, generation });
    const stored = await readStoreJson(manifestPathOf(paths.directory));
    if (stored === undefined) continue;
    const manifest = validateManifest(stored);
    if (
      manifest.requestId !== requestId ||
      manifest.generation !== generation ||
      manifest.claimedBy !== claimedBy
    ) {
      continue;
    }
    return {
      ...paths,
      claimedBy: manifest.claimedBy,
      baseSnapshot: manifest.baseSnapshot,
    };
  }
  throw new StagedPlanMutationRejected(
    "missing-stage",
    "This claim has no plan candidate to publish. Take the work again with `agent next`.",
  );
};

type MutationJournal = {
  readonly version: typeof JOURNAL_VERSION;
  readonly requestId: string;
  readonly generation: number;
  readonly claimedBy: string;
  readonly baseSnapshot: string;
  readonly resultSnapshot: string;
  readonly answeredAt: string;
  readonly response: AgentResponse;
};

const validateJournal = (value: unknown): MutationJournal => {
  if (
    !isRecord(value) ||
    value.version !== JOURNAL_VERSION ||
    typeof value.requestId !== "string" ||
    !REQUEST_ID.test(value.requestId) ||
    typeof value.generation !== "number" ||
    !Number.isSafeInteger(value.generation) ||
    typeof value.claimedBy !== "string" ||
    !REQUEST_ID.test(value.claimedBy) ||
    typeof value.baseSnapshot !== "string" ||
    !SNAPSHOT_DIGEST.test(value.baseSnapshot) ||
    typeof value.resultSnapshot !== "string" ||
    !SNAPSHOT_DIGEST.test(value.resultSnapshot) ||
    typeof value.answeredAt !== "string" ||
    Number.isNaN(Date.parse(value.answeredAt))
  ) {
    throw new Error("A prepared plan mutation journal is not a usable record");
  }
  let response: AgentResponse;
  try {
    // Recovery publishes this response with no agent present, so it is
    // re-checked on the way out of the file as strictly as on the way in.
    response = validateAgentResponse(value.response);
  } catch {
    throw new Error(
      "A prepared plan mutation journal carries no usable answer",
    );
  }
  return {
    version: JOURNAL_VERSION,
    requestId: value.requestId,
    generation: value.generation,
    claimedBy: value.claimedBy,
    baseSnapshot: value.baseSnapshot,
    resultSnapshot: value.resultSnapshot,
    answeredAt: value.answeredAt,
    response,
  };
};

/** What an interrupted commit turned out to be. */
export type MutationRecovery =
  | { readonly outcome: "rolled-back"; readonly requestId: string }
  | { readonly outcome: "completed"; readonly requestId: string }
  | {
      readonly outcome: "conflict";
      readonly requestId: string;
      readonly baseSnapshot: string;
      readonly resultSnapshot: string;
      readonly currentSnapshot: string;
    };

type JournalScan = {
  readonly journals: ReadonlyArray<MutationJournal>;
  readonly unreadable: ReadonlyArray<string>;
};

/** Closes an arriving push only for the runtime session that armed the mode. */
const autoAcceptPushIfArmed = async ({
  store,
  planPath,
  response,
  baseSnapshot,
  resultSnapshot,
  acceptedAt,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly response: AgentResponse;
  readonly baseSnapshot: string;
  readonly resultSnapshot: string;
  readonly acceptedAt: string;
}): Promise<void> => {
  if (response.kind !== "push") return;
  const armed = await readActiveArmedReviewMode({ store });
  if (armed?.sessionId !== response.sessionId) return;
  await autoAcceptChangeSets({
    store,
    planPath,
    transactions: [{ from: baseSnapshot, to: resultSnapshot }],
    acceptedAt,
  });
};

/** True only for the one filesystem failure that proves a path is absent. */
const isMissingPath = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/**
 * Reads every prepared journal, keeping the ones it can settle apart from the
 * ones it cannot.
 *
 * A damaged file is collected rather than thrown on, because a commit whose
 * outcome this build cannot determine must be reported - but only after the
 * intact journals have been settled, so one damaged file cannot strand a
 * commit whose rename already won.
 */
const readJournals = async (store: ReviewStore): Promise<JournalScan> => {
  let names: ReadonlyArray<string>;
  try {
    names = await readdir(store.agentMutationJournalDirectory);
  } catch (error: unknown) {
    // Only a missing directory proves there is no journal. Any other failure
    // leaves the outcome of an interrupted commit unknown, and answering
    // "none" would let the runtime serve work over a revision that may already
    // be published.
    if (!isMissingPath(error)) {
      throw new StagedPlanMutationRejected(
        "unavailable",
        "The interrupted-commit journals could not be read, so an interrupted plan commit cannot be settled",
      );
    }
    return { journals: [], unreadable: [] };
  }
  const journals: Array<MutationJournal> = [];
  const unreadable: Array<string> = [];
  for (const name of names.filter((entry) => JOURNAL_FILE.test(entry)).sort()) {
    const path = join(store.agentMutationJournalDirectory, name);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, "utf8"));
    } catch (error: unknown) {
      // A journal that vanished between the listing and the read has nothing
      // left to settle; anything else is a commit of unknown outcome.
      if (!isMissingPath(error)) {
        unreadable.push(path);
      }
      continue;
    }
    try {
      journals.push(validateJournal(value));
    } catch {
      unreadable.push(path);
    }
  }
  return { journals, unreadable };
};

/**
 * The reviewer-facing reason a revert is refused. The route pre-checks the same
 * condition outside the lock to avoid a wasted render, so both places say this
 * one sentence rather than two that can drift apart.
 */
export const REVERT_SOURCE_MOVED_REASON =
  "The plan changed after this response, so reverting it would overwrite newer work";

/**
 * Whether settling failed for a reason another attempt clears. A contended
 * lock, or a resource momentarily unavailable, wrote nothing and needs no
 * remedy beyond running the command again - and it must never be answered with
 * the delete instruction, because deleting a journal whose rename already won
 * is what would leave the plan and its records disagreeing for good.
 */
const settlementIsRetryable = (error: unknown): boolean =>
  error instanceof RequestLockContended ||
  (error instanceof Error &&
    "code" in error &&
    (error.code === "EAGAIN" || error.code === "EBUSY"));

const unsettleableJournal = ({
  path,
  requestId,
  error,
}: {
  readonly path: string;
  readonly requestId: string;
  readonly error: unknown;
}): StagedPlanMutationRejected => {
  const reason = error instanceof Error ? error.message : String(error);
  return new StagedPlanMutationRejected(
    "unavailable",
    settlementIsRetryable(error)
      ? `The interrupted commit for request ${requestId} published its revision but its records could not be finished yet: ${reason}. Nothing was lost; run the command again.`
      : `The interrupted commit for request ${requestId} published its revision but its records could not be finished: ${reason}. Try again first, and only if it keeps failing delete ${path} to abandon the interrupted commit, then start \`big-plan review\` again.`,
  );
};

const unreadableJournals = (
  paths: ReadonlyArray<string>,
): StagedPlanMutationRejected =>
  new StagedPlanMutationRejected(
    "unavailable",
    `Prepared plan mutation journals are unreadable: ${paths.join(", ")}. Each was written by a build this one no longer understands, or has been damaged, so the interrupted commit it describes cannot be settled. Every readable journal was settled first, and anything still unsettled stays blocked until these files are gone. Delete them to abandon those interrupted commits, then start \`big-plan review\` again.`,
  );

const externalSourceConflict = (
  recovery: Extract<MutationRecovery, { outcome: "conflict" }>,
): StagedPlanMutationRejected =>
  new StagedPlanMutationRejected(
    "external-source-conflict",
    `The plan source matches neither side of an interrupted commit for request ${recovery.requestId}: it is ${recovery.currentSnapshot}, not ${recovery.baseSnapshot} or ${recovery.resultSnapshot}. A writer outside Big Plan changed it, so agent edits are stopped. Restore the plan to one of those revisions, or delete that request's file under the review store's mutation-journal directory to abandon the interrupted commit.`,
  );

/**
 * Settles every interrupted commit before the runtime accepts more work.
 *
 * The plan file is the linearization point, so its digest answers what
 * happened. It matches the base, and the rename never ran. It matches the
 * result, and the rename won, so the rest of the terminal records are finished
 * from the journal. It matches neither, and something outside Big Plan wrote
 * the file, which is reported rather than overwritten.
 *
 * The result is checked first, because a response that changed nothing has the
 * same digest on both sides and is complete either way.
 */
export const recoverStagedPlanMutations = async ({
  store,
  planPath,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
}): Promise<ReadonlyArray<MutationRecovery>> =>
  withPlanMutationLock({
    store,
    change: async (lockedStore) => {
      const { journals, unreadable } = await readJournals(lockedStore);
      const recoveries: Array<MutationRecovery> = [];
      for (const journal of journals) {
        const source = await readFile(planPath, "utf8");
        const currentSnapshot = deriveSnapshotDigest(source);
        if (currentSnapshot === journal.resultSnapshot) {
          try {
            // The closure diff reads immutable endpoints. A crash may have
            // happened immediately after the source rename, before ordinary
            // finalization retained the result snapshot, so recovery restores
            // that endpoint before replaying the pre-answer closure.
            await writeSnapshot({
              store: lockedStore,
              snapshot: journal.resultSnapshot,
              source,
            });
            await autoAcceptPushIfArmed({
              store: lockedStore,
              planPath,
              response: journal.response,
              baseSnapshot: journal.baseSnapshot,
              resultSnapshot: journal.resultSnapshot,
              acceptedAt: journal.answeredAt,
            });
            await completeRequestTerminal({
              store: lockedStore,
              response: journal.response,
              claim: {
                baselineSnapshot: journal.baseSnapshot,
                claimedBy: journal.claimedBy,
                claimGeneration: journal.generation,
              },
              now: journal.answeredAt,
            });
            await finalizeCommittedMutation({
              store: lockedStore,
              journal,
              resultSource: source,
            });
          } catch (error: unknown) {
            // The rename already published this revision, so there is no
            // rolling back and no guessing left to do. Naming the journal and
            // the remedy is what keeps one unsettleable record from making the
            // plan permanently unservable - and finishing the records is as
            // able to fail as stamping the answer was.
            throw unsettleableJournal({
              path: journalPath({
                store: lockedStore,
                requestId: journal.requestId,
              }),
              requestId: journal.requestId,
              error,
            });
          }
          recoveries.push({
            outcome: "completed",
            requestId: journal.requestId,
          });
          continue;
        }
        if (currentSnapshot === journal.baseSnapshot) {
          await rm(
            journalPath({ store: lockedStore, requestId: journal.requestId }),
            {
              force: true,
            },
          );
          recoveries.push({
            outcome: "rolled-back",
            requestId: journal.requestId,
          });
          continue;
        }
        recoveries.push({
          outcome: "conflict",
          requestId: journal.requestId,
          baseSnapshot: journal.baseSnapshot,
          resultSnapshot: journal.resultSnapshot,
          currentSnapshot,
        });
      }
      if (unreadable.length > 0) throw unreadableJournals(unreadable);
      return recoveries;
    },
  });

/** Stops agent writes when recovery found an unexplained plan source. */
export const assertNoExternalSourceConflict = (
  recoveries: ReadonlyArray<MutationRecovery>,
): void => {
  const conflict = recoveries.find(
    (recovery) => recovery.outcome === "conflict",
  );
  if (conflict !== undefined) throw externalSourceConflict(conflict);
};

/**
 * Settles an interrupted commit before a reviewer control decides what a
 * request's journal means.
 *
 * A journal on disk makes the mailbox refuse an edit, a delete, or a cancel,
 * because an answer that got that far has published or is one rename from it.
 * That refusal is only honest once recovery has had its say: a journal an
 * abandoned commit left behind is rolled back here, and refusing on it instead
 * would lock the message for good in the one case abandonment is most certain
 * (BIG-120).
 *
 * Nothing is settled unless one of the named requests actually has a journal.
 * Recovery takes the plan-mutation lock and resolves the whole store, so a
 * control with nothing to settle would otherwise start refusing on conditions
 * that have no bearing on the request it is about to change.
 *
 * Answers whether recovery ran, because settling stamps a request terminal:
 * a caller that read those requests before this decided anything is holding a
 * state that is now stale.
 */
export const settleInterruptedCommitsFor = async ({
  store,
  planPath,
  requestIds,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly requestIds: ReadonlyArray<string>;
}): Promise<boolean> => {
  for (const requestId of requestIds) {
    // An id no request could carry names no journal, and this runs before the
    // route has resolved the id it was handed, so it answers rather than
    // throwing over what is really a "no such request".
    if (!REQUEST_ID.test(requestId)) continue;
    let prepared: boolean;
    try {
      prepared = await hasPreparedMutationJournal({ store, requestId });
    } catch {
      throw new StagedPlanMutationRejected(
        "unavailable",
        "The interrupted-commit journals could not be read, so an interrupted plan commit cannot be settled",
      );
    }
    if (!prepared) continue;
    await recoverStagedPlanMutations({ store, planPath });
    return true;
  }
  return false;
};

/**
 * Puts the plan back to a revision the reviewer chose, under the same lock and
 * the same compare-and-swap an agent commit takes.
 *
 * The reviewer's revert is decided outside the lock - the response is found,
 * its baseline is resolved, and that baseline is rendered - so by the time the
 * bytes are ready an agent commit may already have published a newer revision
 * from the very digest this revert was computed against. Re-proving the digest
 * under the lock is what turns that into a refusal the reviewer reads instead
 * of a published revision that silently disappears.
 */
export const revertPlanSource = async ({
  store,
  planPath,
  expectedSnapshot,
  source,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly expectedSnapshot: string;
  readonly source: string;
}): Promise<void> =>
  withPlanMutationLock({
    store,
    change: async () => {
      const currentSnapshot = deriveSnapshotDigest(
        await readFile(planPath, "utf8"),
      );
      if (currentSnapshot !== expectedSnapshot) {
        throw new StagedPlanMutationRejected(
          "source-moved",
          REVERT_SOURCE_MOVED_REASON,
        );
      }
      await replacePlanSource({ path: planPath, source });
    },
  });

/** Retains the published revision and clears the attempt that produced it. */
const finalizeCommittedMutation = async ({
  store,
  journal,
  resultSource,
}: {
  readonly store: ReviewStore;
  readonly journal: MutationJournal;
  readonly resultSource: string;
}): Promise<void> => {
  await writeSnapshot({
    store,
    snapshot: journal.resultSnapshot,
    source: resultSource,
  });
  await rm(journalPath({ store, requestId: journal.requestId }), {
    force: true,
  });
  // A superseded generation survives every earlier step on purpose: a
  // displaced agent still owns a real stage, which is what lets its answer be
  // refused by generation rather than reported as a missing candidate. Once
  // this request's answer is public, none of them may be read again.
  await removeAgentMutationStages({ store, requestId: journal.requestId });
};

/**
 * Publishes one prepared candidate as the plan's next revision.
 *
 * Everything expensive - reading, rendering, linting, preparing assets - is
 * already done by the time this runs, because a check made outside the lock can
 * go stale before the swap. Inside it the order is fixed: prove the claim
 * through the mailbox, prove the plan has not moved, publish the assets a
 * published plan must not be missing, write the journal, and only then swap.
 */
export const commitStagedPlanMutation = async ({
  store,
  planPath,
  request,
  generation,
  claimedBy,
  baseSnapshot,
  resultSnapshot,
  resultSource,
  assets,
  response,
  now,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly request: AgentRequest;
  readonly generation: number;
  readonly claimedBy: string;
  readonly baseSnapshot: string;
  readonly resultSnapshot: string;
  readonly resultSource: string;
  readonly assets: ReadonlyArray<PreparedPlanAsset>;
  readonly response: AgentResponse;
  readonly now: string;
}): Promise<AgentRequest> =>
  withPlanMutationLock({
    store,
    change: async (lockedStore) => {
      const publishes = response.kind !== "approval";
      let approvalSource: string | undefined;
      let committedResponse = response;
      if (response.kind === "approval") {
        approvalSource = await readFile(planPath, "utf8");
        committedResponse = validateAgentResponseDraft({
          value: response,
          request,
          commentsById: new Map(),
          changedBlocks: new Set(),
          currentSnapshot: deriveSnapshotDigest(approvalSource),
          now: response.createdAt,
        });
      }
      /*
      What the journal names has to be true of the file, because recovery reads
      it as the two revisions an interrupted commit could be caught between. An
      answer that publishes nothing is caught between nothing: it is settled
      wherever the plan already stands, so both sides are the revision on disk.
      Naming the candidate instead would leave a crash-window journal matching
      neither side, and the next agent command would report the reviewer's own
      edit as an outside writer and offer to throw it away (BIG-131).
      */
      let journal: MutationJournal = {
        version: JOURNAL_VERSION,
        requestId: request.requestId,
        generation,
        claimedBy,
        baseSnapshot,
        resultSnapshot,
        answeredAt: now,
        response: committedResponse,
      };
      let settledSource = resultSource;
      const answered = await commitRequestTerminal({
        store: lockedStore,
        response: committedResponse,
        claimedBy,
        now,
        publish: async () => {
          const source = approvalSource ?? (await readFile(planPath, "utf8"));
          const currentSnapshot = deriveSnapshotDigest(source);
          if (!publishes) {
            journal = {
              ...journal,
              baseSnapshot: currentSnapshot,
              resultSnapshot: currentSnapshot,
            };
            settledSource = source;
          }
          /*
          The check asks whether this candidate may still be published over the
          source, so it has nothing to ask of an answer that publishes nothing.
          An approval held to it was refused outright whenever the reviewer
          edited the plan between the pickup and the answer: the acknowledgment
          could not land, and neither could the hard stop reporting that very
          edit - the mailbox kept the request open with the claim's baseline
          frozen, so every retry failed the same way and the reviewer waited on
          an answer the agent had already tried twice to give (BIG-131).
          */
          if (currentSnapshot !== baseSnapshot && publishes) {
            throw new StagedPlanMutationRejected(
              "source-moved",
              "The plan source changed while this claim was working, so its candidate can no longer be published. Take the work again from the current plan.",
            );
          }
          if (publishes) await publishPreparedPlanAssets(assets);
          await writeStoreJson({
            path: journalPath({
              store: lockedStore,
              requestId: request.requestId,
            }),
            value: journal,
          });
          /*
          An approval answer publishes nothing, whatever its candidate holds.
          Acknowledging is a statement about the revision the reviewer pinned,
          not an edit of it, and a hard stop is a refusal to start - so neither
          may reach the source. Left to the digest alone, an agent that wrote to
          its candidate would swap the plan through a kind that records no
          revision and no change set, and the bytes would land with nothing
          naming them (BIG-131).
          */
          if (resultSnapshot !== baseSnapshot && publishes) {
            await replacePlanSource({ path: planPath, source: resultSource });
          }
          // Auto-accept builds the same diff the reader counts, so its result
          // endpoint must exist before the request receives answeredAt.
          await writeSnapshot({
            store: lockedStore,
            snapshot: resultSnapshot,
            source: resultSource,
          });
          await autoAcceptPushIfArmed({
            store: lockedStore,
            planPath,
            response: committedResponse,
            baseSnapshot,
            resultSnapshot,
            acceptedAt: now,
          });
        },
      });
      await finalizeCommittedMutation({
        store: lockedStore,
        journal,
        resultSource: settledSource,
      });
      return answered;
    },
  });
