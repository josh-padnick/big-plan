// Compiles Slide's authored form into the registered type identity consumed
// by the document-wide deck transform and machine section model.

import { meaningfulChildren } from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
} from "../_authoring/contract.js";
import {
  isSlideTypeId,
  SLIDE_TYPE_IDS,
  type SlideTypeId,
} from "../../plan-vocabulary/slide-types/index.js";

export type CompiledSlide = {
  readonly type?: SlideTypeId;
};

const SLIDE_SCHEMA = {
  type: { kind: "enum", values: SLIDE_TYPE_IDS, required: true },
} satisfies ComponentAttributeSchema;

/** Compiles one self-closing Slide marker into its registered type. */
export const compileSlideComponent = ({
  attributes,
  children,
  position,
  diagnostics,
}: ComponentCompilerInput): CompiledSlide => {
  const validated = validateComponentAttributes({
    component: "Slide",
    attributes,
    position,
    diagnostics,
    schema: SLIDE_SCHEMA,
  });
  if (meaningfulChildren(children).length > 0) {
    diagnostics.add({
      message:
        'Slide is a self-closing marker above an h2; write <Slide type="..." /> with no body content',
      position,
    });
  }
  return {
    ...(validated.type !== undefined && isSlideTypeId(validated.type)
      ? { type: validated.type }
      : {}),
  };
};
