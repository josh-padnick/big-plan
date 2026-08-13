// Defines the User journeys catalog type and its guidance for a named
// container whose repeated entries each carry one complete human loop.

import type { SlideTypeDefinition } from "../types.js";

export const USER_JOURNEY_SLIDE_TYPE = {
  id: "user-journey",
  name: "User journeys",
  match: {
    when: "The slide follows one person through one complete goal, including the response, recovery, or decision that closes the loop.",
    notWhen:
      "Do not use it for a service pipeline, architecture sequence, isolated screen inventory, or a bundle of unrelated journeys.",
  },
  cardinality: "many",
  guidance: [
    "Name the container “User journeys” and nest every journey underneath it: make the container a `Part` so each journey is a typed slide inside it, because a `Slide` marker attaches only to an h2 and a typed journey authored beside an untyped container slide renders as its sibling instead of its child.",
    "Use an untyped “User journeys” slide as the container only when each journey fits an h3 sub-slide of it; a sub-slide carries no marker, so it forfeits the journey name, table-of-contents form, and wireframe contract.",
    "Give every journey marker a distinct `name` for its kicker and sidebar plus an ultra-concise `toc` form for the overview; let the h2 carry the full plain-language claim.",
    "Treat a Wireframe with actual Screen mockups as the default on every journey slide so the reviewer sees the interface states and moves through the same shortest path as the user; when no UI exists to show, add a non-empty `wireframeReason` attribute that explains why, and never leave the omission silent.",
    "Keep one complete human loop per typed slide and repeat the type for several journeys inside the container Part.",
    "Include unhappy-path recovery when it is part of completing the goal, and keep system mechanics subordinate to the person's actions.",
  ],
  components: [
    {
      name: "Wireframe",
      guidance:
        "Default: draw the shortest CLEAR-compliant sequence of Screen mockups that proves the human loop, including visible state changes and recovery when it matters. If no UI exists to show, opt out with a non-empty `wireframeReason` attribute on the Slide marker.",
    },
    {
      name: "Callout",
      guidance:
        "Surface the decision, exception, or recovery moment a reviewer should inspect most closely.",
    },
  ],
} satisfies SlideTypeDefinition;
