// Defines the Desired experience slide type and its guidance for expressing a
// new feature through the concrete human experience it creates.

import type { SlideTypeDefinition } from "./types.js";

export const DESIRED_EXPERIENCE_SLIDE_TYPE: SlideTypeDefinition = {
  id: "desired-experience",
  name: "Desired experience",
  match: {
    when: "The plan adds a feature and the slide describes the concrete change in a user's or reviewer's lived experience.",
    notWhen:
      "Do not use it for a bug fix, re-architecture, or tech-debt payoff; use Desired outcome when no new user experience is being introduced.",
  },
  cardinality: "one",
  placement: "anywhere",
  guidance: [
    "Write from the human's point of view and name what they can see, do, understand, or recover from after the change.",
    "Prefer first-person outcomes when they make the experience tangible, but keep the title in plain language rather than turning it into a slogan.",
    "Separate the experience from the implementation; queues, schemas, and modules belong in later design slides.",
  ],
  components: [
    {
      name: "FlowDiagram",
      guidance:
        "Use a human-centered flow when relationships between actions materially clarify the experience; never substitute a system pipeline.",
    },
    {
      name: "Callout",
      guidance:
        "Surface one non-negotiable experience constraint that the rest of the proposal must preserve.",
    },
  ],
};
