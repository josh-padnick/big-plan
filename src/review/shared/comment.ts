// Owns what a comment is allowed to be. Everything arriving from the document
// is untrusted - the reviewer typed it, or a plan author wrote the text it
// quotes - so nothing crosses this module without being checked into a shape
// the rest of the runtime can hold safely.
//
// The one rule that matters most: a target names a block only by an id the
// renderer minted for this document, checked against the block map rather than
// pattern-matched. A target can therefore never become a filesystem path, a
// URL, or anything else with reach.

/**
 * What every target records about the block it names.
 *
 * `slideText` is present exactly when that block is a slide's own heading. A
 * slide has no block of its own, so its heading is the only address a reviewer
 * pointing at the slide can produce; carrying the slide's content here is what
 * keeps "rewrite this slide" from reaching the agent as the title alone. It
 * widens what the agent is told, never what the comment is anchored to.
 */
type TargetBlockIdentity = {
  readonly blockId: string;
  readonly kind: string;
  readonly label: string;
  readonly section?: string;
  readonly snapshot?: string;
  readonly slideText?: string;
  readonly isSlideTextExcerpt?: boolean;
  readonly slideSubHeadings?: ReadonlyArray<string>;
};

/** Where one comment points. */
export type CommentTarget =
  | { readonly type: "document" }
  | ({
      readonly type: "block";
    } & TargetBlockIdentity)
  | ({
      readonly type: "selection";
      readonly endBlockId?: string;
      /** Authored image blocks included in this text/image highlight. */
      readonly imageBlockIds?: ReadonlyArray<string>;
      readonly start: number;
      readonly end: number;
      readonly quote: string;
      readonly isQuoteExcerpt: boolean;
    } & TargetBlockIdentity)
  | ({
      readonly type: "lines";
      readonly start: number;
      readonly end: number;
      readonly quote: string;
      readonly isQuoteExcerpt: boolean;
    } & TargetBlockIdentity);

/** One reviewer note, after validation. */
export type ReviewComment = {
  readonly id: string;
  readonly body: string;
  readonly createdAt: string;
  readonly premiseSnapshot: string;
  readonly target: CommentTarget;
  /**
   * The change this comment was written about, where it was written from the
   * change drawer rather than as a note on the plan.
   *
   * A comment is the first thing said in its thread, and a drawer that shows
   * one change's conversation has to be able to recognise it. Every later
   * message carries the association on its reply; without it here, the one
   * message the reviewer sent from the drawer is the one message the drawer
   * cannot show them.
   */
  readonly aboutBlockId?: string;
};

/** What the renderer knows about the blocks a comment may point at. */
// Mirrored by hand across the reviewShared tier boundary; reviewShared may
// import nothing - keep this in sync with the descriptor minted by
// src/render/markdown/block-identity.ts.
export type BlockMapEntry = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly section?: string;
  /** This slide's own content, on the heading that names the slide scope. */
  readonly slideText?: string;
  /** The sub-slides a grouped slide continues into, named in reading order. */
  readonly slideSubHeadings?: ReadonlyArray<string>;
};

export class CommentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentRejected";
  }
}

// Bounds exist so one submit cannot fill the disk or produce a brief no agent
// can read; they are limits, not sanitization.
//
// A range target is anchored by its block and offsets, so the quote is a copy
// held for the agent's brief rather than the address of anything. That is why
// the bound may never gate the affordance: a selection longer than this is
// stored as a marked excerpt of the same range, never refused. The bound
// matches BODY_LIMIT because a quote and a comment body cost a brief the same.
export const BODY_LIMIT = 4000;
export const QUOTE_LIMIT = BODY_LIMIT;
// A slide's content is the unit of work a slide comment asks about, so it gets
// its own, larger bound: a highlight is a fragment the agent can look up in the
// source, while a truncated slide is the very under-application this carries
// the content to prevent. It is still a bound, and a slide beyond it says so
// through isSlideTextExcerpt rather than trailing off silently.
export const SLIDE_TEXT_LIMIT = 8000;
// A grouped slide names its sub-slides instead of repeating their bodies, so
// the list costs a brief a heading each. It is bounded like any other target
// text: enough entries for a real section, and a per-entry length matching the
// label bound the same target already carries.
export const SLIDE_SUB_HEADING_LIMIT = 50;
export const SLIDE_SUB_HEADING_TEXT_LIMIT = 300;
const ID_LIMIT = 64;
const COMMENT_LIMIT = 200;
// A selection can cover several pictures, but not an unbounded number: every
// entry costs a `resolveBlock` walk, and this list arrives from the browser
// like every other bounded field in this validator.
const IMAGE_BLOCK_ID_LIMIT = 20;

