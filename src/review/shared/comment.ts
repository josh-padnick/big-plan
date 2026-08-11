// Owns what a comment is allowed to be. Everything arriving from the document
// is untrusted - the reviewer typed it, or a plan author wrote the text it
// quotes - so nothing crosses this module without being checked into a shape
// the rest of the runtime can hold safely.
//
// The one rule that matters most: a target names a block only by an id the
// renderer minted for this document, checked against the block map rather than
// pattern-matched. A target can therefore never become a filesystem path, a
// URL, or anything else with reach.

/** Where one comment points. */
export type CommentTarget =
  | { readonly type: "document" }
  | {
      readonly type: "block";
      readonly blockId: string;
      readonly kind: string;
      readonly label: string;
      readonly section?: string;
    }
  | {
      readonly type: "selection";
      readonly blockId: string;
      readonly endBlockId?: string;
      readonly kind: string;
      readonly label: string;
      readonly section?: string;
      readonly start: number;
      readonly end: number;
      readonly quote: string;
    }
  | {
      readonly type: "lines";
      readonly blockId: string;
      readonly kind: string;
      readonly label: string;
      readonly section?: string;
      readonly start: number;
      readonly end: number;
      readonly quote: string;
    };

/** One reviewer note, after validation. */
export type ReviewComment = {
  readonly id: string;
  readonly body: string;
  readonly createdAt: string;
  readonly target: CommentTarget;
};

/** What the renderer knows about the blocks a comment may point at. */
export type BlockMapEntry = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly section?: string;
};

export class CommentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentRejected";
  }
}

// Bounds exist so one submit cannot fill the disk or produce a brief no agent
// can read; they are limits, not sanitization.
const BODY_LIMIT = 4000;
export const QUOTE_LIMIT = 400;
const ID_LIMIT = 64;
const COMMENT_LIMIT = 200;
const BLOCK_ID = /^[a-z0-9][a-z0-9/_.-]{0,299}$/;

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

/**
 * Validates the in-progress whole-plan field without requiring it to be
 * non-empty. Unlike a saved comment, this is reviewer-owned scratch text:
 * preserving its exact whitespace is part of restoring an interrupted edit.
 */
export const validateActiveDraft = (value: unknown): string =>
  asText({
    value: value ?? "",
    field: "activeDraft",
    limit: BODY_LIMIT,
  });

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
}: {
  readonly value: unknown;
  readonly blocks: ReadonlyMap<string, BlockMapEntry>;
}): CommentTarget => {
  const target = asRecord({ value, field: "target" });
  const type = target.type;
  if (type === "document") {
    return { type: "document" };
  }
  const block = resolveBlock({ value: target.blockId, blocks });
  // Kind and label come back from the block map rather than from the request,
  // so the label a tray showed can never become the label an agent reads.
  const identity = {
    blockId: block.id,
    kind: block.kind,
    label: block.label,
    ...(block.section === undefined ? {} : { section: block.section }),
  };
  if (type === "block") {
    return { type: "block", ...identity };
  }
  if (type === "selection" || type === "lines") {
    const start = asOffset({ value: target.start, field: "start" });
    const end = asOffset({ value: target.end, field: "end" });
    const endBlock =
      type === "selection" && target.endBlockId !== undefined
        ? resolveBlock({ value: target.endBlockId, blocks })
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
      start,
      end,
      quote: asText({
        value: target.quote ?? "",
        field: "quote",
        limit: QUOTE_LIMIT,
      }),
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
    ...(target.section === undefined
      ? {}
      : {
          section: asTargetText({
            value: target.section,
            field: "section",
            limit: 300,
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
  if (
    ((endBlockId === undefined || endBlockId === target.blockId) &&
      end < start) ||
    (endBlockId !== undefined &&
      (typeof endBlockId !== "string" || !BLOCK_ID.test(endBlockId)))
  ) {
    throw new CommentRejected("A stored comment range is invalid");
  }
  return {
    type: target.type,
    ...identity,
    ...(endBlockId === undefined || endBlockId === target.blockId
      ? {}
      : { endBlockId }),
    start,
    end,
    quote: asText({
      value: target.quote ?? "",
      field: "quote",
      limit: QUOTE_LIMIT,
    }),
  };
};

/** Validates one bounded batch through selected target and timestamp policies. */
const validateCommentList = ({
  value,
  now,
  targetFor,
  createdAtFor,
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
      target: targetFor(comment, id),
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
  now,
}: {
  readonly value: unknown;
  readonly blocks: ReadonlyMap<string, BlockMapEntry>;
  readonly now: string;
}): ReadonlyArray<ReviewComment> =>
  validateCommentList({
    value,
    now,
    limit: COMMENT_LIMIT,
    targetFor: (comment) => validateTarget({ value: comment.target, blocks }),
  });

/** Re-checks stored comments without requiring their targets to remain rendered. */
export const validateStoredComments = ({
  value,
  now,
}: {
  readonly value: unknown;
  readonly now: string;
}): ReadonlyArray<ReviewComment> =>
  validateCommentList({
    value,
    now,
    targetFor: (comment) => validateStoredTarget(comment.target),
  });

/** Validates draft edits while preserving targets already accepted by the runtime. */
export const validateCommentUpdates = ({
  value,
  blocks,
  existing,
  now,
}: {
  readonly value: unknown;
  readonly blocks: ReadonlyMap<string, BlockMapEntry>;
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
      validateTarget({ value: comment.target, blocks }),
    createdAtFor: (comment, id) =>
      existingById.get(id)?.createdAt ?? asTimestamp(comment.createdAt, now),
  });
};
