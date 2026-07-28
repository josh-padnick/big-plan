// Declares GraphqlOperation's component integration contract and its scoped
// child grammar; rendering lives in the React component library.

import { type ScopedChildDefinition } from "../_authoring/contract.js";
import { compileGraphqlOperationComponent } from "./compile.js";
import { GraphqlOperation } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";

// Uses per-child message text while keeping one declarative body policy shape.
const scopedChild = (
  name:
    "Argument" | "Field" | "Returns" | "Operation" | "Variables" | "Response",
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

/** Declares GraphqlOperation's renderer and direct-child contract blocks. */
export const GRAPHQL_OPERATION_COMPONENT_DEFINITION = defineComponent({
  compile: compileGraphqlOperationComponent,
  view: GraphqlOperation,
  scopedChildren: {
    Argument: scopedChild("Argument"),
    Field: scopedChild("Field"),
    Returns: scopedChild("Returns"),
    Operation: scopedChild("Operation"),
    Variables: scopedChild("Variables"),
    Response: scopedChild("Response"),
  },
});
