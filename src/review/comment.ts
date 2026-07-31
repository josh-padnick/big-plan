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
    }
  | {
      readonly type: "selection";
      readonly blockId: string;
      readonly kind: string;
      readonly label: string;
      readonly start: number;
      readonly end: number;
      readonly quote: string;
    }
  | {
      readonly type: "lines";
      readonly blockId: string;
      readonly kind: string;
      readonly label: string;
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
const QUOTE_LIMIT = 400;
const ID_LIMIT = 64;
const COMMENT_LIMIT = 200;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CommentRejected("A comment must be an object");
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

const asLineNumber = ({
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
  const target = asRecord(value);
  const type = target.type;
  if (type === "document") {
    return { type: "document" };
  }
  const block = resolveBlock({ value: target.blockId, blocks });
  // Kind and label come back from the block map rather than from the request,
  // so the label a tray showed can never become the label an agent reads.
  const identity = { blockId: block.id, kind: block.kind, label: block.label };
  if (type === "block") {
    return { type: "block", ...identity };
  }
  if (type === "selection" || type === "lines") {
    const start = asLineNumber({ value: target.start, field: "start" });
    const end = asLineNumber({ value: target.end, field: "end" });
    if (end < start) {
      throw new CommentRejected("A range must end at or after it starts");
    }
    return {
      type,
      ...identity,
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
}): ReadonlyArray<ReviewComment> => {
  if (!Array.isArray(value)) {
    throw new CommentRejected("Comments must arrive as a list");
  }
  if (value.length > COMMENT_LIMIT) {
    throw new CommentRejected(
      `More than ${COMMENT_LIMIT} comments in one batch`,
    );
  }
  return value.map((entry) => {
    const comment = asRecord(entry);
    const body = asText({
      value: comment.body,
      field: "body",
      limit: BODY_LIMIT,
    }).trim();
    if (body === "") {
      throw new CommentRejected("A comment cannot be empty");
    }
    return {
      id: asId(comment.id),
      body,
      createdAt: asTimestamp(comment.createdAt, now),
      target: validateTarget({ value: comment.target, blocks }),
    };
  });
};
