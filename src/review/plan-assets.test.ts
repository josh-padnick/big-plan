import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { materializeReviewImages } from "./plan-assets.js";
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
  it("materializes reviewer references into relative source assets", async () => {
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
      await expect(
        materializeReviewImages({ markdown: source, planPath, store }),
      ).resolves.toBe(
        `# Plan\n\n![Capture](./assets/review-image-${descriptor.id}.png)\n`,
      );
      await expect(
        readFile(
          join(directory, "assets", `review-image-${descriptor.id}.png`),
        ),
      ).resolves.toEqual(Buffer.from(TINY_PNG));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
