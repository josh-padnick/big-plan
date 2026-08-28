// Proves the auto-accept mode record is session-scoped, validated, and safely
// reset when a new runtime takes custody.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearStaleReviewMode,
  readActiveArmedReviewMode,
  readReviewModeForSession,
  validateArmedReviewMode,
  writeArmedReviewMode,
} from "./review-mode-store.js";
import {
  deriveReviewPlanId,
  prepareStore,
  reviewStoreFor,
  writeSessionDescriptorValue,
} from "./store.js";

const SESSION = "1111111111111111";
const NEXT_SESSION = "2222222222222222";

describe("review mode store", () => {
  it("should validate only the session-stamped auto-accept record", () => {
    expect(
      validateArmedReviewMode({
        version: 1,
        mode: "auto-accept",
        sessionId: SESSION,
        armedAtMs: 42,
      }),
    ).toMatchObject({ mode: "auto-accept", sessionId: SESSION, armedAtMs: 42 });
    for (const value of [
      { version: 1, mode: "review", sessionId: SESSION, armedAtMs: 42 },
      { version: 1, mode: "auto-accept", sessionId: "wrong", armedAtMs: 42 },
      { version: 1, mode: "auto-accept", sessionId: SESSION, armedAtMs: -1 },
    ]) {
      expect(validateArmedReviewMode(value)).toBeUndefined();
    }
  });

  it("should ignore and clean a mode record from the previous session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-review-mode-"));
    const planPath = join(directory, "plan.mdx");
    const planId = deriveReviewPlanId({ planPath });
    const store = reviewStoreFor({ planPath, planId });
    await prepareStore(store);
    try {
      await writeSessionDescriptorValue({
        store,
        value: { sessionId: SESSION },
      });
      await writeArmedReviewMode({ store, sessionId: SESSION, armedAtMs: 42 });
      await expect(readActiveArmedReviewMode({ store })).resolves.toMatchObject(
        {
          sessionId: SESSION,
        },
      );

      await writeSessionDescriptorValue({
        store,
        value: { sessionId: NEXT_SESSION },
      });
      await expect(
        readActiveArmedReviewMode({ store }),
      ).resolves.toBeUndefined();
      await expect(
        readReviewModeForSession({ store, sessionId: NEXT_SESSION }),
      ).resolves.toEqual({ mode: "review" });

      await clearStaleReviewMode({ store, sessionId: NEXT_SESSION });
      await expect(
        readFile(store.reviewModePath, "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
