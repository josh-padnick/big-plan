// Declares Slide's component integration contract: a typed outline marker
// whose visual presentation is absorbed by document-wide slide framing.

import { defineOutlineComponent } from "../_registration/define-component.js";
import { compileSlideComponent } from "./compile.js";
import { Slide } from "./view.js";

/** Declares Slide's typed-boundary integration contract. */
export const SLIDE_COMPONENT_DEFINITION = defineOutlineComponent({
  compile: compileSlideComponent,
  view: Slide,
  marker: (model) =>
    model.type === undefined
      ? { kind: "boundary" }
      : { kind: "slide", type: model.type },
});
