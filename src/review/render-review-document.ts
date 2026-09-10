// Owns event-loop-safe document rendering inside the live review runtime.

import {
  renderDocument,
  warmMarkdownRenderCache,
} from "../render/render-document.js";

type RenderDocumentInput = Parameters<typeof renderDocument>[0];
type RenderDocumentOutput = ReturnType<typeof renderDocument>;

export const renderReviewDocument = async (
  input: RenderDocumentInput,
): Promise<RenderDocumentOutput> => {
  await warmMarkdownRenderCache({ markdown: input.markdown });
  return renderDocument(input);
};
