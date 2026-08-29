import { describe, expect, it } from "vitest";
import type { BlockMapEntry } from "./comment.js";
import {
  boundQuote,
  CommentRejected,
  QUOTE_LIMIT,
  validateComments,
  validateResolvedCommentIds,
  validateStoredComments,
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
  [
    "section/status-quo/paragraph-2",
    {
      id: "section/status-quo/paragraph-2",
      kind: "paragraph",
      label: "What changes next",
      section: "Status quo",
    },
  ],
  [
    "section/status-quo/image-1",
    {
      id: "section/status-quo/image-1",
      kind: "image",
      label: "Deployment screenshot",
      section: "Status quo",
    },
  ],
  [
    "section/status-quo/heading-1",
    {
      id: "section/status-quo/heading-1",
      kind: "heading",
      label: "Status quo",
      section: "Status quo",
      slideText: "Status quo\n\nToday's reality\n\nWhat changes next",
    },
  ],
  [
    "section/http-endpoints/heading-1",
    {
      id: "section/http-endpoints/heading-1",
      kind: "heading",
      label: "HTTP endpoints",
      section: "HTTP endpoints",
      slideText: "HTTP endpoints",
      slideSubHeadings: ["The queueing endpoint", "The status endpoint"],
    },
  ],
]);

const NOW = "2026-07-31T00:00:00.000Z";
const PREMISE = "1111111111111111";

const validate = (value: unknown) =>
  validateComments({
    value: Array.isArray(value)
      ? value.map((entry) =>
          typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? { premiseSnapshot: PREMISE, ...entry }
            : entry,
        )
      : value,
    blocks: BLOCKS,
    now: NOW,
  });

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
        premiseSnapshot: PREMISE,
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
      isQuoteExcerpt: false,
    });
  });

  it("should accept selected text spanning two renderer-owned blocks", () => {
    const [comment] = validate(
      commentOn({
        type: "selection",
        blockId: "section/status-quo/paragraph-1",
        endBlockId: "section/status-quo/paragraph-2",
        start: 12,
        end: 4,
        quote: "reality\nWhat",
      }),
    );
    expect(comment?.target).toEqual({
      type: "selection",
      blockId: "section/status-quo/paragraph-1",
      endBlockId: "section/status-quo/paragraph-2",
      kind: "paragraph",
      label: "Today's reality",
      section: "Status quo",
      start: 12,
      end: 4,
      quote: "reality\nWhat",
      isQuoteExcerpt: false,
    });
  });

  it("should preserve image blocks included in a text selection", () => {
    const [comment] = validate(
      commentOn({
        type: "selection",
        blockId: "section/status-quo/paragraph-1",
        start: 12,
        end: 12,
        quote: "A claim.\n[Image: Deployment screenshot]",
        imageBlockIds: ["section/status-quo/image-1"],
      }),
    );
    expect(comment?.target).toMatchObject({
      type: "selection",
      imageBlockIds: ["section/status-quo/image-1"],
    });
  });

  it("should accept an empty batch when nothing is pending", () => {
    expect(validate([])).toEqual([]);
  });
});

describe("boundQuote", () => {
  // Regression: a highlight past the bound used to withdraw the comment
  // control, so the reviewer's selection was dropped with nothing said.
  it("should keep a highlight whole when it fits the bound", () => {
    const selected = "x".repeat(QUOTE_LIMIT);
    expect(boundQuote(selected)).toEqual({
      quote: selected,
      isQuoteExcerpt: false,
    });
  });

  it("should mark and trim a highlight when it passes the bound", () => {
    const result = boundQuote("y".repeat(QUOTE_LIMIT + 1));
    expect(result.isQuoteExcerpt).toBe(true);
    expect(result.quote).toHaveLength(QUOTE_LIMIT);
  });

  it("should leave a short highlight and an empty one unmarked", () => {
    expect(boundQuote("A claim.")).toEqual({
      quote: "A claim.",
      isQuoteExcerpt: false,
    });
    expect(boundQuote("")).toEqual({ quote: "", isQuoteExcerpt: false });
  });
});

