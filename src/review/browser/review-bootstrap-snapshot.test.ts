import { describe, expect, it } from "vitest";
import {
  bootstrapMatchesDisplayedSnapshot,
  reviewBootstrapSnapshot,
} from "./review-bootstrap-snapshot.js";

describe("review bootstrap snapshot", () => {
  it("should seed a baseline when the fetched page represents the displayed revision", () => {
    expect(
      bootstrapMatchesDisplayedSnapshot({
        serialized: JSON.stringify({ currentSnapshot: "displayed" }),
        displayedSnapshot: "displayed",
      }),
    ).toBe(true);
  });

  it("should reject a baseline when a revision landed during the fetch", () => {
    expect(
      bootstrapMatchesDisplayedSnapshot({
        serialized: JSON.stringify({ currentSnapshot: "newer" }),
        displayedSnapshot: "displayed",
      }),
    ).toBe(false);
  });

  it("should expose no snapshot from malformed bootstrap state", () => {
    expect(reviewBootstrapSnapshot("not json")).toBe("");
  });
});
