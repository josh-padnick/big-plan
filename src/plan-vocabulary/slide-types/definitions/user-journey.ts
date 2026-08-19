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
    "Name the container “User journeys” as a `Part` and nest every journey underneath it; a typed journey authored beside its container renders as its sibling instead of its child.",
    "Count the actors to pick the shape. With two or more actors, group by actor: one untyped group slide per actor inside the container Part, titled for that actor, with each of their journeys a sub-slide of it, so 2.2 “Merchant journeys” holds 2.2.1 and 2.2.2 and a reviewer who owns one actor collapses the rest. With a single actor, keep the journeys flat as typed slides directly inside the Part, because grouping one actor adds a level that only repeats its owner.",
    "Mark the heading the journey actually owns: the marker sits above the h3 in a grouped shape and above the h2 in a flat one. Either way it carries the journey's identity, and the heading beneath it states this plan's claim as the title.",
    "Give every journey marker a distinct `name` for its kicker and sidebar plus an ultra-concise `toc` form for the overview; let the heading beneath the marker carry the full plain-language claim.",
    'Open the container with a user-summaries overview slide in the standard convention: a lead line counting the actors ("The user journeys cover three actors:"), one bullet per actor carrying only its bold name, one sub-bullet per journey written as a link whose text is the journey\'s bold slide number followed by its action phrase and whose target is the slug of the heading that owns that journey, and a closing line opening "Together, they show"; the sub-bullets carry the count, so never label an actor with one, and title the slide with its claim rather than restating the container name.',
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
