// Compiles Part's authored form into its plan model: the act title of one
// self-closing divider marker. Part numbers are a document-order concern the
// renderer assigns, so the model carries only what the author declared.

import { meaningfulChildren } from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
} from "../_authoring/contract.js";

export type CompiledPart = {
  readonly title: string;
  readonly id?: string;
};

const PART_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

/** Compiles one Part component into the model consumed by rendering. */
export const compilePartComponent = ({
  attributes,
  children,
  position,
  diagnostics,
  ids,
}: ComponentCompilerInput): CompiledPart => {
  const validated = validateComponentAttributes({
    component: "Part",
    attributes,
    position,
    diagnostics,
    schema: PART_SCHEMA,
  });
  if (meaningfulChildren(children).length > 0) {
    diagnostics.add({
      message:
        'Part is a self-closing divider between sections; write <Part title="..." /> with no body content',
      position,
    });
  }
  // The divider is a navigation target: the TOC's part headers link to it.
  const id = ids?.allocate({
    prefix: "part",
    label: validated.title ?? "",
    fallbackId: "part",
  });
  return {
    title: validated.title ?? "",
    ...(id === undefined ? {} : { id }),
  };
};
