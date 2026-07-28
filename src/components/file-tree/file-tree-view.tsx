// Renders FileTree's outer figure, optional title header, and semantic
// hierarchy through the shared tree component.

import type { CompiledFileTree } from "./compile.js";
import {
  TreeFoldControls,
  TreeHierarchy,
} from "../_shared/tree-hierarchy/tree-hierarchy.js";

export const FileTree = ({ model }: { readonly model: CompiledFileTree }) => (
  <figure
    className="file-tree mb-5 min-w-0 overflow-hidden rounded-md border border-edge font-mono text-[0.8125rem] leading-[1.5]"
    data-file-tree=""
  >
    {model.title === undefined ? null : (
      <figcaption className="file-tree-header flex min-w-0 items-center justify-between gap-3 border-b border-edge px-[0.65rem] py-[0.4rem] font-sans text-sm font-semibold text-ink">
        <span className="file-tree-title truncate">{model.title}</span>
        <span className="file-tree-controls flex shrink-0 items-center gap-1">
          <TreeFoldControls tone="standard" />
        </span>
      </figcaption>
    )}
    <div className="file-tree-body overflow-x-auto px-3 py-2.5">
      <TreeHierarchy
        noteDisplay="inline"
        entries={model.entries}
        nameForEntry={(entry) => entry.name}
        badgeForEntry={() => undefined}
      />
    </div>
  </figure>
);