const boundedImageBlockIds = (
  value: ReadonlyArray<unknown>,
): ReadonlyArray<unknown> => {
  if (value.length > IMAGE_BLOCK_ID_LIMIT) {
    throw new CommentRejected(
      `"imageBlockIds" cannot name more than ${IMAGE_BLOCK_ID_LIMIT} images`,
    );
  }
  return value;
};
const BLOCK_ID = /^[a-z0-9][a-z0-9/_.-]{0,299}$/;

/** What a producer stores for a highlight, once bounded. */
export type QuoteExcerpt = {
  readonly quote: string;
  readonly isQuoteExcerpt: boolean;
};

/**
 * Bounds highlighted plan text into the copy stored with a range target.
 * The caller keeps the whole range either way: the bound trims what travels
 * with the comment, and never decides whether a highlight may be commented on.
 */
export const boundQuote = (selected: string): QuoteExcerpt =>
  selected.length > QUOTE_LIMIT
    ? { quote: selected.slice(0, QUOTE_LIMIT), isQuoteExcerpt: true }
    : { quote: selected, isQuoteExcerpt: false };

/**
 * Bounds a slide's content into the copy carried with a slide-anchored target,
 * marking the result when the slide did not fit so the brief can say so.
 */
const boundSlideText = (
  slideText: string,
): {
  readonly slideText: string;
  readonly isSlideTextExcerpt: boolean;
} =>
  slideText.length > SLIDE_TEXT_LIMIT
    ? {
        slideText: slideText.slice(0, SLIDE_TEXT_LIMIT),
        isSlideTextExcerpt: true,
      }
    : { slideText, isSlideTextExcerpt: false };

/**
 * Bounds the sub-slide names carried with a grouped slide's target, dropping
 * empty entries so the brief never names a slide with nothing.
 */
