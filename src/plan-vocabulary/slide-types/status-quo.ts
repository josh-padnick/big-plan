// Defines the Status quo slide type and the guidance that distinguishes
// evidence about today's reality from diagnosis or proposed change.

import type { SlideTypeDefinition } from "./types.js";

export const STATUS_QUO_SLIDE_TYPE: SlideTypeDefinition = {
  id: "status-quo",
  name: "Status quo",
  match: {
    when: "The slide establishes what is true today, including what already works, before the proposal changes anything.",
    notWhen:
      "Do not use it for the root-cause diagnosis alone, a history lesson, or a disguised list of proposed changes.",
  },
  cardinality: "one",
  placement: "anywhere",
  guidance: [
    "Lead with observable evidence and user-visible consequences, then name the constraint the proposal must address.",
    "Include what already works so the plan preserves strengths instead of presenting the current system as uniformly broken.",
    "Keep causes distinct from symptoms; mark inference as inference when the evidence does not prove the cause.",
  ],
  components: [
    {
      name: "CodeSnippet",
      guidance:
        "Show the smallest existing code excerpt that makes a present constraint concrete.",
    },
    {
      name: "FileTree",
      guidance:
        "Show current ownership or placement when the tree itself explains the constraint.",
    },
  ],
};
