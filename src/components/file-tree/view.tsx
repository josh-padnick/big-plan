// Renders FileTree's outer figure, optional title header, and semantic
// hierarchy through the shared tree component.

import type { CompiledFileTree } from "./compile.js";
import {
  TreeFoldControls,
  TreeHierarchy,
} from "../_shared/tree-hierarchy/tree-hierarchy.js";

export const FileTree = ({ model }: { readonly model: CompiledFileTree }) => (
  <figure
    className="file-tree mb-6 min-w-0 overflow-hidden rounded-md border border-edge bg-[var(--diff-content-bg)] font-mono text-[0.8125rem] leading-[1.5]"
    data-file-tree=""
  >
    {model.title === undefined ? null : (
      <figcaption className="file-tree-header flex min-w-0 items-center justify-between gap-3 border-b border-edge bg-[var(--diff-header-bg)] px-3 py-1.5 font-sans text-sm font-semibold text-ink">
        <span className="file-tree-title truncate">{model.title}</span>
        <span className="file-tree-controls flex shrink-0 items-center gap-1">
          <TreeFoldControls tone="standard" />
        </span>
      </figcaption>
    )}
    <div className="file-tree-body overflow-x-auto px-3 py-3">
      <TreeHierarchy
        noteDisplay="inline"
        entries={model.entries}
        nameForEntry={(entry) => entry.name}
        badgeForEntry={() => undefined}
      />
    </div>
  </figure>
);
