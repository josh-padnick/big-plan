// Owns the document outline: the deck's document-order numbering of parts
// and sections. The renderer's deck transform computes one outline per
// document, and outline-aware component views consume it to render their
// complete markup, so no transform needs to know any component's markup.

import type { SlideTypeId } from "../../../plan-vocabulary/slide-types/index.js";

/** One Part divider: its document-order number, act title, and anchor. */
export type DocumentOutlinePart = {
  readonly number: number;
  readonly title: string;
  readonly id?: string;
};

/** One top-level section slide in document order. */
export type DocumentOutlineSection = {
  // The slide number in reading form: "3" alone, "1.2" inside a part.
  readonly number: string;
  readonly name: string;
  readonly title: string;
  readonly id: string;
  readonly type?: SlideTypeId;
  readonly part?: DocumentOutlinePart;
};

export type DocumentOutline = {
  readonly parts: ReadonlyArray<DocumentOutlinePart>;
  readonly sections: ReadonlyArray<DocumentOutlineSection>;
};

// The outline a view receives when no completed document surrounds it, such
// as model materialization; outline-fed slots render empty against it.
export const EMPTY_DOCUMENT_OUTLINE: DocumentOutline = {
  parts: [],
  sections: [],
};
