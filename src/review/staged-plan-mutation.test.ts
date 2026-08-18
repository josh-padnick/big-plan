// Proves the one boundary that reaches the plan file: a candidate publishes
// only under a live claim generation from an unmoved base, and an interrupted
// commit has exactly one answer on each side of its rename.

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveSnapshotDigest,
  messageAgentRequest,
  readAgentExchange,
  requestClaimGeneration,
  validateAgentRequest,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "./agent-exchange.js";
import { readCommittedRevisions } from "./change-set-commit.js";
import { cancelAgentRequest, claimAgentRequest } from "./request-mailbox.js";
import {
  assertNoExternalSourceConflict,
  commitStagedPlanMutation,
  openMutationStage,
  readMutationStage,
  recoverStagedPlanMutations,
  revertPlanSource,
  StagedPlanMutationRejected,
  withPlanMutationLock,
} from "./staged-plan-mutation.js";
import {
  deriveReviewPlanId,
  prepareStore,
  reviewStoreFor,
  writeAgentRequestValue,
  writeSnapshot,
  writeStoreJson,
} from "./store.js";
import type { ReviewStore } from "./store.js";

const SESSION = "1111111111111111";
const AGENT_A = "aaaa1111aaaa1111";
const AGENT_B = "bbbb2222bbbb2222";
const REQUEST = "cccc3333cccc3333";
const BASE = "# Plan\n\nThe committed revision.\n";
const RESULT = "# Plan\n\nThe published revision.\n";

const preparedPlan = async (): Promise<{
  readonly directory: string;
  readonly planPath: string;
  readonly store: ReviewStore;
  readonly planId: string;
}> => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-staged-mutation-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, BASE, "utf8");
  const planId = deriveReviewPlanId({ planPath });
  const store = reviewStoreFor({ planPath, planId });
  await prepareStore(store);
  await writeSnapshot({
    store,
    snapshot: deriveSnapshotDigest(BASE),
    source: BASE,
  });
  return { directory, planPath, store, planId };
};

const chatRequest = (planId: string) =>
  messageAgentRequest({
    kind: "chat",
    requestId: REQUEST,
    sessionId: SESSION,
    planId,
    premiseSnapshot: deriveSnapshotDigest(BASE),
    createdAt: "2026-08-17T12:00:00.000Z",
    body: "Publish the revision.",
  });

const claim = async ({
  store,
  claimedBy,
}: {
  readonly store: ReviewStore;
  readonly claimedBy: string;
}) =>
  claimAgentRequest({
    store,
    activeSessionId: SESSION,
    requestId: REQUEST,
    claimedBy,
    baselineSnapshot: deriveSnapshotDigest(BASE),
    now: new Date().toISOString(),
    clock: () => Date.now(),
  });

const stageFor = async ({
  store,
  claimedBy,
  generation,
}: {
  readonly store: ReviewStore;
  readonly claimedBy: string;
  readonly generation: number;
}) =>
  openMutationStage({
    store,
    requestId: REQUEST,
    generation,
    claimedBy,
    baseSnapshot: deriveSnapshotDigest(BASE),
    baseSource: BASE,
    now: new Date().toISOString(),
  });

const answerFor = ({
  request,
  currentSnapshot,
}: {
  readonly request: Parameters<typeof validateAgentResponseDraft>[0]["request"];
  readonly currentSnapshot: string;
}) =>
  validateAgentResponseDraft({
    value: { requestId: REQUEST, message: "The revision is published." },
    request,
    commentsById: new Map(),
    changedBlocks: new Set<string>(),
    currentSnapshot,
    now: new Date().toISOString(),
  });

