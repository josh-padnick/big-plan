// Defines the Acceptance criteria slide type and its guidance for a final,
// independently checkable verification contract.

import type { SlideTypeDefinition } from "../types.js";

export const ACCEPTANCE_CRITERIA_SLIDE_TYPE = {
  id: "acceptance-criteria",
  name: "Acceptance criteria",
  match: {
    when: "The slide is the checkable contract proving the proposed work is complete.",
    notWhen:
      "Do not use it for aspirations, desired outcomes, implementation tasks, or a restatement of the proposal.",
  },
  cardinality: "one",
  placement: "last-typed",
  guidance: [
    "Make every criterion independently verifiable by naming an observable behavior, artifact, or boundary condition.",
    "Cover the promised experience and the important failure or degenerate cases, not only the happy path.",
    "Describe evidence of completion rather than implementation steps; a reviewer should be able to verify a criterion without inferring intent.",
  ],
  components: [
    {
      name: "CodeDiff",
      guidance:
        "Use when an exact code-shape change is itself part of the contract the reviewer must verify.",
    },
    {
      name: "DatabaseTableSchema",
      guidance:
        "Use when the persisted schema is an explicit delivered contract rather than an implementation detail.",
    },
    {
      name: "HttpEndpoint",
      guidance:
        "Use when request and response behavior form a checkable API acceptance boundary.",
    },
  ],
} satisfies SlideTypeDefinition;
