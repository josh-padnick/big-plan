// Declares Slide's component integration contract: a typed outline marker
// whose visual presentation is absorbed by document-wide slide framing.

import { defineOutlineComponent } from "../_registration/define-component.js";
import { compileSlideComponent } from "./compile.js";
import { Slide } from "./view.js";
import { slideMarkdown } from "./markdown.js";

/** Declares Slide's typed-boundary integration contract. */
export const SLIDE_COMPONENT_DEFINITION = defineOutlineComponent({
  compile: compileSlideComponent,
  view: Slide,
  markdown: slideMarkdown,
  topLevelOnly:
    "Slide must be a top-level self-closing marker immediately followed by the h2 or h3 it describes",
  marker: (model) =>
    model.type === undefined
      ? { kind: "boundary" }
      : {
          kind: "slide",
          type: model.type,
          ...(model.name === undefined ? {} : { name: model.name }),
          ...(model.toc === undefined ? {} : { toc: model.toc }),
        },
});