const boundSlideSubHeadings = (
  headings: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  headings
    .filter((heading) => heading.trim() !== "")
    .slice(0, SLIDE_SUB_HEADING_LIMIT)
    .map((heading) => heading.slice(0, SLIDE_SUB_HEADING_TEXT_LIMIT));

// The slide scope a block carries, if it is a slide's own heading. The renderer
// decides this - never the request - so a caller cannot claim slide reach for a
// block that has none.
const slideScopeOf = (
  block: BlockMapEntry,
): Pick<
  TargetBlockIdentity,
  "kind" | "slideText" | "isSlideTextExcerpt" | "slideSubHeadings"
> => {
  if (block.slideText === undefined || block.slideText === "") {
    return { kind: block.kind };
  }
  const slideSubHeadings = boundSlideSubHeadings(block.slideSubHeadings ?? []);
  // The heading names the whole slide, so the target's kind is what the block
  // addresses rather than the tag it happens to be rendered as.
  return {
    kind: "slide",
    ...boundSlideText(block.slideText),
    ...(slideSubHeadings.length === 0 ? {} : { slideSubHeadings }),
  };
};

const asRecord = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CommentRejected(`"${field}" must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
};

const asText = ({
  value,
  field,
  limit,
}: {
  readonly value: unknown;
  readonly field: string;
  readonly limit: number;
}): string => {
  if (typeof value !== "string") {
    throw new CommentRejected(`"${field}" must be text`);
  }
  if (value.length > limit) {
    throw new CommentRejected(`"${field}" is longer than ${limit} characters`);
  }
  return value;
};

/** Validates the durable set of resolved thread ids stored beside comments. */
export const validateResolvedCommentIds = (
  value: unknown,
): ReadonlyArray<string> => {
  if (!Array.isArray(value)) {
    throw new CommentRejected("Resolved comment ids must arrive as a list");
  }
  const ids = value.map(asId);
  if (new Set(ids).size !== ids.length) {
    throw new CommentRejected("Resolved comment ids must be unique");
  }
  return ids;
};

// Ids are the document's own, so they may only be what the document mints:
// hexadecimal, and short. Anything else is a caller that did not come from a
// document this runtime rendered.
const asId = (value: unknown): string => {
  const text = asText({ value, field: "id", limit: ID_LIMIT });
  if (!/^[a-f0-9]{4,64}$/.test(text)) {
    throw new CommentRejected(
      "A comment id must be a short hexadecimal string",
    );
  }
  return text;
};

const asTimestamp = (value: unknown, fallback: string): string => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return fallback;
  }
  return new Date(value).toISOString();
};

const asSnapshotDigest = (
  value: unknown,
  field = "premiseSnapshot",
): string => {
  const digest = asText({ value, field, limit: 64 });
  if (!/^[a-f0-9]{16,64}$/.test(digest)) {
    throw new CommentRejected(
      `"${field}" must be a hexadecimal snapshot digest`,
    );
  }
  return digest;
};

const asOffset = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new CommentRejected(`"${field}" must be a whole number`);
  }
  return value;
};

// The block map is the only authority on which blocks exist. Resolving through
// it - rather than accepting a well-shaped string - is what keeps a target
// from reaching anything the renderer did not put in this document.
const resolveBlock = ({
  value,
  blocks,
}: {
  readonly value: unknown;
  readonly blocks: ReadonlyMap<string, BlockMapEntry>;
}): BlockMapEntry => {
  if (typeof value !== "string") {
    throw new CommentRejected("A block target must name a block");
  }
  const block = blocks.get(value);
  if (block === undefined) {
    throw new CommentRejected(
      "A comment points at a block this document does not contain",
    );
  }
  return block;
};

const validateTarget = ({
  value,
  blocks,
  snapshots,
}: {
  readonly value: unknown;
  readonly blocks: ReadonlyMap<string, BlockMapEntry>;
  readonly snapshots?: ReadonlyMap<string, ReadonlyMap<string, BlockMapEntry>>;
}): CommentTarget => {
  const target = asRecord({ value, field: "target" });
  const type = target.type;
  if (type === "document") {
    return { type: "document" };
  }
  const snapshot =
    target.snapshot === undefined
      ? undefined
      : asSnapshotDigest(target.snapshot, "target.snapshot");
  const targetBlocks =
    snapshot === undefined ? blocks : snapshots?.get(snapshot);
  if (targetBlocks === undefined) {
    throw new CommentRejected(
      "A comment points at a snapshot this review no longer retains",
    );
  }
  const block = resolveBlock({ value: target.blockId, blocks: targetBlocks });
  // Kind, label, and slide scope come back from the block map rather than from
  // the request, so the label a tray showed can never become the label an agent
  // reads, and no request can claim to address a slide it does not name.
  const identity = {
    blockId: block.id,
    ...(snapshot === undefined ? {} : { snapshot }),
    label: block.label,
    ...(block.section === undefined ? {} : { section: block.section }),
    ...slideScopeOf(block),
  };
  if (type === "block") {
    return { type: "block", ...identity };
  }
  if (type === "selection" || type === "lines") {
    const start = asOffset({ value: target.start, field: "start" });
    const end = asOffset({ value: target.end, field: "end" });
    const endBlock =
      type === "selection" && target.endBlockId !== undefined
        ? resolveBlock({ value: target.endBlockId, blocks: targetBlocks })
        : undefined;
    const imageBlockIds =
      type === "selection" && Array.isArray(target.imageBlockIds)
        ? boundedImageBlockIds(target.imageBlockIds).map((value, index) => {
            const image = resolveBlock({
              value,
              blocks: targetBlocks,
            });
            if (image.kind !== "image") {
              throw new CommentRejected(
                `"imageBlockIds[${index}]" must name an image block`,
              );
            }
            return image.id;
          })
        : undefined;
    if ((endBlock === undefined || endBlock.id === block.id) && end < start) {
      throw new CommentRejected("A range must end at or after it starts");
    }
    return {
      type,
      ...identity,
      ...(endBlock === undefined || endBlock.id === block.id
        ? {}
        : { endBlockId: endBlock.id }),
      ...(imageBlockIds === undefined || imageBlockIds.length === 0
        ? {}
        : { imageBlockIds: [...new Set(imageBlockIds)] }),
      start,
      end,
      quote: asText({
        value: target.quote ?? "",
        field: "quote",
        limit: QUOTE_LIMIT,
      }),
      isQuoteExcerpt: target.isQuoteExcerpt === true,
    };
  }
  throw new CommentRejected(`Unsupported comment target "${String(type)}"`);
};

const asTargetText = ({
  value,
  field,
  limit,
}: {
  readonly value: unknown;
  readonly field: string;
  readonly limit: number;
}): string => {
  const result = asText({ value, field, limit });
  if (result.trim() === "") {
    throw new CommentRejected(`"${field}" cannot be empty`);
  }
  return result;
};

// Stored state is as untrusted as a request, so the sub-slide names come back
// through the same bounds they were minted under.
const asSlideSubHeadings = (value: unknown): ReadonlyArray<string> => {
  if (!Array.isArray(value)) {
    throw new CommentRejected('"slideSubHeadings" must be a list');
  }
  if (value.length > SLIDE_SUB_HEADING_LIMIT) {
    throw new CommentRejected(
      `"slideSubHeadings" holds more than ${SLIDE_SUB_HEADING_LIMIT} entries`,
    );
  }
  return value.map((heading) =>
    asTargetText({
      value: heading,
      field: "slideSubHeadings",
      limit: SLIDE_SUB_HEADING_TEXT_LIMIT,
    }),
  );
};

/** Validates the immutable target metadata recorded with a stored comment. */
const validateStoredTarget = (value: unknown): CommentTarget => {
  const target = asRecord({ value, field: "target" });
  if (target.type === "document") return { type: "document" };
  if (
    (target.type !== "block" &&
      target.type !== "selection" &&
      target.type !== "lines") ||
    typeof target.blockId !== "string" ||
    !BLOCK_ID.test(target.blockId)
  ) {
    throw new CommentRejected("A stored comment target is invalid");
  }
  const identity = {
    blockId: target.blockId,
    kind: asTargetText({ value: target.kind, field: "kind", limit: 100 }),
    label: asTargetText({ value: target.label, field: "label", limit: 300 }),
    ...(target.snapshot === undefined
      ? {}
      : { snapshot: asSnapshotDigest(target.snapshot, "snapshot") }),
    ...(target.section === undefined
      ? {}
      : {
          section: asTargetText({
            value: target.section,
            field: "section",
            limit: 300,
          }),
        }),
    // A stored slide comment keeps the slide it was accepted against, so a
    // revision that moved or renamed the slide cannot quietly narrow an
    // already-anchored note back down to its heading.
    ...(target.slideText === undefined
      ? {}
      : {
          slideText: asText({
            value: target.slideText,
            field: "slideText",
            limit: SLIDE_TEXT_LIMIT,
          }),
          isSlideTextExcerpt: target.isSlideTextExcerpt === true,
          ...(target.slideSubHeadings === undefined
            ? {}
            : {
                slideSubHeadings: asSlideSubHeadings(target.slideSubHeadings),
              }),
        }),
  };
  if (target.type === "block") return { type: "block", ...identity };
  const start = asOffset({ value: target.start, field: "start" });
  const end = asOffset({ value: target.end, field: "end" });
  const endBlockId =
    target.type === "selection" && target.endBlockId !== undefined
      ? target.endBlockId
      : undefined;
  const imageBlockIds =
    target.type === "selection" && Array.isArray(target.imageBlockIds)
      ? boundedImageBlockIds(target.imageBlockIds).map((value, index) => {
          if (typeof value !== "string" || !BLOCK_ID.test(value)) {
            throw new CommentRejected(
              `"imageBlockIds[${index}]" must name a valid block`,
            );
          }
          return value;
        })
      : undefined;
  // A malformed end block is a broken address, not a reversed range: saying so
  // is what lets a reader tell "this comment points nowhere" from "these two
  // offsets are the wrong way round".
  if (
    endBlockId !== undefined &&
    (typeof endBlockId !== "string" || !BLOCK_ID.test(endBlockId))
  ) {
    throw new CommentRejected("A stored comment target is invalid");
  }
  if (
    (endBlockId === undefined || endBlockId === target.blockId) &&
    end < start
  ) {
    throw new CommentRejected("A stored comment range is invalid");
  }
  return {
    type: target.type,
    ...identity,
    ...(endBlockId === undefined || endBlockId === target.blockId
      ? {}
      : { endBlockId }),
    ...(imageBlockIds === undefined || imageBlockIds.length === 0
      ? {}
      : { imageBlockIds: [...new Set(imageBlockIds)] }),
    start,
    end,
    quote: asText({
      value: target.quote ?? "",
      field: "quote",
      limit: QUOTE_LIMIT,
    }),
    isQuoteExcerpt: target.isQuoteExcerpt === true,
  };
};

/** Recognizes a complete stored target without requiring its block to exist. */
export const isStoredCommentTarget = (
  value: unknown,
): value is CommentTarget => {
  try {
    validateStoredTarget(value);
    const target = asRecord({ value, field: "target" });
    if (target.type === "document" || target.type === "block") return true;
    if (
      typeof target.quote !== "string" ||
      typeof target.isQuoteExcerpt !== "boolean"
    ) {
      return false;
    }
    return (
      target.type !== "selection" ||
      target.imageBlockIds === undefined ||
      (Array.isArray(target.imageBlockIds) &&
        target.imageBlockIds.every((id) => typeof id === "string"))
    );
  } catch {
    return false;
  }
};

/** Validates one bounded batch through selected target and timestamp policies. */
const validateCommentList = ({
  value,
  now,
  targetFor,
  createdAtFor,
  premiseSnapshotFor,
  limit,
}: {
  readonly value: unknown;
  readonly now: string;
  readonly targetFor: (
    comment: Readonly<Record<string, unknown>>,
    id: string,
  ) => CommentTarget;
  readonly createdAtFor?: (
    comment: Readonly<Record<string, unknown>>,
    id: string,
  ) => string;
  readonly premiseSnapshotFor?: (
    comment: Readonly<Record<string, unknown>>,
    id: string,
  ) => string;
  readonly limit?: number;
}): ReadonlyArray<ReviewComment> => {
  if (!Array.isArray(value)) {
    throw new CommentRejected("Comments must arrive as a list");
  }
  if (limit !== undefined && value.length > limit) {
    throw new CommentRejected(`More than ${limit} comments in one batch`);
  }
  const comments = value.map((entry) => {
    const comment = asRecord({ value: entry, field: "comment" });
    const id = asId(comment.id);
    const body = asText({
      value: comment.body,
      field: "body",
      limit: BODY_LIMIT,
    }).trim();
    if (body === "") {
      throw new CommentRejected("A comment cannot be empty");
    }
    return {
      id,
      body,
      createdAt:
        createdAtFor?.(comment, id) ?? asTimestamp(comment.createdAt, now),
      premiseSnapshot:
        premiseSnapshotFor?.(comment, id) ??
        asSnapshotDigest(comment.premiseSnapshot),
      target: targetFor(comment, id),
      ...(typeof comment.aboutBlockId === "string" &&
      comment.aboutBlockId !== ""
        ? { aboutBlockId: comment.aboutBlockId }
        : {}),
    };
  });
  if (new Set(comments.map((comment) => comment.id)).size !== comments.length) {
    throw new CommentRejected("Comment ids must be unique");
  }
  return comments;
};

/**
 * Validates one batch of comments from the document into the shape the rest of
 * the runtime may hold. Rejects the whole batch on the first problem: a
 * partially accepted submit would leave the reviewer unsure what the agent got.
 */
export const validateComments = ({
  value,
  blocks,
  snapshots,
  now,
}: {
  readonly value: unknown;
  readonly blocks: ReadonlyMap<string, BlockMapEntry>;
  readonly snapshots?: ReadonlyMap<string, ReadonlyMap<string, BlockMapEntry>>;
  readonly now: string;
}): ReadonlyArray<ReviewComment> =>
  validateCommentList({
    value,
    now,
    limit: COMMENT_LIMIT,
    targetFor: (comment) =>
      validateTarget({
        value: comment.target,
        blocks,
        snapshots,
      }),
  });

/** Re-checks stored comments without requiring their targets to remain rendered. */
export const validateStoredComments = ({
  value,
  now,
  fallbackPremiseSnapshot,
}: {
  readonly value: unknown;
  readonly now: string;
  readonly fallbackPremiseSnapshot?: string;
}): ReadonlyArray<ReviewComment> =>
  validateCommentList({
    value,
    now,
    targetFor: (comment) => validateStoredTarget(comment.target),
    premiseSnapshotFor: (comment) =>
      asSnapshotDigest(
        comment.premiseSnapshot ??
          comment.sourceRevision ??
          fallbackPremiseSnapshot,
      ),
  });

/** Validates draft edits while preserving targets already accepted by the runtime. */
export const validateCommentUpdates = ({
  value,
  blocks,
  snapshots,
  existing,
  now,
}: {
  readonly value: unknown;
  readonly blocks: ReadonlyMap<string, BlockMapEntry>;
  readonly snapshots?: ReadonlyMap<string, ReadonlyMap<string, BlockMapEntry>>;
  readonly existing: ReadonlyArray<ReviewComment>;
  readonly now: string;
}): ReadonlyArray<ReviewComment> => {
  const existingById = new Map(
    existing.map((comment) => [comment.id, comment]),
  );
  return validateCommentList({
    value,
    now,
    limit: COMMENT_LIMIT,
    targetFor: (comment, id) =>
      existingById.get(id)?.target ??
      validateTarget({
        value: comment.target,
        blocks,
        snapshots,
      }),
    createdAtFor: (comment, id) =>
      existingById.get(id)?.createdAt ?? asTimestamp(comment.createdAt, now),
    premiseSnapshotFor: (comment, id) =>
      existingById.get(id)?.premiseSnapshot ??
      asSnapshotDigest(comment.premiseSnapshot ?? comment.sourceRevision),
  });
};
