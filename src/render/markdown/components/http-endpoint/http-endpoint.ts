// Declares HttpEndpoint's component integration contract and its scoped
// child grammar; rendering lives in the React component library.

import { type ScopedChildDefinition } from "../../../../model/component-contract.js";
import { compileHttpEndpointComponent } from "../../../../model/compile-http-endpoint.js";
import { HttpEndpoint } from "../../../../ui/http-endpoint/http-endpoint.js";
import { defineComponent } from "../define-component.js";

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
export const HTTP_ENDPOINT_COMPONENT_DEFINITION = defineComponent({
  compile: compileHttpEndpointComponent,
  view: HttpEndpoint,
  scopedChildren: {
    Param: scopedChild("Param"),
    Request: scopedChild("Request"),
    Response: scopedChild("Response"),
  },
});
