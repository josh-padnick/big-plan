// Declares GrpcMethod's component integration contract and its scoped child
// grammar; rendering lives in the React component library.

import { type ScopedChildDefinition } from "../_authoring/contract.js";
import { compileGrpcMethodComponent } from "./compile.js";
import { GrpcMethod } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";
import { grpcMethodMarkdown } from "./markdown.js";

// Uses per-child message text while keeping one declarative body policy shape.
const scopedChild = (
  name: "Field" | "Error" | "Example" | "Proto",
): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: {
    prohibited: {
      heading: `${name} bodies cannot contain headings`,
      footnoteReference: `${name} bodies cannot contain footnote references`,
      footnoteDefinition: `${name} bodies cannot contain footnote definitions`,
      registeredComponent: `${name} bodies cannot contain typed components`,
    },
  },
});

/** Declares GrpcMethod's renderer and direct-child contract blocks. */
export const GRPC_METHOD_COMPONENT_DEFINITION = defineComponent({
  compile: compileGrpcMethodComponent,
  view: GrpcMethod,
  markdown: grpcMethodMarkdown,
  scopedChildren: {
    Field: scopedChild("Field"),
    Error: scopedChild("Error"),
    Example: scopedChild("Example"),
    Proto: scopedChild("Proto"),
  },
});
