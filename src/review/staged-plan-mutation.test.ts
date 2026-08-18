// Proves the one boundary that reaches the plan file: a candidate publishes
// only under a live claim generation from an unmoved base, and an interrupted
// commit has exactly one answer on each side of its rename.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveSnapshotDigest,
  messageAgentRequest,
  readAgentExchange,
  requestClaimGeneration,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "./agent-exchange.js";
import { readCommittedRevisions } from "./change-set-commit.js";
import { claimAgentRequest } from "./request-mailbox.js";
import {
  assertNoExternalSourceConflict,
  commitStagedPlanMutation,
  openMutationStage,
  readMutationStage,
  recoverStagedPlanMutations,
  StagedPlanMutationRejected,
} from "./staged-plan-mutation.js";
import {
  deriveReviewPlanId,
  prepareStore,
  reviewStoreFor,
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
