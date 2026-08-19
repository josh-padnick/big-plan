import { describe, expect, it } from "vitest";
import {
  buildReviewImageReference,
  extractReviewImageReferences,
  isReviewImageWithinLimits,
  probeReviewImageDimensions,
  reviewImageId,
  reviewImageSource,
  sniffReviewImage,
} from "./review-image.js";

const id = reviewImageId("a".repeat(64));
const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0, 2, 0, 0, 0, 3,
]);
const jpeg = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x04, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
]);
const webp = (() => {
  const bytes = new Uint8Array(30);
  bytes.set([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
    0x38, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0x07, 0, 0, 0x09, 0, 0,
  ]);
  return bytes;
})();

describe("review images", () => {
  it("should round-trip ordered references and preserve duplicates", () => {
    const first = buildReviewImageReference({ alt: "one", id });
    const second = buildReviewImageReference({ alt: "two", id });
    expect(extractReviewImageReferences(`x ${first} y ${second}`)).toEqual([
      { id, alt: "one" },
      { id, alt: "two" },
    ]);
  });

  it("should address a stored picture by digest alone", () => {
    expect(reviewImageSource(id)).toBe(`/review-images/${id}`);
    expect(() => reviewImageSource("not-a-digest")).toThrow(
      "Invalid review image id",
    );
  });

  it("should sniff supported signatures and reject lookalikes", () => {
    expect(sniffReviewImage(png)?.mimeType).toBe("image/png");
    expect(sniffReviewImage(jpeg)?.mimeType).toBe("image/jpeg");
    expect(sniffReviewImage(webp)?.mimeType).toBe("image/webp");
    expect(sniffReviewImage(png.slice(0, 8))).toBeUndefined();
    expect(
      sniffReviewImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38])),
    ).toBeUndefined();
    expect(
      sniffReviewImage(Uint8Array.from([0x3c, 0x73, 0x76, 0x67])),
    ).toBeUndefined();
  });

  it("should probe PNG dimensions and enforce byte and pixel limits", () => {
    expect(probeReviewImageDimensions(png)).toEqual({ width: 2, height: 3 });
    expect(probeReviewImageDimensions(jpeg)).toEqual({ width: 4, height: 3 });
    expect(probeReviewImageDimensions(webp)).toEqual({ width: 8, height: 10 });
    expect(
      isReviewImageWithinLimits({ byteLength: 10, width: 2, height: 3 }),
    ).toBe(true);
    expect(
      isReviewImageWithinLimits({
        byteLength: 10 * 1024 * 1024 + 1,
        width: 2,
        height: 3,
      }),
    ).toBe(false);
    expect(
      isReviewImageWithinLimits({ byteLength: 10, width: 5000, height: 5001 }),
    ).toBe(false);
  });

  // The builder and the pattern have to agree on what an alt may hold, or a
  // reference is produced that nothing downstream recognizes - and the image
  // is silently never frozen as an attachment. Both line breaks count: a
  // lone carriage return is a real line break in text pasted from Windows.
  it("should keep a line break out of a reference, and out of what one matches", () => {
    const built = buildReviewImageReference({
      alt: "Wallet screen\r\nafter retry",
      id: reviewImageId("a".repeat(64)),
    });

    expect(built).not.toMatch(/[\r\n]/u);
    expect(extractReviewImageReferences(built)).toEqual([
      { id: reviewImageId("a".repeat(64)), alt: "Wallet screen after retry" },
    ]);
    expect(
      extractReviewImageReferences(
        `![Wallet\rscreen](review-image:${"a".repeat(64)})`,
      ),
    ).toEqual([]);
  });
});
