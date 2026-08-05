// Defines the Desired outcome slide type and its guidance for stating the
// concrete payoff of non-feature work without collapsing it into completion
// criteria or implementation detail.

import type { SlideTypeDefinition } from "../types.js";

export const DESIRED_OUTCOME_SLIDE_TYPE = {
  id: "desired-outcome",
  name: "Desired outcome",
  match: {
    when: "The plan fixes a bug, changes architecture, or pays down tech debt and the slide states the concrete result the work should produce.",
    notWhen:
      "Do not use it for a new feature's lived user experience or for the checkable verification contract at the end of the plan.",
  },
  cardinality: "one",
  placement: "anywhere",
  guidance: [
    "State the operational or architectural result a sponsor would repeat, not the files, abstractions, or migrations used to reach it.",
    "Name the constraint removed or capability restored, and make the before-and-after difference concrete.",
    "Keep it distinct from Acceptance criteria: this slide explains why the work matters; the later contract proves when it is done.",
  ],
  components: [
    {
      name: "FileTreeDiff",
      guidance:
        "Use only when the ownership change is itself the outcome reviewers must understand, not as a substitute for naming the payoff.",
    },
    {
      name: "Callout",
      guidance:
        "Make one architectural invariant or non-negotiable outcome impossible to miss.",
    },
  ],
} satisfies SlideTypeDefinition;
