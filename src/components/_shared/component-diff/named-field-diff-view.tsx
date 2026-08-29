// Renders the shared Was/Now presentation used by named-field component diffs.

import type { ComponentType } from "react";
import type { NamedFieldDiff } from "../../_model/component-diff/named-fields.js";
import { ComponentDiffSide } from "./component-diff-context.js";

/** Renders component-owned projections through the shared Was/Now chrome. */
export const NamedFieldDiffView = <Model,>({
  model,
  controlId,
  view,
  project,
}: {
  readonly model: NamedFieldDiff<Model>;
  readonly controlId: string;
  readonly view: ComponentType<{ readonly model: Model }>;
  readonly project: (value: Model, fields: ReadonlySet<string>) => Model;
}) => {
  const fields = new Set(model.changedFields);
  return (
    <figure
      className="my-4 grid w-full min-w-0 max-w-[var(--measure)] grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border border-dashed border-accent bg-raised p-4 text-ink shadow-raised"
      data-component-diff=""
      data-review-diff-lens=""
      data-component-diff-control-id={controlId}
    >
      <figcaption className="flex min-w-0 items-baseline gap-2">
        <strong className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-bold tracking-caps text-accent uppercase">
          What changed
        </strong>
        <em className="text-2xs text-muted">{model.status}</em>
      </figcaption>
      {model.status === "added" ? null : (
        <div
          className="min-w-0 rounded-lg bg-[var(--diff-remove-bg)] p-3 text-[var(--diff-remove-c)] inset-shadow-well"
          data-component-diff-side="baseline"
        >
          <strong className="mb-2 block text-2xs uppercase tracking-caps">
            Was
          </strong>
          {model.status === "changed" ? (
            <p
              className="mb-2 text-2xs font-semibold tracking-caps uppercase"
              data-review-diff-field-label=""
            >
              {model.changedFields.join(" · ")}
            </p>
          ) : null}
          <ComponentDiffSide side="baseline" status={model.status}>
            {(() => {
              const View = view;
              return (
                <View
                  model={
                    model.status === "changed"
                      ? project(model.baseline, fields)
                      : model.baseline
                  }
                />
              );
            })()}
          </ComponentDiffSide>
        </div>
      )}
      {model.status === "removed" ? null : (
        <div
          className="min-w-0 rounded-lg bg-[var(--diff-add-bg)] p-3 text-[var(--diff-add-c)] inset-shadow-well"
          data-component-diff-side="proposed"
        >
          <strong className="mb-2 block text-2xs uppercase tracking-caps">
            Now
          </strong>
          {model.status === "changed" ? (
            <p
              className="mb-2 text-2xs font-semibold tracking-caps uppercase"
              data-review-diff-field-label=""
            >
              {model.changedFields.join(" · ")}
            </p>
          ) : null}
          <ComponentDiffSide side="proposed" status={model.status}>
            {(() => {
              const View = view;
              return (
                <View
                  model={
                    model.status === "changed"
                      ? project(model.proposed, fields)
                      : model.proposed
                  }
                />
              );
            })()}
          </ComponentDiffSide>
        </div>
      )}
    </figure>
  );
};
