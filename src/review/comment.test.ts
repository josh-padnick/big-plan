import { describe, expect, it } from "vitest";
import type { BlockMapEntry } from "./comment.js";
import {
  CommentRejected,
  validateActiveDraft,
  validateComments,
} from "./comment.js";

const BLOCKS: ReadonlyMap<string, BlockMapEntry> = new Map([
  [
    "section/status-quo/paragraph-1",
    {
      id: "section/status-quo/paragraph-1",
      kind: "paragraph",
      label: "Today's reality",
      section: "Status quo",
    },
  ],
]);

const NOW = "2026-07-31T00:00:00.000Z";

const validate = (value: unknown) =>
  validateComments({ value, blocks: BLOCKS, now: NOW });

const commentOn = (target: unknown) => [
  { id: "aabbccdd", body: "A note.", createdAt: NOW, target },
];

describe("validateComments acceptance", () => {
  it("should accept a whole-plan note when it names no block", () => {
    expect(validate(commentOn({ type: "document" }))).toEqual([
      {
        id: "aabbccdd",
        body: "A note.",
        createdAt: NOW,
        target: { type: "document" },
      },
    ]);
  });

  it("should accept a line range when it points at a block in the map", () => {
    const [comment] = validate(
      commentOn({
        type: "lines",
        blockId: "section/status-quo/paragraph-1",
        start: 12,
        end: 18,
        quote: "const a = 1;",
      }),
    );
    expect(comment?.target).toEqual({
      type: "lines",
      blockId: "section/status-quo/paragraph-1",
      kind: "paragraph",
      label: "Today's reality",
      section: "Status quo",
      start: 12,
      end: 18,
      quote: "const a = 1;",
    });
  });

  it("should accept an empty batch when nothing is pending", () => {
    expect(validate([])).toEqual([]);
  });
});

describe("validateComments target resolution", () => {
  it("should refuse a target naming a block this document does not contain", () => {
    expect(() =>
      validate(commentOn({ type: "block", blockId: "section/made-up/p-1" })),
    ).toThrow(CommentRejected);
  });

  it("should refuse a traversal path where a block id belongs", () => {
    expect(() =>
      validate(commentOn({ type: "block", blockId: "../../../../etc/passwd" })),
    ).toThrow(CommentRejected);
  });

  it("should take kind and label from the block map when the caller supplies its own", () => {
    // A caller can claim any label; only the renderer's own map decides what a
    // target is called in the agent's brief.
    const [comment] = validate(
      commentOn({
        type: "block",
        blockId: "section/status-quo/paragraph-1",
        kind: "spoofed",
        label: "SOMETHING ELSE ENTIRELY",
      }),
    );
    expect(comment?.target).toEqual({
      type: "block",
      blockId: "section/status-quo/paragraph-1",
      kind: "paragraph",
      label: "Today's reality",
      section: "Status quo",
    });
  });

  it("should refuse an unsupported target type", () => {
    expect(() => validate(commentOn({ type: "shell-command" }))).toThrow(
      CommentRejected,
    );
  });

  it("should refuse a range that ends before it starts", () => {
    expect(() =>
      validate(
        commentOn({
          type: "lines",
          blockId: "section/status-quo/paragraph-1",
          start: 20,
          end: 4,
        }),
      ),
    ).toThrow(CommentRejected);
  });
});

describe("validateActiveDraft", () => {
  it("should preserve exact whitespace in an unfinished whole-plan field", () => {
    expect(validateActiveDraft("  Still thinking.\n")).toBe(
      "  Still thinking.\n",
    );
  });

  it("should refuse an unfinished field beyond the comment body limit", () => {
    expect(() => validateActiveDraft("x".repeat(4001))).toThrow(
      CommentRejected,
    );
  });
});

describe("validateComments shape and bounds", () => {
  it("should refuse anything that is not a list of comments", () => {
    expect(() => validate({ comments: [] })).toThrow(CommentRejected);
  });

  it("should refuse an id that is not the document's own hexadecimal form", () => {
    expect(() =>
      validate([
        { id: "../evil", body: "A note.", target: { type: "document" } },
      ]),
    ).toThrow(CommentRejected);
  });

  it("should refuse duplicate ids within one comment batch", () => {
    expect(() =>
      validate([
        { id: "aabbccdd", body: "First.", target: { type: "document" } },
        { id: "aabbccdd", body: "Second.", target: { type: "document" } },
      ]),
    ).toThrow(/unique/);
  });

  it("should refuse an empty body", () => {
    expect(() =>
      validate([{ id: "aabbccdd", body: "   ", target: { type: "document" } }]),
    ).toThrow(CommentRejected);
  });

  it("should refuse a body beyond the length limit", () => {
    expect(() =>
      validate([
        {
          id: "aabbccdd",
          body: "x".repeat(4001),
          target: { type: "document" },
        },
      ]),
    ).toThrow(CommentRejected);
  });

  it("should stamp the runtime's own time when a comment carries no usable one", () => {
    const [comment] = validate([
      { id: "aabbccdd", body: "A note.", target: { type: "document" } },
    ]);
    expect(comment?.createdAt).toBe(NOW);
  });

  it("should keep markup in a body as literal text rather than rejecting it", () => {
    // Reviewer text is data everywhere downstream, so a body that looks like
    // markup is a perfectly ordinary comment.
    const [comment] = validate([
      {
        id: "aabbccdd",
        body: "<img src=x onerror=alert(1)>",
        target: { type: "document" },
      },
    ]);
    expect(comment?.body).toBe("<img src=x onerror=alert(1)>");
  });
});
