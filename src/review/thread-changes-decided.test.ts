// Proves the gate that lets a thread which already changed the plan be
// deleted: it opens only once every change that thread proposed carries a
// verdict, and stays shut on anything it cannot prove.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveSnapshotDigest } from "./agent-exchange.js";
import { changedPlaceIds, changedPlaces } from "./change-restore.js";
import { recordCommittedRevision } from "./change-set-commit.js";
import { threadChangesAllDecided } from "./thread-changes-decided.js";
import type { ChangeVerdictState } from "./shared/change-verdict.js";
import { prepareStore, reviewStoreFor, writeSnapshot } from "./store.js";
import type { ReviewStore } from "./store.js";

const THREAD = "4444444444444444";
const BASELINE = `# Plan

## Status

The rollout is manual.

## Risks

Rollback is manual too.
`;
const PROPOSED = `# Plan

## Status

The rollout is automatic.

## Risks

Rollback is automatic too.
`;

const decided = (
  entries: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly placeId: string;
    readonly verdict: "accepted" | "rejected";
    readonly contentDigest?: string;
  }>,
): ChangeVerdictState => ({
  revision: entries.length,
  decided: entries.map((entry) => ({
    ...entry,
    decidedAt: "2026-09-02T12:00:00.000Z",
  })),
});

describe("threadChangesAllDecided", () => {
  let directory: string;
  let planPath: string;
  let store: ReviewStore;
  const from = deriveSnapshotDigest(BASELINE);
  const to = deriveSnapshotDigest(PROPOSED);

  const SESSION = "dddddddddddddddd";
  const PLAN = "eeeeeeeeeeeeeeee";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "big-plan-thread-decided-"));
    planPath = join(directory, "plan.mdx");
    await writeFile(planPath, PROPOSED);
    store = reviewStoreFor({ planPath, planId: PLAN });
    await prepareStore(store);
    await writeSnapshot({ store, snapshot: from, source: BASELINE });
    await writeSnapshot({ store, snapshot: to, source: PROPOSED });
    await recordCommittedRevision({
      store,
      revision: {
        requestId: "aaaaaaaaaaaaaaaa",
        changeSetIds: [THREAD],
        baseSnapshot: from,
        resultSnapshot: to,
        provenance: "feedback",
        committedAt: "2026-09-02T11:00:00.000Z",
      },
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const places = (): ReadonlyArray<string> =>
    changedPlaceIds({
      baselineSource: BASELINE,
      proposedSource: PROPOSED,
      from,
      to,
      fallbackTitle: "plan",
    });

  it("stays shut while one change is still undecided", async () => {
    const [first] = places();
    expect(first).toBeDefined();
    await expect(
      threadChangesAllDecided({
        store,
        sessionId: SESSION,
        planId: PLAN,
        planPath,
        changeSetId: THREAD,
        verdicts: decided([
          {
            changeSetId: THREAD,
            from,
            to,
            placeId: first ?? "",
            verdict: "accepted",
          },
        ]),
      }),
    ).resolves.toBe(false);
  });

  it("opens once every change carries a verdict, whichever way each went", async () => {
    const all = places();
    expect(all.length).toBeGreaterThan(1);
    await expect(
      threadChangesAllDecided({
        store,
        sessionId: SESSION,
        planId: PLAN,
        planPath,
        changeSetId: THREAD,
        verdicts: decided(
          all.map((placeId, index) => ({
            changeSetId: THREAD,
            from,
            to,
            placeId,
            verdict:
              index === 0 ? ("accepted" as const) : ("rejected" as const),
          })),
        ),
      }),
    ).resolves.toBe(true);
  });

  it("stays shut for a thread with no committed change set", async () => {
    await expect(
      threadChangesAllDecided({
        store,
        sessionId: SESSION,
        planId: PLAN,
        planPath,
        changeSetId: "9999999999999999",
        verdicts: decided([]),
      }),
    ).resolves.toBe(false);
  });

  it("stays shut when a verdict names a different revision", async () => {
    const all = places();
    await expect(
      threadChangesAllDecided({
        store,
        sessionId: SESSION,
        planId: PLAN,
        planPath,
        changeSetId: THREAD,
        verdicts: decided(
          all.map((placeId) => ({
            from: "0".repeat(16),
            to,
            placeId,
            verdict: "accepted" as const,
          })),
        ),
      }),
    ).resolves.toBe(false);
  });

  it("stays shut when every carried verdict changed again", async () => {
    const currentPlaces = changedPlaces({
      baselineSource: BASELINE,
      proposedSource: PROPOSED,
      from,
      to,
      fallbackTitle: "plan",
    });
    await expect(
      threadChangesAllDecided({
        store,
        sessionId: SESSION,
        planId: PLAN,
        planPath,
        changeSetId: THREAD,
        verdicts: decided(
          currentPlaces.map((place) => ({
            changeSetId: THREAD,
            from,
            to,
            placeId: place.placeId,
            verdict: "accepted" as const,
            contentDigest: "0".repeat(16),
          })),
        ),
      }),
    ).resolves.toBe(false);
  });
});
