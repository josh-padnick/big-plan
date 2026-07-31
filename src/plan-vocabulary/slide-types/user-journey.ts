// Defines the User journey slide type and its guidance for one complete human
// loop, with repeated singular slides forming the plan's journey group.

import type { SlideTypeDefinition } from "./types.js";

export const USER_JOURNEY_SLIDE_TYPE: SlideTypeDefinition = {
  id: "user-journey",
  name: "User journey",
  match: {
    when: "The slide follows one person through one complete goal, including the response, recovery, or decision that closes the loop.",
    notWhen:
      "Do not use it for a service pipeline, architecture sequence, isolated screen inventory, or a bundle of unrelated journeys.",
  },
  cardinality: "many",
  placement: "anywhere",
  guidance: [
    "Keep one complete human loop per slide; repeat the singular type for several journeys rather than inventing a plural container type.",
    "Lead with real or proposed UI whenever the interface is the experience, then annotate what the person does and what changes for them.",
    "Include unhappy-path recovery when it is part of completing the goal, and keep system mechanics subordinate to the person's actions.",
  ],
  components: [
    {
      name: "FlowDiagram",
      guidance:
        "Use only for a genuinely relational human path, with stages named as actions and edges named as choices or responses.",
    },
    {
      name: "Callout",
      guidance:
        "Surface the decision, exception, or recovery moment a reviewer should inspect most closely.",
    },
  ],
};
