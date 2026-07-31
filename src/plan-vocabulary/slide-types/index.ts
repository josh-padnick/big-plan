// Assembles the ordered, closed slide-type catalog and exposes its stable
// lookup helpers to compilation, rendering, lint, guidance generation, and
// catalog tests.

import { ACCEPTANCE_CRITERIA_SLIDE_TYPE } from "./acceptance-criteria.js";
import { DESIRED_EXPERIENCE_SLIDE_TYPE } from "./desired-experience.js";
import { DESIRED_OUTCOME_SLIDE_TYPE } from "./desired-outcome.js";
import { STATUS_QUO_SLIDE_TYPE } from "./status-quo.js";
import type { SlideTypeDefinition, SlideTypeId } from "./types.js";
import { USER_JOURNEY_SLIDE_TYPE } from "./user-journey.js";

export type {
  SlideTypeCardinality,
  SlideTypeComponentPairing,
  SlideTypeDefinition,
  SlideTypeId,
  SlideTypePlacement,
} from "./types.js";

export const SLIDE_TYPE_BY_ID: Readonly<
  Record<SlideTypeId, SlideTypeDefinition>
> = {
  "status-quo": STATUS_QUO_SLIDE_TYPE,
  "desired-experience": DESIRED_EXPERIENCE_SLIDE_TYPE,
  "desired-outcome": DESIRED_OUTCOME_SLIDE_TYPE,
  "user-journey": USER_JOURNEY_SLIDE_TYPE,
  "acceptance-criteria": ACCEPTANCE_CRITERIA_SLIDE_TYPE,
};

export const SLIDE_TYPES: ReadonlyArray<SlideTypeDefinition> = [
  STATUS_QUO_SLIDE_TYPE,
  DESIRED_EXPERIENCE_SLIDE_TYPE,
  DESIRED_OUTCOME_SLIDE_TYPE,
  USER_JOURNEY_SLIDE_TYPE,
  ACCEPTANCE_CRITERIA_SLIDE_TYPE,
];

export const SLIDE_TYPE_IDS: ReadonlyArray<SlideTypeId> = SLIDE_TYPES.map(
  ({ id }) => id,
);

/** Reports whether a static component attribute names a registered type. */
export const isSlideTypeId = (value: string): value is SlideTypeId =>
  Object.hasOwn(SLIDE_TYPE_BY_ID, value);

/** Returns the one guidance-bearing definition for a registered type id. */
export const slideTypeFor = (id: SlideTypeId): SlideTypeDefinition =>
  SLIDE_TYPE_BY_ID[id];
