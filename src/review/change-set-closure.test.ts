import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveSnapshotDigest } from "./agent-exchange.js";
import { autoAcceptChangeSets } from "./change-set-closure.js";
import { changedPlaceIds } from "./change-restore.js";
import {
  prepareStore,
  reviewStoreFor,
  writeChangeVerdicts,
  writeSnapshot,
} from "./store.js";

describe("autoAcceptChangeSets", () => {
  it("preserves an existing rejection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-auto-accept-"));
    const planPath = join(directory, "plan.mdx");
    const baseline = "# Plan\n\nKeep the original wording.\n";
    const proposed = "# Plan\n\nUse the proposed wording.\n";
    const from = deriveSnapshotDigest(baseline);
    const to = deriveSnapshotDigest(proposed);
    await writeFile(planPath, proposed);
    const store = reviewStoreFor({
      planPath,
      planId: "0123456789abcdef",
    });
    try {
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
      await writeChangeVerdicts({
        store,
        verdicts: {
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
        },
      });

      const { verdicts } = await autoAcceptChangeSets({
        store,
        planPath,
        transactions: [{ from, to }],
        decidedAt: "2026-09-02T12:01:00.000Z",
      });

      expect(verdicts.decided).toEqual([
        expect.objectContaining({
          placeId,
          verdict: "rejected",
          actor: "reviewer",
        }),
      ]);
      expect(
        verdicts.decided.filter((entry) => entry.verdict === "accepted"),
      ).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
