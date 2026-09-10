// Proves the runtime moves the reader onto an out-of-exchange edit only when
// the new source is a coherent plan, and never re-validates a half-written one
// it has already seen.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deriveSnapshotDigest } from "./agent-exchange.js";
import { createExternalPlanEditTracker } from "./external-plan-edit.js";

const VALID = "# Plan\n\nA sound plan body.\n";
const OTHER_VALID = "# Plan\n\nA different, still sound body.\n";
// Component syntax that fails validation - a half-written edit's shape.
const INVALID = "# Plan\n\n<QuickSummary>\n";

/** A reader progress double that records only the snapshot it was moved to. */
const readerProgress = (initial: string) => {
  let snapshot = initial;
  return {
    currentSnapshot: () => snapshot,
    accept: (next: string) => {
      snapshot = next;
    },
  };
};

describe("createExternalPlanEditTracker", () => {
  let directory: string;
  let planPath: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "big-plan-external-edit-"));
    planPath = join(directory, "plan.mdx");
    await writeFile(planPath, VALID);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("should leave the reader where it is when the file is unchanged", async () => {
    const tracker = createExternalPlanEditTracker({
      resolvedPlanPath: planPath,
    });
    const progress = readerProgress(deriveSnapshotDigest(VALID));
    await tracker.settle(progress);
    expect(progress.currentSnapshot()).toBe(deriveSnapshotDigest(VALID));
  });

  it("should advance the reader onto a coherent outside edit", async () => {
    const tracker = createExternalPlanEditTracker({
      resolvedPlanPath: planPath,
    });
    const progress = readerProgress(deriveSnapshotDigest(VALID));
    await writeFile(planPath, OTHER_VALID);
    await tracker.settle(progress);
    expect(progress.currentSnapshot()).toBe(deriveSnapshotDigest(OTHER_VALID));
  });

  it("should not move the reader onto a half-written edit", async () => {
    const tracker = createExternalPlanEditTracker({
      resolvedPlanPath: planPath,
    });
    const progress = readerProgress(deriveSnapshotDigest(VALID));
    await writeFile(planPath, INVALID);
    await tracker.settle(progress);
    expect(progress.currentSnapshot()).toBe(deriveSnapshotDigest(VALID));
  });

  it("should advance once the half-written edit is finished", async () => {
    const tracker = createExternalPlanEditTracker({
      resolvedPlanPath: planPath,
    });
    const progress = readerProgress(deriveSnapshotDigest(VALID));
    await writeFile(planPath, INVALID);
    await tracker.settle(progress);
    await writeFile(planPath, OTHER_VALID);
    await tracker.settle(progress);
    expect(progress.currentSnapshot()).toBe(deriveSnapshotDigest(OTHER_VALID));
  });
});
