// Declares HttpEndpoint's component integration contract and its scoped
// child grammar; rendering lives in the React component library.

import {
  type ComponentDefinition,
  type ScopedChildDefinition,
} from "../../../../model/component-contract.js";
import { compileHttpEndpointComponent } from "../../../../model/compile-http-endpoint.js";
import { renderHttpEndpointStatic } from "../../../../ui/http-endpoint/http-endpoint.js";

// Uses per-child message text while keeping one declarative body policy shape.
const scopedChild = (
  name: "Param" | "Request" | "Response",
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

/** Declares HttpEndpoint's renderer and direct-child API contract blocks. */
export const HTTP_ENDPOINT_COMPONENT_DEFINITION = {
  compile: compileHttpEndpointComponent,
  renderStatic: (input) =>
    renderHttpEndpointStatic(compileHttpEndpointComponent(input)),
  scopedChildren: {
    Param: scopedChild("Param"),
    Request: scopedChild("Request"),
    Response: scopedChild("Response"),
  },
} satisfies ComponentDefinition;