describe("staged plan mutation", () => {
  it("should keep a displaced claim's candidate out of the plan", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const first = await claim({ store, claimedBy: AGENT_A });
      const firstStage = await stageFor({
        store,
        claimedBy: AGENT_A,
        generation: requestClaimGeneration(first),
      });
      await writeFile(firstStage.candidatePath, RESULT, "utf8");

      // The lease lapses and a second agent takes the work over.
      const second = await claimAgentRequest({
        store,
        activeSessionId: SESSION,
        requestId: REQUEST,
        claimedBy: AGENT_B,
        baselineSnapshot: deriveSnapshotDigest(BASE),
        now: new Date().toISOString(),
        clock: () => Date.now() + 10 * 60 * 1_000,
      });
      expect(requestClaimGeneration(second)).toBe(
        requestClaimGeneration(first) + 1,
      );
      const secondStage = await stageFor({
        store,
        claimedBy: AGENT_B,
        generation: requestClaimGeneration(second),
      });
      // The takeover starts from the last committed revision, never from the
      // displaced agent's half-written copy.
      await expect(readFile(secondStage.candidatePath, "utf8")).resolves.toBe(
        BASE,
      );

      // The displaced agent still owns a real stage, and that is what lets its
      // answer be refused by generation rather than by a missing candidate.
      await expect(
        readMutationStage({ store, requestId: REQUEST, claimedBy: AGENT_A }),
      ).resolves.toMatchObject({
        generation: requestClaimGeneration(first),
      });
      await expect(
        commitStagedPlanMutation({
          store,
          planPath,
          request: first,
          generation: firstStage.generation,
          claimedBy: AGENT_A,
          baseSnapshot: firstStage.baseSnapshot,
          resultSnapshot: deriveSnapshotDigest(RESULT),
          resultSource: RESULT,
          assets: [],
          response: answerFor({
            request: first,
            currentSnapshot: deriveSnapshotDigest(RESULT),
          }),
          now: new Date().toISOString(),
        }),
      ).rejects.toThrow(/can no longer publish/u);
      await expect(readFile(planPath, "utf8")).resolves.toBe(BASE);
      await expect(
        readAgentExchange({ store, sessionId: SESSION, planId }),
      ).resolves.toMatchObject({ responses: [] });
      await expect(readCommittedRevisions({ store })).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should refuse a candidate whose base revision moved", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const claimed = await claim({ store, claimedBy: AGENT_A });
      const stage = await stageFor({
        store,
        claimedBy: AGENT_A,
        generation: requestClaimGeneration(claimed),
      });
      // Something outside this claim rewrote the plan while the agent worked.
      const moved = "# Plan\n\nSomeone else got here first.\n";
      await writeFile(planPath, moved, "utf8");
      await expect(
        commitStagedPlanMutation({
          store,
          planPath,
          request: claimed,
          generation: stage.generation,
          claimedBy: AGENT_A,
          baseSnapshot: stage.baseSnapshot,
          resultSnapshot: deriveSnapshotDigest(RESULT),
          resultSource: RESULT,
          assets: [],
          response: answerFor({
            request: claimed,
            currentSnapshot: deriveSnapshotDigest(RESULT),
          }),
          now: new Date().toISOString(),
        }),
      ).rejects.toThrow(/changed while this claim was working/u);
      await expect(readFile(planPath, "utf8")).resolves.toBe(moved);
      await expect(
        readAgentExchange({ store, sessionId: SESSION, planId }),
      ).resolves.toMatchObject({ responses: [] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should publish a live claim's candidate as one recoverable result", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const claimed = await claim({ store, claimedBy: AGENT_A });
      const stage = await stageFor({
        store,
        claimedBy: AGENT_A,
        generation: requestClaimGeneration(claimed),
      });
      await writeFile(stage.candidatePath, RESULT, "utf8");
      const resultSnapshot = deriveSnapshotDigest(RESULT);
      await commitStagedPlanMutation({
        store,
        planPath,
        request: claimed,
        generation: stage.generation,
        claimedBy: AGENT_A,
        baseSnapshot: stage.baseSnapshot,
        resultSnapshot,
        resultSource: RESULT,
        assets: [],
        response: answerFor({
          request: claimed,
          currentSnapshot: resultSnapshot,
        }),
        now: new Date().toISOString(),
      });
      await expect(readFile(planPath, "utf8")).resolves.toBe(RESULT);
      const exchange = await readAgentExchange({
        store,
        sessionId: SESSION,
        planId,
      });
      expect(exchange.requests[0]?.answeredAt).toBeDefined();
      expect(exchange.responses[0]?.resultSnapshot).toBe(resultSnapshot);
      await expect(readCommittedRevisions({ store })).resolves.toMatchObject([
        {
          requestId: REQUEST,
          baseSnapshot: deriveSnapshotDigest(BASE),
          resultSnapshot,
          provenance: "chat",
        },
      ]);
      // The attempt is gone once its answer is public.
      await expect(
        readMutationStage({ store, requestId: REQUEST, claimedBy: AGENT_A }),
      ).rejects.toThrow(StagedPlanMutationRejected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should take every stage with a request the reviewer withdrew", async () => {
    const { directory, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const claimed = await claim({ store, claimedBy: AGENT_A });
      const stage = await stageFor({
        store,
        claimedBy: AGENT_A,
        generation: requestClaimGeneration(claimed),
      });
      await writeFile(stage.candidatePath, RESULT, "utf8");

      await cancelAgentRequest({
        store,
        requestId: REQUEST,
        now: new Date().toISOString(),
      });

      // A withdrawn request can never publish, so its private plan copies must
      // not outlive it in the store.
      await expect(
        readMutationStage({ store, requestId: REQUEST, claimedBy: AGENT_A }),
      ).rejects.toThrow(StagedPlanMutationRejected);
      await expect(readdir(store.agentMutationDirectory)).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/**
 * The reviewer's revert is the plan file's other writer. It decides what to
 * write outside the plan-mutation lock - find the response, resolve its
 * baseline, render it - so an agent commit can publish from the very digest
 * the revert was computed against while that work is in flight.
 */
describe("reviewer revert of a published revision", () => {
  const publishRevision = async ({
    store,
    planPath,
    planId,
  }: {
    readonly store: ReviewStore;
    readonly planPath: string;
    readonly planId: string;
  }): Promise<string> => {
    await writeAgentRequest({ store, request: chatRequest(planId) });
    const claimed = await claim({ store, claimedBy: AGENT_A });
    const stage = await stageFor({
      store,
      claimedBy: AGENT_A,
      generation: requestClaimGeneration(claimed),
    });
    await writeFile(stage.candidatePath, RESULT, "utf8");
    const resultSnapshot = deriveSnapshotDigest(RESULT);
    await commitStagedPlanMutation({
      store,
      planPath,
      request: claimed,
      generation: stage.generation,
      claimedBy: AGENT_A,
      baseSnapshot: stage.baseSnapshot,
      resultSnapshot,
      resultSource: RESULT,
      assets: [],
      response: answerFor({
        request: claimed,
        currentSnapshot: resultSnapshot,
      }),
      now: new Date().toISOString(),
    });
    return resultSnapshot;
  };

  it("should put the plan back when nothing moved underneath it", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      const resultSnapshot = await publishRevision({ store, planPath, planId });

      await revertPlanSource({
        store,
        planPath,
        expectedSnapshot: resultSnapshot,
        source: BASE,
      });

      await expect(readFile(planPath, "utf8")).resolves.toBe(BASE);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should refuse a revert an agent commit published past", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      // The reviewer opened the revert against the plan as it stood, which is
      // the baseline the agent is about to publish from.
      const expectedSnapshot = deriveSnapshotDigest(BASE);
      const resultSnapshot = await publishRevision({ store, planPath, planId });
      expect(resultSnapshot).not.toBe(expectedSnapshot);

      await expect(
        revertPlanSource({
          store,
          planPath,
          expectedSnapshot,
          source: BASE,
        }),
      ).rejects.toThrow(/would overwrite newer work/u);
      // The published revision is still the plan, and the log still describes
      // it, so nothing the agent committed disappeared under the revert.
      await expect(readFile(planPath, "utf8")).resolves.toBe(RESULT);
      await expect(readCommittedRevisions({ store })).resolves.toMatchObject([
        { requestId: REQUEST, resultSnapshot },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should wait for the plan-mutation lock before it writes", async () => {
    const { directory, planPath, store } = await preparedPlan();
    let revert: Promise<unknown> = Promise.resolve();
    try {
      let settled = false;
      await withPlanMutationLock({
        store,
        change: async () => {
          revert = revertPlanSource({
            store,
            planPath,
            expectedSnapshot: deriveSnapshotDigest(BASE),
            source: RESULT,
          }).finally(() => {
            settled = true;
          });
          revert.catch(() => undefined);
          // A revert that did not take this lock would already have renamed
          // its bytes over whatever the holder is midway through publishing.
          await new Promise((resume) => setTimeout(resume, 50));
          expect(settled).toBe(false);
          await expect(readFile(planPath, "utf8")).resolves.toBe(BASE);
        },
      });

      await expect(revert).resolves.toBeUndefined();
      await expect(readFile(planPath, "utf8")).resolves.toBe(RESULT);
    } finally {
      await revert.catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

const prepareJournal = async ({
  store,
  request,
  resultSnapshot,
}: {
  readonly store: ReviewStore;
  readonly request: Parameters<typeof validateAgentResponseDraft>[0]["request"];
  readonly resultSnapshot: string;
}): Promise<void> => {
  await writeStoreJson({
    path: join(store.agentMutationJournalDirectory, `${REQUEST}.json`),
    value: {
      version: 1,
      requestId: REQUEST,
      generation: requestClaimGeneration(request),
      claimedBy: AGENT_A,
      baseSnapshot: deriveSnapshotDigest(BASE),
      resultSnapshot,
      answeredAt: "2026-08-17T12:00:05.000Z",
      response: answerFor({ request, currentSnapshot: resultSnapshot }),
    },
  });
};

describe("interrupted plan commit recovery", () => {
  it("should leave the request open when the rename never ran", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const claimed = await claim({ store, claimedBy: AGENT_A });
      await prepareJournal({
        store,
        request: claimed,
        resultSnapshot: deriveSnapshotDigest(RESULT),
      });

      await expect(
        recoverStagedPlanMutations({ store, planPath }),
      ).resolves.toMatchObject([
        { outcome: "rolled-back", requestId: REQUEST },
      ]);
      await expect(readFile(planPath, "utf8")).resolves.toBe(BASE);
      const exchange = await readAgentExchange({
        store,
        sessionId: SESSION,
        planId,
      });
      expect(exchange.requests[0]?.answeredAt).toBeUndefined();
      expect(exchange.responses).toEqual([]);
      // The journal is settled, so a second pass finds nothing left to do.
      await expect(
        recoverStagedPlanMutations({ store, planPath }),
      ).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should finish the same answer when the rename won", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const claimed = await claim({ store, claimedBy: AGENT_A });
      const resultSnapshot = deriveSnapshotDigest(RESULT);
      await prepareJournal({ store, request: claimed, resultSnapshot });
      // The crash landed after the swap, so the plan already carries the
      // result and only the bookkeeping is missing.
      await writeFile(planPath, RESULT, "utf8");

      await expect(
        recoverStagedPlanMutations({ store, planPath }),
      ).resolves.toMatchObject([{ outcome: "completed", requestId: REQUEST }]);
      const exchange = await readAgentExchange({
        store,
        sessionId: SESSION,
        planId,
      });
      expect(exchange.requests[0]?.answeredAt).toBe("2026-08-17T12:00:05.000Z");
      expect(exchange.responses[0]?.resultSnapshot).toBe(resultSnapshot);
      await expect(readCommittedRevisions({ store })).resolves.toMatchObject([
        { requestId: REQUEST, resultSnapshot },
      ]);
      // Running recovery again must describe the same one result.
      await expect(
        recoverStagedPlanMutations({ store, planPath }),
      ).resolves.toEqual([]);
      expect(
        (await readAgentExchange({ store, sessionId: SESSION, planId }))
          .responses,
      ).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should name the journal and its remedy when one is unreadable", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const claimed = await claim({ store, claimedBy: AGENT_A });
      await prepareJournal({
        store,
        request: claimed,
        resultSnapshot: deriveSnapshotDigest(RESULT),
      });
      // A journal left by an older build: valid JSON, but a response shape
      // this one no longer accepts.
      const path = join(store.agentMutationJournalDirectory, `${REQUEST}.json`);
      await writeStoreJson({
        path,
        value: {
          version: 1,
          requestId: REQUEST,
          generation: requestClaimGeneration(claimed),
          claimedBy: AGENT_A,
          baseSnapshot: deriveSnapshotDigest(BASE),
          resultSnapshot: deriveSnapshotDigest(RESULT),
          answeredAt: "2026-08-17T12:00:05.000Z",
          response: { requestId: REQUEST, kind: "chat" },
        },
      });

      // Refusing is right - the interrupted commit really cannot be settled -
      // but the operator has to be told which file to remove to get moving.
      const refusal = await recoverStagedPlanMutations({
        store,
        planPath,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(StagedPlanMutationRejected);
      expect((refusal as Error).message).toContain(path);
      expect((refusal as Error).message).toMatch(/[Dd]elete that file/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should complete an answer the reviewer canceled after the rename won", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const claimed = await claim({ store, claimedBy: AGENT_A });
      const resultSnapshot = deriveSnapshotDigest(RESULT);
      await prepareJournal({ store, request: claimed, resultSnapshot });
      // The rename won and the process died before the response file existed,
      // and the reviewer withdrew the request while that was the visible state.
      await writeFile(planPath, RESULT, "utf8");
      await writeAgentRequestValue({
        store,
        requestId: REQUEST,
        value: validateAgentRequest({
          ...claimed,
          canceledAt: "2026-08-17T12:00:06.000Z",
        }),
      });

      await expect(
        recoverStagedPlanMutations({ store, planPath }),
      ).resolves.toMatchObject([{ outcome: "completed", requestId: REQUEST }]);

      // The plan already carries the published revision, so every record
      // converges on that rather than on the withdrawal that arrived after it.
      const exchange = await readAgentExchange({
        store,
        sessionId: SESSION,
        planId,
      });
      expect(exchange.requests[0]?.answeredAt).toBe("2026-08-17T12:00:05.000Z");
      expect(exchange.requests[0]?.canceledAt).toBeUndefined();
      expect(exchange.responses).toHaveLength(1);
      await expect(readFile(planPath, "utf8")).resolves.toBe(RESULT);
      await expect(readCommittedRevisions({ store })).resolves.toMatchObject([
        { requestId: REQUEST, resultSnapshot },
      ]);
      await expect(
        readdir(store.agentMutationJournalDirectory),
      ).resolves.toEqual([]);

      await expect(
        recoverStagedPlanMutations({ store, planPath }),
      ).resolves.toEqual([]);
      expect(
        (await readAgentExchange({ store, sessionId: SESSION, planId }))
          .responses,
      ).toHaveLength(1);
      await expect(readCommittedRevisions({ store })).resolves.toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should refuse a cancel once the commit has prepared its journal", async () => {
    const { directory, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const claimed = await claim({ store, claimedBy: AGENT_A });
      await prepareJournal({
        store,
        request: claimed,
        resultSnapshot: deriveSnapshotDigest(RESULT),
      });

      await expect(
        cancelAgentRequest({
          store,
          requestId: REQUEST,
          now: new Date().toISOString(),
        }),
      ).rejects.toThrow(/already publishing/u);
      const exchange = await readAgentExchange({
        store,
        sessionId: SESSION,
        planId,
      });
      expect(exchange.requests[0]?.canceledAt).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should report a journal it cannot read at all", async () => {
    const { directory, planPath, store } = await preparedPlan();
    try {
      // A journal damaged after its commit crashed. Skipping it silently would
      // leave a published revision with no response and its request still open,
      // which is exactly the divergence the journal exists to prevent.
      const path = join(store.agentMutationJournalDirectory, `${REQUEST}.json`);
      await writeFile(path, "{ truncated", "utf8");

      const refusal = await recoverStagedPlanMutations({
        store,
        planPath,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(StagedPlanMutationRejected);
      expect((refusal as Error).message).toContain(path);
      expect((refusal as Error).message).toMatch(/[Dd]elete that file/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should name the journal when finishing its records fails", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const claimed = await claim({ store, claimedBy: AGENT_A });
      const resultSnapshot = deriveSnapshotDigest(RESULT);
      await prepareJournal({ store, request: claimed, resultSnapshot });
      await writeFile(planPath, RESULT, "utf8");
      // The published revision's snapshot cannot be retained, so finishing the
      // records fails after the answer is already stamped.
      await mkdir(join(store.snapshotDirectory, `${resultSnapshot}.mdx`), {
        recursive: true,
      });

      const refusal = await recoverStagedPlanMutations({
        store,
        planPath,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(StagedPlanMutationRejected);
      expect((refusal as Error).message).toContain(
        join(store.agentMutationJournalDirectory, `${REQUEST}.json`),
      );
      expect((refusal as Error).message).toMatch(/[Dd]elete /u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("should stop agent writes when the source matches neither digest", async () => {
    const { directory, planPath, store, planId } = await preparedPlan();
    try {
      await writeAgentRequest({ store, request: chatRequest(planId) });
      const claimed = await claim({ store, claimedBy: AGENT_A });
      await prepareJournal({
        store,
        request: claimed,
        resultSnapshot: deriveSnapshotDigest(RESULT),
      });
      const foreign = "# Plan\n\nA writer outside Big Plan was here.\n";
      await writeFile(planPath, foreign, "utf8");

      const recoveries = await recoverStagedPlanMutations({ store, planPath });
      expect(recoveries).toMatchObject([
        { outcome: "conflict", requestId: REQUEST },
      ]);
      expect(() => assertNoExternalSourceConflict(recoveries)).toThrow(
        StagedPlanMutationRejected,
      );
      // The file is reported, never overwritten, and the conflict keeps being
      // reported until a person settles it.
      await expect(readFile(planPath, "utf8")).resolves.toBe(foreign);
      expect(() => assertNoExternalSourceConflict([])).not.toThrow();
      await expect(
        recoverStagedPlanMutations({ store, planPath }),
      ).resolves.toMatchObject([{ outcome: "conflict" }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
