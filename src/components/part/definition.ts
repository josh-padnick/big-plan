// Declares Part's component integration contract; rendering lives in the
// React component library.

import { compilePartComponent } from "./compile.js";
import { Part } from "./view.js";
import { defineOutlineComponent } from "../_registration/define-component.js";
import { partMarkdown } from "./markdown.js";

/** Declares Part's complete component integration contract. */
export const PART_COMPONENT_DEFINITION = defineOutlineComponent({
  compile: compilePartComponent,
  view: Part,
  markdown: partMarkdown,
  // A Part divider starts a new act, so it joins the outline with its title
  // and anchor and breaks the slide the transform is building.
  marker: (model) => ({
    kind: "part",
    title: model.title,
    ...(model.id === undefined ? {} : { id: model.id }),
  }),
});
