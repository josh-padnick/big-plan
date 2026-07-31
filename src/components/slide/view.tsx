// Provides Slide's defensive presentation edge. Valid markers are consumed by
// the deck transform before presentation completion and never emit HTML.

import type { CompiledSlide } from "./compile.js";

export const Slide = ({ model: _model }: { readonly model: CompiledSlide }) => (
  <div data-slide-marker="" hidden />
);
