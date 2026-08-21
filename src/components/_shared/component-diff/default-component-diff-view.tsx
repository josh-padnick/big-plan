// Owns the free Was/Now presentation every component receives when it does
// not provide a bespoke model-level diff view.

import type { ComponentType } from "react";
import type { DefaultComponentDiffModel } from "../../_model/component-diff/contract.js";
import { ComponentDiffSide } from "./component-diff-context.js";

const TOGGLE_OPTION_CLASSES =
  "relative z-10 min-h-8 cursor-pointer rounded-full border-0 bg-transparent px-4 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Renders the real component view on each side of the free comparison. */
export const DefaultComponentDiffView = <TModel,>({
  model,
  view: View,
  controlId,
}: {
  readonly model: DefaultComponentDiffModel<TModel>;
  readonly view: ComponentType<{ readonly model: TModel }>;
  readonly controlId: string;
}) => {
  const hasBaseline = model.status !== "added";
  const hasProposed = model.status !== "removed";
  const baselineId = `${controlId}-baseline`;
  const proposedId = `${controlId}-proposed`;
  return (
    <figure
      className="my-4 grid w-full min-w-0 max-w-[var(--measure)] grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border border-dashed border-accent bg-raised p-4 text-ink shadow-raised"
      data-component-diff=""
      data-review-diff-lens=""
    >
      <figcaption className="flex min-w-0 items-baseline gap-2">
        <strong className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-bold tracking-caps text-accent uppercase">
          {"What changed"}
        </strong>
        <em className="text-2xs text-muted">{model.status}</em>
      </figcaption>
      {hasBaseline && hasProposed ? (
        <>
          <input
            className="sr-only"
            id={baselineId}
            name={controlId}
            type="radio"
            data-component-diff-choice="baseline"
          />
          <input
            className="sr-only"
            id={proposedId}
            name={controlId}
            type="radio"
            data-component-diff-choice="proposed"
            defaultChecked
          />
        </>
      ) : null}
      <div
        className="flex min-w-0 flex-wrap items-center gap-3"
        data-component-diff-controls=""
      >
        {hasBaseline && hasProposed ? (
          <div
            className="relative inline-grid grid-cols-2 rounded-full border border-edge bg-surface p-0.5"
            role="group"
            aria-label="Choose Was or Now"
            data-component-diff-toggle=""
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-[var(--diff-add-bg)] transition-[translate] duration-150 ease-out"
              data-component-diff-toggle-thumb=""
            />
            <label
              htmlFor={baselineId}
              className={`${TOGGLE_OPTION_CLASSES} text-muted`}
              data-component-diff-label="baseline"
            >
              {"Was"}
            </label>
            <label
              htmlFor={proposedId}
              className={`${TOGGLE_OPTION_CLASSES} text-[var(--diff-add-c)]`}
              data-component-diff-label="proposed"
            >
              {"Now"}
            </label>
          </div>
        ) : (
          <span className="rounded-full border border-edge bg-surface px-4 py-1.5 text-xs font-semibold text-ink">
            {hasProposed ? "Now" : "Was"}
          </span>
        )}
      </div>
      {hasBaseline ? (
        <div
          className="min-w-0 rounded-lg border-[10px] bg-surface p-3 text-ink inset-shadow-well [border-color:color-mix(in_srgb,var(--diff-remove-c)_30%,var(--diff-remove-bg))]"
          data-component-diff-side="baseline"
        >
          <ComponentDiffSide side="baseline" status={model.status}>
            <View model={model.baseline} />
          </ComponentDiffSide>
        </div>
      ) : null}
      {hasProposed ? (
        <div
          className="min-w-0 rounded-lg border-[10px] bg-surface p-3 text-ink inset-shadow-well [border-color:color-mix(in_srgb,var(--diff-add-c)_30%,var(--diff-add-bg))]"
          data-component-diff-side="proposed"
        >
          <ComponentDiffSide side="proposed" status={model.status}>
            <View model={model.proposed} />
          </ComponentDiffSide>
        </div>
      ) : null}
    </figure>
  );
};
