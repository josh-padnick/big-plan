// Renders a compiled CodeDiff as a static figure with both review views and
// the hidden source consumed by the live review application.

import type { CompiledCodeDiff } from "./compile.js";
import { CodeDiffHeader } from "./view-header.js";
import { CodeDiffViews } from "./view-layouts.js";
import { MAXIMIZABLE_ATTRIBUTE } from "../_model/figure-controls/figure-controls.js";

export const CodeDiff = ({ model }: { readonly model: CompiledCodeDiff }) => (
  <figure
    className="code-diff mb-6 min-w-0 max-w-full rounded-md bg-[var(--diff-content-bg)] font-mono text-sm shadow-raised"
    data-code-diff=""
    {...{ [MAXIMIZABLE_ATTRIBUTE]: "diff" }}
    data-diff-view="unified"
    data-diff-path={model.filePath}
    {...(model.showLineNumbers ? { "data-line-numbers": "" } : {})}
  >
    <CodeDiffHeader
      filePath={model.filePath}
      addedCount={model.addedCount}
      removedCount={model.removedCount}
      showLineCounts={model.showLineCounts}
    />
    <CodeDiffViews
      diff={model.diff}
      showLineNumbers={model.showLineNumbers}
      annotations={model.annotations}
    />
    <textarea hidden readOnly data-diff-source="" defaultValue={model.source} />
  </figure>
);
