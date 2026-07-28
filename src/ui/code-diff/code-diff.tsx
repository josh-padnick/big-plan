// The React port of CodeDiff: the outer figure around the caption, both
// static views, and the hidden raw-source copy target; markup mirrors the
// vanilla renderer class-for-class until the vanilla side is deleted.

import { renderToStaticMarkup } from "react-dom/server";
import type { CompiledCodeDiff } from "../../model/compile-code-diff.js";
import { CodeDiffHeader } from "./code-diff-header.js";
import { CodeDiffViews } from "./code-diff-views.js";

const CodeDiffView = ({ model }: { readonly model: CompiledCodeDiff }) => (
  <figure
    className="code-diff mb-5 min-w-0 rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]"
    data-code-diff=""
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

/** Renders one compiled CodeDiff to static HTML via the React port. */
export const renderCodeDiffStatic = (model: CompiledCodeDiff): string =>
  renderToStaticMarkup(<CodeDiffView model={model} />);
