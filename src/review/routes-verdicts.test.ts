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
      planId: "0123456789abcdef",
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
      body: { op: "reject", from, to, placeIds: [placeId] },
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
      planId: "0123456789abcdef",
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
                from,
                to,
                placeIds: [placeId],
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
      body: { op: "undo", from, to, placeIds: [placeId] },
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
});
