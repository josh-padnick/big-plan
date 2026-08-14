// Materializes reviewer-owned image references into source-controlled plan
// assets before an agent response is rendered. Review-image URIs are runtime
// references and are intentionally not part of the plan authoring grammar.

import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  extractReviewImageReferences,
  sniffReviewImage,
  type ReviewImageId,
} from "./shared/review-image.js";
import { readReviewImage } from "./store.js";
import type { ReviewStore } from "./store.js";

const PLAN_ASSET_DIRECTORY = "assets";
const REVIEW_IMAGE_NAME = /^review-image-[a-f0-9]{64}\.(png|jpg|webp)$/u;
const REVIEW_IMAGE_REFERENCE =
  /!\[([^\]\n]*)\]\(review-image:([a-f0-9]{64})\)/gu;
const DIRECTORY_MODE = 0o755;
const FILE_MODE = 0o644;

const assetName = (id: ReviewImageId, extension: string): string =>
  `review-image-${id}.${extension}`;

const assetPathFor = ({
  planPath,
  id,
  extension,
}: {
  readonly planPath: string;
  readonly id: ReviewImageId;
  readonly extension: string;
}): string =>
  join(
    dirname(resolve(planPath)),
    PLAN_ASSET_DIRECTORY,
    assetName(id, extension),
  );

const writeAsset = async ({
  path,
  bytes,
}: {
  readonly path: string;
  readonly bytes: Uint8Array;
}): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: DIRECTORY_MODE });
  try {
    const existing = Uint8Array.from(await readFile(path));
    if (
      existing.byteLength === bytes.byteLength &&
      existing.every((byte, index) => byte === bytes[index])
    ) {
      return;
    }
    throw new Error(`Plan asset already exists with different bytes: ${path}`);
  } catch (error: unknown) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }
  const temporary = `${path}.big-plan-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: FILE_MODE });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
};

/** Replaces runtime image references and writes their bytes beside the plan. */
export const materializeReviewImages = async ({
  markdown,
  planPath,
  store,
}: {
  readonly markdown: string;
  readonly planPath: string;
  readonly store: ReviewStore;
}): Promise<string> => {
  const references = extractReviewImageReferences(markdown);
  if (references.length === 0) return markdown;
  const replacements = new Map<string, string>();
  for (const reference of references) {
    const stored = await readReviewImage({ store, id: reference.id });
    if (stored === undefined) {
      throw new Error(
        `Cannot materialize unknown or corrupt review image ${reference.id}`,
      );
    }
    const format = sniffReviewImage(stored.bytes);
    if (format === undefined) {
      throw new Error(
        `Cannot materialize unknown or corrupt review image ${reference.id}`,
      );
    }
    const path = assetPathFor({
      planPath,
      id: reference.id,
      extension: format.extension,
    });
    await writeAsset({ path, bytes: stored.bytes });
    replacements.set(
      reference.id,
      `./${PLAN_ASSET_DIRECTORY}/${assetName(reference.id, format.extension)}`,
    );
  }
  return markdown.replace(
    REVIEW_IMAGE_REFERENCE,
    (whole, alt: string, id: string) => {
      const path = replacements.get(id);
      return path === undefined ? whole : `![${alt}](${path})`;
    },
  );
};

/** Writes a materialized source atomically while preserving its file mode. */
export const replacePlanSource = async ({
  path,
  source,
}: {
  readonly path: string;
  readonly source: string;
}): Promise<void> => {
  const temporary = `${path}.big-plan-materialize-${randomBytes(8).toString("hex")}`;
  const mode = (await stat(path)).mode;
  try {
    await writeFile(temporary, source, { flag: "wx", mode });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
};

/** Recognizes the only asset paths exposed by the live review server. */
export const reviewPlanAssetName = (value: string): boolean =>
  REVIEW_IMAGE_NAME.test(value);
