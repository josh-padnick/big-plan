// Owns the browser-safe image contract shared by capture, rendering, and the
// local review runtime. Byte inspection stays Uint8Array-only so this module
// can be bundled into the review island without Node dependencies.

export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 25_000_000;
export const RAW_IMAGE_BODY_LIMIT = MAX_IMAGE_BYTES + 4096;

export type ReviewImageId = string & {
  readonly __reviewImageId: unique symbol;
};

export type ReviewImageFormat = {
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  readonly extension: "png" | "jpg" | "webp";
};

export type ReviewImageDescriptor = {
  readonly id: ReviewImageId;
  readonly alt: string;
  readonly mimeType: ReviewImageFormat["mimeType"];
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
};

export type ReviewImageAttachment = ReviewImageDescriptor & {
  readonly sha256: ReviewImageId;
  readonly path: string;
};

export type ReviewImageReference = {
  readonly id: ReviewImageId;
  readonly alt: string;
};

const IMAGE_ID = /^[a-f0-9]{64}$/;

/** Validates a complete lowercase SHA-256 image id. */
export const isReviewImageId = (value: unknown): value is ReviewImageId =>
  typeof value === "string" && IMAGE_ID.test(value);

/** Converts a validated digest string into the branded image id type. */
export const reviewImageId = (value: string): ReviewImageId => {
  if (!isReviewImageId(value)) throw new Error("Invalid review image id");
  return value;
};

// The path a rendered document loads an uploaded picture from. It names only
// the content digest, so the picture belongs to the plan rather than to the
// review session that accepted it: any later review server for the same plan
// serves the same path, and a reference minted in one session still resolves
// in the next.
export const REVIEW_IMAGE_ROUTE = "/review-images/";

/** Builds the durable, session-independent source path for one stored image. */
export const reviewImageSource = (id: string): string =>
  `${REVIEW_IMAGE_ROUTE}${reviewImageId(id)}`;

/** Builds the inert Markdown reference stored in a reviewer-authored body. */
export const buildReviewImageReference = ({
  alt,
  id,
}: {
  readonly alt: string;
  readonly id: ReviewImageId;
}): string => `![${alt.replaceAll("]", "")}](review-image:${id})`;

const REFERENCE = /!\[([^\]\n]*)\]\(review-image:([a-f0-9]{64})\)/gu;

/** Extracts valid image references in source order, preserving duplicates. */
export const extractReviewImageReferences = (
  body: string,
): ReadonlyArray<ReviewImageReference> =>
  Array.from(body.matchAll(REFERENCE), (match) => ({
    id: reviewImageId(match[2] ?? ""),
    alt: match[1] ?? "Screenshot",
  }));

/** Keeps the first reference to each image in authored order. */
export const deduplicateReviewImageReferences = (
  references: ReadonlyArray<ReviewImageReference>,
): ReadonlyArray<ReviewImageReference> => {
  const seen = new Set<ReviewImageId>();
  return references.filter((reference) => {
    if (seen.has(reference.id)) return false;
    seen.add(reference.id);
    return true;
  });
};

/**
 * Collects the distinct images one outgoing message carries. The same picture
 * pasted twice is one attachment, so the message limits count what is stored
 * rather than how often the author referred to it.
 */
export const imageReferencesForBodies = (
  bodies: ReadonlyArray<string>,
): ReadonlyArray<ReviewImageReference> =>
  deduplicateReviewImageReferences(
    bodies.flatMap((body) => extractReviewImageReferences(body)),
  );

/** Returns the supported image format identified by its magic bytes. */
export const sniffReviewImage = (
  bytes: Uint8Array,
): ReviewImageFormat | undefined => {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 16 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return undefined;
};

const byte = (bytes: Uint8Array, offset: number): number => bytes[offset] ?? 0;
const u16be = (bytes: Uint8Array, offset: number): number =>
  (byte(bytes, offset) << 8) | byte(bytes, offset + 1);
const u16le = (bytes: Uint8Array, offset: number): number =>
  byte(bytes, offset) | (byte(bytes, offset + 1) << 8);
const u24le = (bytes: Uint8Array, offset: number): number =>
  byte(bytes, offset) |
  (byte(bytes, offset + 1) << 8) |
  (byte(bytes, offset + 2) << 16);
const u32be = (bytes: Uint8Array, offset: number): number =>
  (byte(bytes, offset) * 0x1000000 +
    byte(bytes, offset + 1) * 0x10000 +
    byte(bytes, offset + 2) * 0x100 +
    byte(bytes, offset + 3)) >>>
  0;
/** Reads dimensions from the small header structures of supported formats. */
export const probeReviewImageDimensions = (
  bytes: Uint8Array,
  format = sniffReviewImage(bytes),
): { readonly width: number; readonly height: number } | undefined => {
  if (format?.mimeType === "image/png" && bytes.length >= 24) {
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (format?.mimeType === "image/webp" && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") {
      return {
        width: 1 + u24le(bytes, 24),
        height: 1 + u24le(bytes, 27),
      };
    }
    if (chunk === "VP8L" && bytes.length >= 25 && byte(bytes, 20) === 0x2f) {
      const width = 1 + (byte(bytes, 21) | ((byte(bytes, 22) & 0x3f) << 8));
      const height =
        1 +
        ((byte(bytes, 22) >> 6) |
          (byte(bytes, 23) << 2) |
          ((byte(bytes, 24) & 0xf) << 10));
      return { width, height };
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
      return {
        width: u16le(bytes, 26) & 0x3fff,
        height: u16le(bytes, 28) & 0x3fff,
      };
    }
  }
  if (format?.mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (byte(bytes, offset) !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = byte(bytes, offset + 1);
      offset += 2;
      if (
        marker === 0xd8 ||
        marker === 0xd9 ||
        (marker >= 0xd0 && marker <= 0xd7)
      )
        continue;
      if (offset + 2 > bytes.length) return undefined;
      const length = u16be(bytes, offset);
      if (length < 2 || offset + length > bytes.length) return undefined;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (length < 7) return undefined;
        const height = u16be(bytes, offset + 3);
        const width = u16be(bytes, offset + 5);
        return width > 0 && height > 0 ? { width, height } : undefined;
      }
      offset += length;
    }
  }
  return undefined;
};

/** Checks the size and decoded-pixel limits for one image. */
export const isReviewImageWithinLimits = ({
  byteLength,
  width,
  height,
}: Pick<ReviewImageDescriptor, "byteLength" | "width" | "height">): boolean =>
  byteLength <= MAX_IMAGE_BYTES &&
  width > 0 &&
  height > 0 &&
  width * height <= MAX_IMAGE_PIXELS;
