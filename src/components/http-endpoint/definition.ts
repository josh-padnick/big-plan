// Declares HttpEndpoint's component integration contract and its scoped
// child grammar; rendering lives in the React component library.

import { type ScopedChildDefinition } from "../_authoring/contract.js";
import { compileHttpEndpointComponent } from "./compile.js";
import { HttpEndpoint } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";
import { httpEndpointMarkdown } from "./markdown.js";

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
  markdown: httpEndpointMarkdown,
  scopedChildren: {
    Param: scopedChild("Param"),
    Request: scopedChild("Request"),
    Response: scopedChild("Response"),
  },
});