describe("validateComments target resolution", () => {
  it("should resolve a qualified target through its retained snapshot map", () => {
    const snapshot = "2222222222222222";
    const [comment] = validateComments({
      value: [
        {
          ...commentOn({
            type: "block",
            blockId: "section/status-quo/paragraph-1",
            snapshot,
            kind: "ignored",
            label: "ignored",
          })[0],
          premiseSnapshot: PREMISE,
        },
      ],
      blocks: BLOCKS,
      blocksForSnapshot: () => BLOCKS,
      now: NOW,
    });
    expect(comment?.target).toEqual({
      type: "block",
      blockId: "section/status-quo/paragraph-1",
      snapshot,
      kind: "paragraph",
      label: "Today's reality",
      section: "Status quo",
    });
  });

  it("should refuse a qualified target when its snapshot is no longer retained", () => {
    expect(() =>
      validateComments({
        value: [
          {
            ...commentOn({
              type: "block",
              blockId: "section/status-quo/paragraph-1",
              snapshot: "2222222222222222",
              kind: "ignored",
              label: "ignored",
            })[0],
            premiseSnapshot: PREMISE,
          },
        ],
        blocks: BLOCKS,
        blocksForSnapshot: () => undefined,
        now: NOW,
      }),
    ).toThrow("no longer retained");
  });

  it("should refuse a target naming a block this document does not contain", () => {
    expect(() =>
      validate(commentOn({ type: "block", blockId: "section/made-up/p-1" })),
    ).toThrow(CommentRejected);
  });

  it("should refuse a cross-block selection with an unknown end block", () => {
    expect(() =>
      validate(
        commentOn({
          type: "selection",
          blockId: "section/status-quo/paragraph-1",
          endBlockId: "section/status-quo/made-up",
          start: 0,
          end: 4,
          quote: "Some text",
        }),
      ),
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

  it("should scope a comment on a slide's heading to the whole slide", () => {
    const [comment] = validate(
      commentOn({ type: "block", blockId: "section/status-quo/heading-1" }),
    );
    expect(comment?.target).toEqual({
      type: "block",
      blockId: "section/status-quo/heading-1",
      kind: "slide",
      label: "Status quo",
      section: "Status quo",
      slideText: "Status quo\n\nToday's reality\n\nWhat changes next",
      isSlideTextExcerpt: false,
    });
  });

  it("should scope a highlight of a slide's heading to the whole slide", () => {
    const [comment] = validate(
      commentOn({
        type: "selection",
        blockId: "section/status-quo/heading-1",
        start: 0,
        end: 10,
        quote: "Status quo",
      }),
    );
    expect(comment?.target).toMatchObject({
      kind: "slide",
      quote: "Status quo",
      slideText: "Status quo\n\nToday's reality\n\nWhat changes next",
    });
  });

  it("should leave a comment inside one block anchored to that block alone", () => {
    const [comment] = validate(
      commentOn({
        type: "selection",
        blockId: "section/status-quo/paragraph-1",
        start: 0,
        end: 5,
        quote: "Today",
      }),
    );
    expect(comment?.target).not.toHaveProperty("slideText");
    expect(comment?.target).toMatchObject({ kind: "paragraph" });
  });

  it("should carry the sub-slides a grouped slide continues into", () => {
    const [comment] = validate(
      commentOn({ type: "block", blockId: "section/http-endpoints/heading-1" }),
    );
    expect(comment?.target).toMatchObject({
      kind: "slide",
      slideText: "HTTP endpoints",
      slideSubHeadings: ["The queueing endpoint", "The status endpoint"],
    });
  });

  it("should refuse a caller's own claim of sub-slide reach", () => {
    // The renderer alone decides how far a slide reaches; a request naming
    // sub-slides would otherwise send the agent off to edit unrelated sections.
    const [comment] = validate(
      commentOn({
        type: "block",
        blockId: "section/status-quo/heading-1",
        slideSubHeadings: ["A section nobody pointed at"],
      }),
    );
    expect(comment?.target).not.toHaveProperty("slideSubHeadings");
  });

  it("should refuse a caller's own claim of slide reach", () => {
    // Only the renderer decides which block names a slide; a request that
    // asserts it would otherwise hand the agent content no reviewer pointed at.
    const [comment] = validate(
      commentOn({
        type: "block",
        blockId: "section/status-quo/paragraph-1",
        kind: "slide",
        slideText: "Content the reviewer never highlighted.",
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

  it("should refuse a reversed selection with an explicit same-block end", () => {
    expect(() =>
      validate(
        commentOn({
          type: "selection",
          blockId: "section/status-quo/paragraph-1",
          endBlockId: "section/status-quo/paragraph-1",
          start: 20,
          end: 4,
          quote: "backwards",
        }),
      ),
    ).toThrow(CommentRejected);
  });

  it("should keep the excerpt mark when a long highlight was trimmed", () => {
    const [comment] = validate(
      commentOn({
        type: "selection",
        blockId: "section/status-quo/paragraph-1",
        start: 0,
        end: 9000,
        quote: "x".repeat(QUOTE_LIMIT),
        isQuoteExcerpt: true,
      }),
    );
    // The offsets still address the whole highlight, so the mark is the only
    // thing telling a reader the stored quote is not all of it.
    expect(comment?.target).toMatchObject({
      type: "selection",
      start: 0,
      end: 9000,
      isQuoteExcerpt: true,
    });
  });

  it("should refuse a quote beyond the highlight limit", () => {
    expect(() =>
      validate(
        commentOn({
          type: "selection",
          blockId: "section/status-quo/paragraph-1",
          start: 0,
          end: 1,
          quote: "x".repeat(QUOTE_LIMIT + 1),
        }),
      ),
    ).toThrow(CommentRejected);
  });

  it("should name a malformed target in its rejection", () => {
    expect(() =>
      validate([{ id: "aabbccdd", body: "A note.", target: "document" }]),
    ).toThrow('"target" must be an object');
  });
});

describe("validateResolvedCommentIds", () => {
  it("should refuse duplicate ids", () => {
    expect(() => validateResolvedCommentIds(["aabbccdd", "aabbccdd"])).toThrow(
      "Resolved comment ids must be unique",
    );
  });

  it("should retain durable resolution history beyond one submission batch", () => {
    expect(
      validateResolvedCommentIds(
        Array.from({ length: 201 }, (_, index) =>
          index.toString(16).padStart(4, "0"),
        ),
      ),
    ).toHaveLength(201);
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

  it("should refuse an empty body", () => {
    expect(() =>
      validate([{ id: "aabbccdd", body: "   ", target: { type: "document" } }]),
    ).toThrow(CommentRejected);
  });

  it("should refuse duplicate comment ids", () => {
    expect(() =>
      validate([
        { id: "aabbccdd", body: "First.", target: { type: "document" } },
        { id: "aabbccdd", body: "Second.", target: { type: "document" } },
      ]),
    ).toThrow("Comment ids must be unique");
  });

  it("should refuse more than 200 comments", () => {
    expect(() =>
      validate(
        Array.from({ length: 201 }, (_, index) => ({
          id: index.toString(16).padStart(4, "0"),
          body: `Comment ${index}`,
          target: { type: "document" },
        })),
      ),
    ).toThrow("More than 200 comments in one batch");
  });

  it("should retain durable history beyond one submission batch", () => {
    const history = Array.from({ length: 201 }, (_, index) => ({
      id: index.toString(16).padStart(4, "0"),
      body: `Comment ${index}`,
      createdAt: NOW,
      premiseSnapshot: PREMISE,
      target: { type: "document" },
    }));

    expect(validateStoredComments({ value: history, now: NOW })).toHaveLength(
      201,
    );
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
