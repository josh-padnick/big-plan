// Adapts the Decision-family anchor contract to keyboard-accessible React
// target properties; views never spell the review attributes independently.

import {
  DECISION_ANCHOR_ATTRIBUTE,
  DECISION_ELEMENT_ATTRIBUTE,
  DECISION_NAME_ATTRIBUTE,
  type DecisionElementKind,
} from "../../_model/decision-card-anchors.js";

/** Makes one meaningful decision element addressable by the shared reviewer. */
export const decisionReviewTarget = ({
  anchor,
  kind,
  name,
  entry = false,
}: {
  readonly anchor: string;
  readonly kind: DecisionElementKind;
  readonly name: string;
  readonly entry?: boolean;
}) => ({
  [DECISION_ANCHOR_ATTRIBUTE]: anchor,
  [DECISION_ELEMENT_ATTRIBUTE]: kind,
  [DECISION_NAME_ATTRIBUTE]: name,
  role: "group",
  tabIndex: entry ? 0 : -1,
  "aria-label": `${name}. Review target.`,
});
