// Presents Callout changes through the shared named-field diff view.

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
    project={(value: CompiledCallout) => ({
      // The view requires a type to choose its panel chrome; preserve it while
      // omitting unchanged authored title and body content.
      type: value.type,
      ...(model.changedFields.includes("Title") && value.title !== undefined
        ? { title: value.title }
        : {}),
      body: model.changedFields.includes("Body") ? value.body : [],
    })}
  />
);
