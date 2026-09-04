import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveSnapshotDigest } from "./agent-exchange.js";
import { changedPlaceIds } from "./change-restore.js";
import { applyChangeVerdictMutation } from "./change-verdicts-store.js";
import type { StoredChangeVerdicts } from "./change-verdicts-store.js";
import type { ReviewRouteContext } from "./review-route-context.js";
import { recordChangeVerdicts } from "./routes-verdicts.js";
import { prepareStore, reviewStoreFor, writeSnapshot } from "./store.js";
import { recordCommittedRevision } from "./change-set-commit.js";
import { writeAgentRequest } from "./agent-exchange.js";
import { writeStoreJson } from "./store.js";

const CHANGE_SET_ID = "abcdef0123456789";
const SESSION_ID = "fedcba9876543210";
const PLAN_ID = "0123456789abcdef";

const directories: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("recordChangeVerdicts", () => {
  it("restores the verdict replaced under the update lock", async () => {
    const baseline = "# Plan\n\nKeep the original wording.\n";
    const proposed = "# Plan\n\nUse the proposed wording.\n";
    const moved = `${proposed}\nA newer revision.\n`;
    const from = deriveSnapshotDigest(baseline);
    const to = deriveSnapshotDigest(proposed);
    const directory = await mkdtemp(join(tmpdir(), "big-plan-verdict-route-"));
    directories.push(directory);
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, moved);
    const store = reviewStoreFor({
      planPath,
      planId: PLAN_ID,
    });
    await prepareStore(store);
    await Promise.all([
      writeSnapshot({ store, snapshot: from, source: baseline }),
      writeSnapshot({ store, snapshot: to, source: proposed }),
    ]);
    const [placeId] = changedPlaceIds({
      baselineSource: baseline,
      proposedSource: proposed,
      from,
      to,
      fallbackTitle: "plan",
    });
    if (placeId === undefined) throw new Error("The fixture has no change");
    let stored: StoredChangeVerdicts = {
      version: 1,
      revision: 1,
      decided: [
        {
          changeSetId: CHANGE_SET_ID,
          from,
          to,
          placeId,
          verdict: "accepted",
          decidedAt: "2026-09-02T12:00:00.000Z",
          actor: "auto-accept",
        },
      ],
    };
    const context = {
      store,
      sessionId: SESSION_ID,
      planId: PLAN_ID,
      resolvedPlanPath: planPath,
      changeVerdicts: {
        read: async () => ({ version: 1, revision: 0, decided: [] }),
        update: async (
          change: (current: StoredChangeVerdicts) => StoredChangeVerdicts,
        ) => {
          stored = change(stored);
          return stored;
        },
      },
      readerProgress: { accept: () => undefined },
    } as unknown as ReviewRouteContext;

    const response = await recordChangeVerdicts(context, {
      query: new URLSearchParams(),
      headers: {},
      body: {
        op: "reject",
        changeSetId: CHANGE_SET_ID,
        from,
        to,
        places: [placeId].map((placeId) => ({ placeId })),
      },
    });

    expect(response.status).toBe(409);
    expect(stored.decided).toEqual([
      expect.objectContaining({
        placeId,
        verdict: "accepted",
        decidedAt: "2026-09-02T12:00:00.000Z",
        actor: "auto-accept",
      }),
    ]);
    await expect(readFile(planPath, "utf8")).resolves.toBe(moved);
  });

  it("preserves a newer decision when compensation runs", async () => {
    const baseline = "# Plan\n\nKeep the original wording.\n";
    const proposed = "# Plan\n\nUse the proposed wording.\n";
    const moved = `${proposed}\nA newer revision.\n`;
    const from = deriveSnapshotDigest(baseline);
    const to = deriveSnapshotDigest(proposed);
    const directory = await mkdtemp(join(tmpdir(), "big-plan-verdict-route-"));
    directories.push(directory);
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, moved);
    const store = reviewStoreFor({
      planPath,
      planId: PLAN_ID,
    });
    await prepareStore(store);
    await Promise.all([
      writeSnapshot({ store, snapshot: from, source: baseline }),
      writeSnapshot({ store, snapshot: to, source: proposed }),
    ]);
    const [placeId] = changedPlaceIds({
      baselineSource: baseline,
      proposedSource: proposed,
      from,
      to,
      fallbackTitle: "plan",
    });
    if (placeId === undefined) throw new Error("The fixture has no change");
    let stored: StoredChangeVerdicts = {
      version: 1,
      revision: 1,
      decided: [
        {
          changeSetId: CHANGE_SET_ID,
          from,
          to,
          placeId,
          verdict: "rejected",
          decidedAt: "2026-09-02T12:00:00.000Z",
          actor: "reviewer",
        },
      ],
    };
    let updates = 0;
    const context = {
      store,
      sessionId: SESSION_ID,
      planId: PLAN_ID,
      resolvedPlanPath: planPath,
      changeVerdicts: {
        read: async () => stored,
        update: async (
          change: (current: StoredChangeVerdicts) => StoredChangeVerdicts,
        ) => {
          updates += 1;
          if (updates === 2) {
            stored = applyChangeVerdictMutation({
              verdicts: stored,
              mutation: {
                op: "accept",
                changeSetId: CHANGE_SET_ID,
                from,
                to,
                places: [placeId].map((placeId) => ({ placeId })),
                decidedAt: "2026-09-02T12:01:00.000Z",
                actor: "auto-accept",
              },
            });
          }
          stored = change(stored);
          return stored;
        },
      },
      readerProgress: { accept: () => undefined },
    } as unknown as ReviewRouteContext;

    const response = await recordChangeVerdicts(context, {
      query: new URLSearchParams(),
      headers: {},
      body: {
        op: "undo",
        changeSetId: CHANGE_SET_ID,
        from,
        to,
        places: [placeId].map((placeId) => ({ placeId })),
      },
    });

    expect(response.status).toBe(409);
    expect(stored.decided).toEqual([
      expect.objectContaining({
        placeId,
        verdict: "accepted",
        decidedAt: "2026-09-02T12:01:00.000Z",
        actor: "auto-accept",
      }),
    ]);
    await expect(readFile(planPath, "utf8")).resolves.toBe(moved);
  });

  it("restores each prior verdict when a mixed batch cannot publish", async () => {
    const baseline =
      "# Plan\n\n## Alpha\n\nAlpha stays old.\n\n## Beta\n\nBeta stays old.\n";
    const proposed =
      "# Plan\n\n## Alpha\n\nAlpha is new.\n\n## Beta\n\nBeta is new.\n";
    const moved = `${proposed}\nA newer revision.\n`;
    const from = deriveSnapshotDigest(baseline);
    const to = deriveSnapshotDigest(proposed);
    const directory = await mkdtemp(join(tmpdir(), "big-plan-verdict-route-"));
    directories.push(directory);
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, moved);
    const store = reviewStoreFor({ planPath, planId: PLAN_ID });
    await prepareStore(store);
    await Promise.all([
      writeSnapshot({ store, snapshot: from, source: baseline }),
      writeSnapshot({ store, snapshot: to, source: proposed }),
    ]);
    const placeIds = changedPlaceIds({
      baselineSource: baseline,
      proposedSource: proposed,
      from,
      to,
      fallbackTitle: "plan",
    });
    expect(placeIds).toHaveLength(2);
    const [acceptedPlace, undecidedPlace] = placeIds;
    if (acceptedPlace === undefined || undecidedPlace === undefined) {
      throw new Error("The fixture has fewer than two changes");
    }
    const acceptedAt = "2026-09-02T12:00:00.000Z";
    let stored: StoredChangeVerdicts = {
      version: 1,
      revision: 1,
      decided: [
        {
          changeSetId: CHANGE_SET_ID,
          from,
          to,
          placeId: acceptedPlace,
          verdict: "accepted",
          decidedAt: acceptedAt,
          actor: "auto-accept",
        },
      ],
    };
    const context = {
      store,
      sessionId: SESSION_ID,
      planId: PLAN_ID,
      resolvedPlanPath: planPath,
      changeVerdicts: {
        read: async () => stored,
        update: async (
          change: (current: StoredChangeVerdicts) => StoredChangeVerdicts,
        ) => {
          stored = change(stored);
          return stored;
        },
      },
      readerProgress: { accept: () => undefined },
    } as unknown as ReviewRouteContext;

    const response = await recordChangeVerdicts(context, {
      query: new URLSearchParams(),
      headers: {},
      body: {
        op: "reject",
        changeSetId: CHANGE_SET_ID,
        from,
        to,
        places: [acceptedPlace, undecidedPlace].map((placeId) => ({ placeId })),
      },
    });

    expect(response.status).toBe(409);
    expect(stored.decided).toEqual([
      expect.objectContaining({
        placeId: acceptedPlace,
        verdict: "accepted",
        decidedAt: acceptedAt,
        actor: "auto-accept",
      }),
    ]);
    await expect(readFile(planPath, "utf8")).resolves.toBe(moved);
  });
});

