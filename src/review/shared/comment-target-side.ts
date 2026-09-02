// Owns how a comment's diff side is named. A component diff puts the same
// affordance on the Was side, on the Now side, and on the live plan block the
// Now side is a copy of, so three controls can carry one identical name while
// two of them address different things. Naming the side in the control and
// again in the composer is what keeps a reviewer from discovering which one
// they hit only after the comment reaches the agent.

/** Which side of a component diff a comment points at. */
export type CommentTargetSide = "baseline" | "proposed";

export const isCommentTargetSide = (
  value: string | undefined,
): value is CommentTargetSide => value === "baseline" || value === "proposed";

/** The reader-facing word for a side, matching the diff toggle's own labels. */
export const commentTargetSideLabel = (side: CommentTargetSide): string =>
  side === "baseline" ? "Was" : "Now";

/**
 * A control's accessible name, qualified by the side it points at. A target
 * outside any diff keeps its plain name: there is nothing to tell it apart
 * from, and a qualifier there would claim a distinction the address does not
 * make.
 */
export const sideQualifiedControlLabel = ({
  label,
  side,
}: {
  readonly label: string;
  readonly side?: CommentTargetSide;
}): string =>
  side === undefined ? label : `${label} (${commentTargetSideLabel(side)})`;
