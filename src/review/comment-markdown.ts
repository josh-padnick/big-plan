// Parses the small, deliberately safe Markdown vocabulary used by reviewer
// comments. The browser view maps these plain tokens to React elements, so
// authored HTML is always text and never crosses an innerHTML boundary.

export type CommentMarkdownToken =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "code"; readonly value: string }
  | { readonly type: "strong"; readonly value: string }
  | { readonly type: "emphasis"; readonly value: string };

const INLINE_MARKDOWN =
  /(`+)([^`\n]+?)\1|\*\*([^*\n]+?)\*\*|_([^_\n]+?)_|\*([^*\n]+?)\*/gu;

/** Parses code spans and the two basic emphasis forms without accepting HTML. */
export const parseCommentMarkdownLine = (
  source: string,
): ReadonlyArray<CommentMarkdownToken> => {
  const tokens: Array<CommentMarkdownToken> = [];
  let cursor = 0;
  for (const match of source.matchAll(INLINE_MARKDOWN)) {
    const index = match.index;
    if (index > cursor) {
      tokens.push({ type: "text", value: source.slice(cursor, index) });
    }
    if (match[2] !== undefined) {
      tokens.push({ type: "code", value: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: "strong", value: match[3] });
    } else {
      tokens.push({ type: "emphasis", value: match[4] ?? match[5] ?? "" });
    }
    cursor = index + match[0].length;
  }
  if (cursor < source.length) {
    tokens.push({ type: "text", value: source.slice(cursor) });
  }
  return tokens;
};
