import { NamedFieldDiffView } from "../_shared/component-diff/named-field-diff-view.js";
import type { CompiledCallout } from "./compile.js";
import type { CompiledCalloutDiff } from "./compile-diff.js";
import { Callout } from "./view.js";

export const CalloutDiffView = ({
  model,
  controlId,
}: {
  readonly model: CompiledCalloutDiff;
  readonly controlId: string;
}) => (
  <NamedFieldDiffView
    model={model}
    controlId={controlId}
    view={Callout}
    project={(value: CompiledCallout) => value}
  />
);
