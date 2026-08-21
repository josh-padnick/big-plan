// Owns the framework-free contract between snapshot alignment and a
// component's presentation of the model pair the engine found.

/** Which snapshot a rendered component side belongs to. */
export type DiffSide = "baseline" | "proposed";

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
