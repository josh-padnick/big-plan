// Owns the framework-free contract between snapshot alignment and a
// component's presentation of the model pair the engine found.

/** Which snapshot a rendered component side belongs to. */
export type DiffSide = "baseline" | "proposed";

/** Which rendered sides expose one declared anchor for comments. */
export type ComponentCommentableSides = DiffSide | "both";

/** One semantic anchor kind a component's view may expose to comments. */
export type ComponentCommentableAnchor = {
  readonly kind: string;
  readonly sides: ComponentCommentableSides;
};

/** Whether one declared anchor accepts a comment on the requested side. */
export const componentCommentableAnchorAllows = ({
  anchor,
  side,
}: {
  readonly anchor: ComponentCommentableAnchor;
  readonly side: DiffSide;
}): boolean => anchor.sides === "both" || anchor.sides === side;

/** The word-level alignment the engine already computed for the pair. */
export type ComponentDiffRun = {
  readonly op: "same" | "del" | "ins";
  readonly text: string;
};

/**
 * The complete pair the engine hands to a component.
 *
 * Detection, alignment, baseline policy, and attribution remain outside the
 * component. The discriminated union makes each status carry exactly the
 * models that status can honestly have.
 */
export type ComponentDiffInput<TModel> =
  | {
      readonly status: "added";
      readonly proposed: TModel;
      readonly runs: ReadonlyArray<ComponentDiffRun>;
    }
  | {
      readonly status: "removed";
      readonly baseline: TModel;
      readonly runs: ReadonlyArray<ComponentDiffRun>;
    }
  | {
      readonly status: "changed";
      readonly baseline: TModel;
      readonly proposed: TModel;
      readonly runs: ReadonlyArray<ComponentDiffRun>;
    };

/** The free default loses none of the engine's input. */
export type DefaultComponentDiffModel<TModel> = ComponentDiffInput<TModel>;

/** Plain, JSON-serializable data describing what a component diff shows. */
export type ComponentDiffModel = unknown;

/**
 * Marks a subtree a component's diff view keeps live on the isolated
 * baseline side: a control the reader may operate, and the evidence that
 * control reveals.
 *
 * Baseline isolation holds the whole Was rendering inert, because a second
 * live copy of a component fights the proposed side for the same frame. A
 * component that annotates the baseline with something only the baseline can
 * reach - a screen the change removed, a screen it moved - would otherwise
 * advertise a control that silently does nothing. Marking is the narrow
 * exception: isolation holds everything off the path to a mark inert
 * instead, because `inert` is inherited and a descendant cannot opt back out
 * of an inert ancestor.
 *
 * Mark the revealed content as well as the control that reveals it. `inert`
 * takes content out of the accessibility tree and out of selection, so a
 * control whose target stays inert still does nothing for a reader using
 * assistive technology - the failure the exception exists to remove.
 */
export const DIFF_LIVE_ATTRIBUTE = "data-diff-live";
