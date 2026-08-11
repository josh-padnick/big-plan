// Owns projection of comment threads into their server-rendered document hosts.
// Card rendering stays shared with the feedback rail; this module owns the
// portal boundary and the rule that missing hosts do not render orphan cards.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ReviewComment } from "../shared/comment.js";

export type InlineCommentsModel = {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly sent: ReadonlyArray<ReviewComment>;
  readonly hostFor: (commentId: string) => HTMLElement | undefined;
  readonly renderDraft: (comment: ReviewComment) => ReactNode;
  readonly renderSent: (comment: ReviewComment) => ReactNode;
};

export const InlineComments = ({
  model,
}: {
  readonly model: InlineCommentsModel;
}) => (
  <>
    {model.drafts.map((comment) => {
      const host = model.hostFor(comment.id);
      if (host === undefined) return null;
      return createPortal(model.renderDraft(comment), host, comment.id);
    })}
    {model.sent.map((comment) => {
      const host = model.hostFor(comment.id);
      if (host === undefined) return null;
      return createPortal(
        model.renderSent(comment),
        host,
        `sent-${comment.id}`,
      );
    })}
  </>
);
