// Presents Mermaid's compile-time SVG inside the existing FlowDiagram canvas
// contract. The viewer owns zoom, Fit, maximize, selection, and the Comment /
// Revert action bar; this view only supplies the static artwork and anchors.

import type { ReactNode } from "react";
import type { CompiledMermaidDiagram } from "./compile.js";
import {
  MERMAID_ANCHOR_ATTRIBUTE,
  MERMAID_ELEMENT_ATTRIBUTE,
} from "./anchors.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { MINUS_ICON } from "../../icons/lucide/minus.js";
import { PLUS_ICON } from "../../icons/lucide/plus.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { SCAN_ICON } from "../../icons/lucide/scan.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";
import {
  BODY_ATTRIBUTE,
  MAXIMIZABLE_ATTRIBUTE,
} from "../_model/figure-controls/figure-controls.js";

// Keep Mermaid's viewer chrome on the same current FlowDiagram contract. The
// shared diagram script owns behavior; this component owns the semantic
// controls that script upgrades into the live toolbar.
const VIEWER_CONTROL_CLASSES =
  "figure-control inline-flex h-9 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
const TOOLBAR_GROUP_CLASSES =
  "inline-flex h-9 shrink-0 items-center overflow-hidden rounded-md border border-edge bg-raised";

const IconControl = ({
  icon,
  label,
  action,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly action: string;
}) => (
  <button
    type="button"
    className={`${VIEWER_CONTROL_CLASSES} w-9 px-0`}
    aria-label={label}
    data-tooltip={label}
    data-flow-zoom={action}
  >
    {lucideIconToReact({ icon, hidden: false })}
  </button>
);

const FigureCommentControl = () => (
  <button
    type="button"
    className={`${VIEWER_CONTROL_CLASSES} flow-diagram-figure-comment w-9 px-0`}
    data-flow-figure-comment
    aria-label="Comment on this diagram"
    data-tooltip="Comment on this diagram"
  >
    {lucideIconToReact({ icon: MESSAGE_SQUARE_ICON, hidden: false })}
  </button>
);

const ToolbarSeparator = () => (
  <span className="mx-0.5 h-4 w-px shrink-0 bg-edge" aria-hidden="true" />
);

const ViewerControls = () => (
  <span
    className="mermaid-diagram-viewer-cluster flow-diagram-view-controls ml-auto inline-flex shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap"
    data-flow-zoom-controls
    hidden
  >
    <span
      className={`flow-diagram-zoom ${TOOLBAR_GROUP_CLASSES}`}
      role="group"
      aria-label="Diagram zoom"
    >
      <IconControl icon={MINUS_ICON} label="Zoom out" action="out" />
      <button
        type="button"
        className={`${VIEWER_CONTROL_CLASSES} flow-diagram-zoom-readout min-w-12 border-x border-edge px-2 font-sans text-2xs tabular-nums`}
        aria-label="Reset zoom to 100%"
        data-tooltip="Reset zoom to 100%"
        data-flow-zoom="reset"
        data-flow-zoom-readout
      >
        100%
      </button>
      <IconControl icon={PLUS_ICON} label="Zoom in" action="in" />
    </span>
    <button
      type="button"
      className={`${VIEWER_CONTROL_CLASSES} flow-diagram-fit gap-1.5 rounded-md border border-edge bg-raised px-3 font-sans text-2xs font-semibold`}
      aria-label="Fit diagram to width"
      aria-pressed="false"
      data-tooltip="Fit diagram to width"
      data-flow-zoom="fit"
    >
      {lucideIconToReact({ icon: SCAN_ICON, hidden: false })}
      <span>Fit</span>
    </button>
    <ToolbarSeparator />
    <FigureCommentControl />
    <ToolbarSeparator />
    <MaximizeButton subject="diagram" size="toolbar" />
  </span>
);

