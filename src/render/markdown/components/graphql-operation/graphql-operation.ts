// Declares GraphqlOperation's component integration contract and its scoped
// child grammar; rendering lives in the React component library.

import {
  type ComponentDefinition,
  type ScopedChildDefinition,
} from "../../../../model/component-contract.js";
import { compileGraphqlOperationComponent } from "../../../../model/compile-graphql-operation.js";
import { renderGraphqlOperationStatic } from "../../../../ui/graphql-operation/graphql-operation.js";

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
export const GRAPHQL_OPERATION_COMPONENT_DEFINITION = {
  compile: compileGraphqlOperationComponent,
  renderStatic: (input) =>
    renderGraphqlOperationStatic(compileGraphqlOperationComponent(input)),
  scopedChildren: {
    Argument: scopedChild("Argument"),
    Field: scopedChild("Field"),
    Returns: scopedChild("Returns"),
    Operation: scopedChild("Operation"),
    Variables: scopedChild("Variables"),
    Response: scopedChild("Response"),
  },
} satisfies ComponentDefinition;
