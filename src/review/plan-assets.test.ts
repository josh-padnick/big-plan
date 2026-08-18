import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  prepareReviewImageAssets,
  publishPreparedPlanAssets,
} from "./plan-assets.js";
import {
  deriveReviewPlanId,
  prepareStore,
  publishReviewImage,
  reviewStoreFor,
} from "./store.js";

const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0, 2, 0, 0, 0, 3,
]);

describe("plan image assets", () => {
  it("prepares reviewer references without touching the repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-plan-assets-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Plan\n");
    const store = reviewStoreFor({
      planPath,
      planId: deriveReviewPlanId({ planPath }),
    });
    await prepareStore(store);
    const descriptor = await publishReviewImage({
      store,
      bytes: TINY_PNG,
      alt: "Capture",
    });
    try {
      const source = `# Plan\n\n![Capture](review-image:${descriptor.id})\n`;
      const assetPath = join(
        directory,
        "assets",
        `review-image-${descriptor.id}.png`,
      );
      const prepared = await prepareReviewImageAssets({
        markdown: source,
        planPath,
        store,
      });
      expect(prepared.source).toBe(
        `# Plan\n\n![Capture](./assets/review-image-${descriptor.id}.png)\n`,
      );
      // Preparation runs before the commit takes its lock, so nothing it does
      // may reach the plan's repository yet.
      await expect(readFile(assetPath)).rejects.toThrow();

      await publishPreparedPlanAssets(prepared.assets);
      await expect(readFile(assetPath)).resolves.toEqual(Buffer.from(TINY_PNG));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
