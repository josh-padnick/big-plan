// The one delivery-wide contract that says which authored component produced
// a rendered root. Document-wide passes that must name what a reader is
// pointing at - block identity today - read this attribute instead of learning
// any component's private markup.

export const COMPONENT_NAME_ATTRIBUTE = "data-component";