// The address a verdict is stored under is a claim about ownership, and the
// boundary has to prove it. Checking only that the change-set id is well formed
// let a caller record one thread's decision under another thread's set, which
// is the leak ownership-scoped acceptance exists to close.
describe("recordChangeVerdicts ownership", () => {
  const OTHER_SET = "beefbeefbeefbeef";
  const REQUEST_ID = "1111111111111111";
  const ALPHA = "section/the-queue/paragraph-1";
  const BRAVO = "section/the-queue/paragraph-2";
  const head = "# Plan\n\n## The queue\n\n";
  const baseline = `${head}Alpha as first written.\n\nBravo as first written.\n`;
  const proposed = `${head}Alpha as thread A rewrote it.\n\nBravo as thread B rewrote it.\n`;
  const from = deriveSnapshotDigest(baseline);
  const to = deriveSnapshotDigest(proposed);

  it("refuses a verdict for a place another change set owns", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-verdict-own-"));
    directories.push(directory);
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, proposed);
    const store = reviewStoreFor({ planPath, planId: PLAN_ID });
    await prepareStore(store);
    await Promise.all([
      writeSnapshot({ store, snapshot: from, source: baseline }),
      writeSnapshot({ store, snapshot: to, source: proposed }),
    ]);
    // One revision answers both threads, each declaring its own block - the
    // shape in which two sets share a span.
    await writeAgentRequest({
      store,
      request: {
        version: 3,
        requestId: REQUEST_ID,
        sessionId: SESSION_ID,
        planId: PLAN_ID,
        kind: "feedback",
        packageId: "2".repeat(16),
        comments: [
          {
            id: CHANGE_SET_ID,
            body: "Say what happens to alpha.",
            createdAt: "2026-09-04T09:00:00.000Z",
            premiseSnapshot: from,
            target: {
              type: "block",
              blockId: ALPHA,
              kind: "paragraph",
              label: "Alpha as first written.",
              section: "The queue",
            },
          },
          {
            id: OTHER_SET,
            body: "Say what happens to bravo.",
            createdAt: "2026-09-04T09:00:00.000Z",
            premiseSnapshot: from,
            target: {
              type: "block",
              blockId: BRAVO,
              kind: "paragraph",
              label: "Bravo as first written.",
              section: "The queue",
            },
          },
        ],
        premiseSnapshot: from,
        baselineSnapshot: from,
        createdAt: "2026-09-04T09:00:00.000Z",
        claimedAt: "2026-09-04T09:00:00.000Z",
        claimedBy: "3".repeat(16),
        claimExpiresAtMs: Date.UTC(2026, 8, 4, 10, 0, 0),
        claimGeneration: 1,
        answeredAt: "2026-09-04T09:01:00.000Z",
        attachmentManifest: [],
        attachments: [],
      },
    });
    await writeStoreJson({
      path: join(store.agentResponseDirectory, `${REQUEST_ID}.json`),
      value: {
        version: 3,
        kind: "feedback",
        requestId: REQUEST_ID,
        sessionId: SESSION_ID,
        planId: PLAN_ID,
        claimGeneration: 1,
        resultSnapshot: to,
        createdAt: "2026-09-04T09:01:00.000Z",
        message: "Answered both.",
        outcomes: [
          {
            commentId: CHANGE_SET_ID,
            state: "changed",
            message: "Rewrote alpha.",
            changeTargets: [ALPHA],
          },
          {
            commentId: OTHER_SET,
            state: "changed",
            message: "Rewrote bravo.",
            changeTargets: [BRAVO],
          },
        ],
      },
    });
    await recordCommittedRevision({
      store,
      revision: {
        requestId: REQUEST_ID,
        changeSetIds: [CHANGE_SET_ID, OTHER_SET],
        baseSnapshot: from,
        resultSnapshot: to,
        provenance: "feedback",
        committedAt: "2026-09-04T09:01:00.000Z",
      },
    });

    let stored: StoredChangeVerdicts = { version: 1, revision: 0, decided: [] };
    const context = {
      store,
      sessionId: SESSION_ID,
      planId: PLAN_ID,
      resolvedPlanPath: planPath,
      changeVerdicts: {
        read: async () => stored,
        update: async (
          change: (current: StoredChangeVerdicts) => StoredChangeVerdicts,
        ) => {
          stored = change(stored);
          return stored;
        },
      },
      readerProgress: { accept: () => undefined },
    } as unknown as ReviewRouteContext;

    const owned = changedPlaceIds({
      baselineSource: baseline,
      proposedSource: proposed,
      from,
      to,
      fallbackTitle: "plan",
      ownership: new Map([
        [ALPHA, CHANGE_SET_ID],
        [BRAVO, OTHER_SET],
      ]),
    });
    expect(owned).toHaveLength(2);
    const [alphaPlace, bravoPlace] = owned;

    // Thread A tries to decide the place thread B owns.
    const refused = await recordChangeVerdicts(context, {
      query: new URLSearchParams(),
      headers: {},
      body: {
        op: "accept",
        changeSetId: CHANGE_SET_ID,
        from,
        to,
        places: [{ placeId: bravoPlace ?? "" }],
      },
    });
    expect(refused.status).toBe(400);
    expect(stored.decided).toEqual([]);

    // Its own place is still decidable, so the refusal is about ownership
    // rather than about the boundary refusing everything.
    const accepted = await recordChangeVerdicts(context, {
      query: new URLSearchParams(),
      headers: {},
      body: {
        op: "accept",
        changeSetId: CHANGE_SET_ID,
        from,
        to,
        places: [{ placeId: alphaPlace ?? "" }],
      },
    });
    expect(accepted.status).toBe(200);
    expect(stored.decided).toEqual([
      expect.objectContaining({
        changeSetId: CHANGE_SET_ID,
        placeId: alphaPlace,
        verdict: "accepted",
      }),
    ]);
  });
});
