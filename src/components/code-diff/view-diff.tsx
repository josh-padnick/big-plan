import { NamedFieldDiffView } from "../_shared/component-diff/named-field-diff-view.js";
import type { CompiledCodeDiff } from "./compile.js";
import type { CompiledCodeDiffDiff } from "./compile-diff.js";
import { CodeDiff } from "./view.js";

export const CodeDiffDiffView = ({
  model,
  controlId,
}: {
  readonly model: CompiledCodeDiffDiff;
  readonly controlId: string;
}) => (
  <NamedFieldDiffView
    model={model}
    controlId={controlId}
    view={CodeDiff}
    project={(value: CompiledCodeDiff) => value}
  />
);