const ProposalControls = () => (
  <span
    className="flow-diagram-proposal-group ml-2 inline-flex items-center gap-1"
    data-flow-proposal-group
    hidden
  >
    <span
      className={`flow-diagram-mode ${VIEWER_CONTROL_CLASSES} gap-2 rounded-md px-3 font-sans text-2xs font-semibold`}
    >
      <span>Show original</span>
      <button
        type="button"
        role="switch"
        aria-checked="false"
        aria-label="Show original"
        className="flow-diagram-mode-switch inline-flex h-3.5 w-6 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-raised transition-all outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50 aria-checked:bg-accent aria-[checked=false]:bg-edge"
        data-flow-mode
      >
        <span className="flow-diagram-mode-thumb pointer-events-none block size-3 rounded-full bg-paper ring-0 transition-transform" />
      </button>
    </span>
    <button
      type="button"
      className={`${VIEWER_CONTROL_CLASSES} flow-diagram-revert-all gap-1.5 rounded-md border border-edge bg-raised px-3 font-sans text-2xs font-semibold`}
      data-flow-revert-all
      aria-label="Revert edits and deletions"
      data-tooltip="Revert edits and deletions"
    >
      {lucideIconToReact({ icon: ROTATE_CCW_ICON, hidden: false })}
      <span>Revert all</span>
    </button>
  </span>
);

const StaticVariant = ({
  svg,
  theme,
  label,
}: {
  readonly svg: string;
  readonly theme: "light" | "dark";
  readonly label: string;
}) => (
  <div
    className={`mermaid-diagram-svg mermaid-diagram-svg-${theme}`}
    data-mermaid-theme={theme}
    data-flow-variant={theme}
    aria-label={label}
    dangerouslySetInnerHTML={{ __html: svg }}
  />
);

export const MermaidDiagram = ({
  model,
}: {
  readonly model: CompiledMermaidDiagram;
}): ReactNode => {
  const label =
    model.interactive && model.nodes.length === 0
      ? (model.type ?? "Mermaid") +
        " diagram with selectable static review targets"
      : model.interactive
        ? "Mermaid " +
          (model.direction ?? "flow") +
          " diagram with " +
          model.nodes.length +
          " nodes and " +
          model.edges.length +
          " edges"
        : (model.type ?? "Mermaid") +
          " diagram; comments apply to the whole figure and footer";
  return (
    <figure
      className="flow-diagram mermaid-diagram relative mb-6 min-w-0"
      data-flow-diagram
      {...{
        [MERMAID_ELEMENT_ATTRIBUTE]: "figure",
        [MERMAID_ANCHOR_ATTRIBUTE]: model.anchor,
        "data-flow-name": "Mermaid diagram",
        "data-flow-scope": "Mermaid diagram",
        "data-flow-surface": "zoom",
        "data-mermaid-type": model.type,
        "data-mermaid-interactive": model.interactive ? "true" : "false",
        role: "group",
        "aria-label": label,
        tabIndex: 0,
        [MAXIMIZABLE_ATTRIBUTE]: "diagram",
      }}
    >
      <div
        className="figure-control-bar flow-diagram-controls flex min-w-0 items-center"
        data-flow-controls
      >
        <ProposalControls />
        <ViewerControls />
      </div>
      <div
        className="flow-diagram-viewport"
        data-flow-viewport
        {...{ [BODY_ATTRIBUTE]: "" }}
      >
        <div className="flow-diagram-sizer" data-flow-sizer>
          <div className="flow-diagram-artboard" data-flow-artboard>
            <div
              className="mermaid-diagram-static"
              role="group"
              aria-label={label}
            >
              <StaticVariant svg={model.lightSvg} theme="light" label={label} />
              <StaticVariant svg={model.darkSvg} theme="dark" label={label} />
            </div>
          </div>
        </div>
      </div>
      {model.footer === undefined ? null : (
        <figcaption
          className="flow-diagram-footer mt-4 mb-0 text-center text-sm text-muted"
          data-flow-diagram-footer
          {...{
            [MERMAID_ELEMENT_ATTRIBUTE]: "footer",
            [MERMAID_ANCHOR_ATTRIBUTE]: model.footerAnchor,
            "data-flow-name": "diagram footer",
            role: "group",
            "aria-label": "Diagram footer",
            tabIndex: -1,
          }}
        >
          <span data-flow-field="footer">
            {hastContentToReact(model.footer)}
          </span>
        </figcaption>
      )}
      <span className="sr-only">
        {label}
        {model.interactive && model.nodes.length > 0
          ? " " + model.nodes.map((node) => node.label).join(", ") + "."
          : "."}
      </span>
    </figure>
  );
};
