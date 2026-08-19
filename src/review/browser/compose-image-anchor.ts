// Owns the stable insertion point a reviewer image batch carries through live
// composer edits.

export type ComposerInsertionAnchor = {
  readonly body: string;
  readonly offset: number;
};

/** Rebases a right-gravity insertion point through one textarea value change. */
export const rebaseComposerInsertion = ({
  anchor,
  body,
}: {
  readonly anchor: ComposerInsertionAnchor;
  readonly body: string;
}): ComposerInsertionAnchor => {
  if (anchor.body === body) return anchor;
  const boundedOffset = Math.min(anchor.offset, anchor.body.length);
  let prefixLength = 0;
  while (
    prefixLength < anchor.body.length &&
    prefixLength < body.length &&
    anchor.body[prefixLength] === body[prefixLength]
  ) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < anchor.body.length - prefixLength &&
    suffixLength < body.length - prefixLength &&
    anchor.body[anchor.body.length - suffixLength - 1] ===
      body[body.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }
  const replacedEnd = anchor.body.length - suffixLength;
  const insertedEnd = body.length - suffixLength;
  const offset =
    boundedOffset < prefixLength
      ? boundedOffset
      : boundedOffset > replacedEnd
        ? boundedOffset + body.length - anchor.body.length
        : insertedEnd;
  return { body, offset };
};

/** Inserts one completed upload and advances the batch point past it. */
export const insertAtComposerAnchor = ({
  anchor,
  reference,
}: {
  readonly anchor: ComposerInsertionAnchor;
  readonly reference: string;
}): ComposerInsertionAnchor => {
  const offset = Math.min(anchor.offset, anchor.body.length);
  return {
    body: `${anchor.body.slice(0, offset)}${reference}${anchor.body.slice(offset)}`,
    offset: offset + reference.length,
  };
};
