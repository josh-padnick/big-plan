// Defines the User journeys catalog type and its guidance for a named
// container whose repeated entries each carry one complete human loop.

import type { SlideTypeDefinition } from "./types.js";

export const USER_JOURNEY_SLIDE_TYPE: SlideTypeDefinition = {
  id: "user-journey",
  name: "User journeys",
  match: {
    when: "The slide follows one person through one complete goal, including the response, recovery, or decision that closes the loop.",
    notWhen:
      "Do not use it for a service pipeline, architecture sequence, isolated screen inventory, or a bundle of unrelated journeys.",
  },
  cardinality: "many",
  placement: "anywhere",
  guidance: [
    "Name the container “User journeys”; use either a Part or an untyped introductory slide according to the plan's argument, because the catalog does not mandate one container presentation.",
    "Give every journey marker a distinct `name` for its kicker and sidebar plus an ultra-concise `toc` form for the overview; let the h2 carry the full plain-language claim.",
    "Put a Wireframe with actual Screen mockups on every journey slide so the reviewer sees the interface states and moves through the same shortest path as the user; prose may explain the journey but never replace the mockups.",
    "Keep one complete human loop per typed slide and repeat the type for several journeys inside the container.",
    "Include unhappy-path recovery when it is part of completing the goal, and keep system mechanics subordinate to the person's actions.",
  ],
  components: [
    {
      name: "Wireframe",
      required: true,
      guidance:
        "Required on every journey slide. Draw the shortest CLEAR-compliant sequence of Screen mockups that proves the human loop, including visible state changes and recovery when it matters.",
    },
    {
      name: "Callout",
      guidance:
        "Surface the decision, exception, or recovery moment a reviewer should inspect most closely.",
    },
  ],
};
