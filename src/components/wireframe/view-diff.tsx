// Owns Wireframe's bespoke Was/Now presentation: the shared toggle chrome,
// each side's real Wireframe (so the screen switcher, maximize, and fit are
// the component's own), and the per-screen badges the free default cannot
// draw. The viewer script already fits every `[data-wireframe]` after an
// article replacement, which is why this view does not re-implement a fit
// effect or import wireframe-fit.ts.

import {
  wireframeScreenStatusLabel,
  type CompiledWireframeDiff,
  type WireframeScreenDiff,
} from "./compile-diff.js";
import { Wireframe } from "./view.js";
import { ComponentDiffSide } from "../_shared/component-diff/component-diff-context.js";
import { ComponentDiffToggle } from "../_shared/component-diff/toggle.js";

const initialScreenDiff = (
  screens: ReadonlyArray<WireframeScreenDiff>,
): WireframeScreenDiff | undefined =>
  screens.find((screen) => screen.status === "initial");

/** Renders a wireframe change as the real prototype plus per-screen badges. */
export const WireframeDiffView = ({
  model,
  controlId,
}: {
  readonly model: CompiledWireframeDiff;
  // The engine's per-instance key. Two wireframes may share an authored id,
  // so the toggle's form identity comes from the engine rather than the
  // model this view was handed.
  readonly controlId: string;
}) => {
  const hasBaseline = model.status !== "added";
  const hasProposed = model.status !== "removed";
  const initial = initialScreenDiff(model.screens);
  // A wholly added or removed wireframe compares against nothing, so every
  // screen would carry the same badge the figcaption already states once.
  // Badging each entry there distinguishes nothing and, for a removal,
  // strikes through the very control that keeps its screens readable.
  const screenDiffs = model.status === "changed" ? model.screens : undefined;
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
      <div
        className="flex min-w-0 flex-wrap items-center gap-3"
        data-component-diff-controls=""
      >
        {hasBaseline && hasProposed ? (
          <ComponentDiffToggle controlId={controlId} />
        ) : (
          <span className="rounded-full border border-edge bg-surface px-4 py-1.5 text-xs font-semibold text-ink">
            {hasProposed ? "Now" : "Was"}
          </span>
        )}
        {initial === undefined ? null : (
          <span className="rounded-md bg-[color-mix(in_srgb,var(--callout-warning-c)_14%,var(--callout-warning-bg))] px-2 py-0.5 text-2xs font-bold text-[var(--callout-warning-c)]">
            {`${wireframeScreenStatusLabel(initial)} · ${initial.name}`}
          </span>
        )}
      </div>
      {"baseline" in model ? (
        <div
          className="min-w-0 rounded-lg border border-edge bg-surface p-3 text-ink"
          data-component-diff-side="baseline"
        >
          <ComponentDiffSide side="baseline" status={model.status}>
            <Wireframe model={model.baseline} screenDiffs={screenDiffs} />
          </ComponentDiffSide>
        </div>
      ) : null}
      {"proposed" in model ? (
        <div
          className="min-w-0 rounded-lg border border-edge bg-surface p-3 text-ink"
          data-component-diff-side="proposed"
        >
          <ComponentDiffSide side="proposed" status={model.status}>
            <Wireframe model={model.proposed} screenDiffs={screenDiffs} />
          </ComponentDiffSide>
        </div>
      ) : null}
    </figure>
  );
};
