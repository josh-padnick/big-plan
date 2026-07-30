// Renders a compiled Wireframe as a hand-drawn, semantic artboard: every
// screen in authored order, each element as the HTML element it depicts, and
// navigation expressed as data attributes the viewer script acts on. Without
// scripts the block degrades to a readable storyboard of every screen.

import type { JSX } from "react";
import type {
  CompiledWireframe,
  WireframeAlign,
  WireframeHeadingLevel,
  WireframeJustify,
  WireframeNode,
  WireframeScreen,
  WireframeSpace,
} from "./model.js";
import { WIREFRAME_VIEWPORT_PRESETS } from "./model.js";

// Token-to-utility maps are written as literals so the stylesheet generator
// sees every class this view can emit.
const GAP_CLASSES: Readonly<Record<WireframeSpace, string>> = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-10",
};

const ALIGN_CLASSES: Readonly<Record<WireframeAlign, string>> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

const JUSTIFY_CLASSES: Readonly<Record<WireframeJustify, string>> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};

// A screen heading sits below the review document's own section headings, so
// a wireframe never competes with the reader's outline.
const HEADING_TAGS: Readonly<
  Record<WireframeHeadingLevel, "h3" | "h4" | "h5">
> = {
  "1": "h3",
  "2": "h4",
  "3": "h5",
};

const WireframeElement = ({
  node,
}: {
  readonly node: WireframeNode;
}): JSX.Element => {
  switch (node.element) {
    case "Stack":
      return (
        <div
          className={`wireframe-stack flex flex-col ${GAP_CLASSES[node.gap]} ${ALIGN_CLASSES[node.align]}`}
        >
          <WireframeElements nodes={node.children} />
        </div>
      );
    case "Row":
      return (
        <div
          className={`wireframe-row flex flex-wrap ${GAP_CLASSES[node.gap]} ${ALIGN_CLASSES[node.align]} ${JUSTIFY_CLASSES[node.justify]}`}
        >
          <WireframeElements nodes={node.children} />
        </div>
      );
    case "Panel":
      return (
        <section className="wireframe-panel">
          {node.eyebrow === undefined && node.title === undefined ? null : (
            <header className="wireframe-panel-head">
              {node.eyebrow === undefined ? null : (
                <p className="wireframe-eyebrow">{node.eyebrow}</p>
              )}
              {node.title === undefined ? null : (
                <h4 className="wireframe-panel-title">{node.title}</h4>
              )}
            </header>
          )}
          <div className="wireframe-panel-body flex flex-col gap-3">
            <WireframeElements nodes={node.children} />
          </div>
        </section>
      );
    case "Heading": {
      const Tag = HEADING_TAGS[node.level];
      return <Tag className="wireframe-heading">{node.text}</Tag>;
    }
    case "Text":
      return (
        <p className="wireframe-text" data-wireframe-role={node.role}>
          {node.text}
        </p>
      );
    case "Button":
      return (
        <button
          type="button"
          className="wireframe-button"
          data-wireframe-emphasis={node.emphasis}
          {...(node.navigateTo === undefined
            ? {}
            : { "data-wireframe-navigate": node.navigateTo })}
        >
          {node.label}
        </button>
      );
  }
};

const WireframeElements = ({
  nodes,
}: {
  readonly nodes: ReadonlyArray<WireframeNode>;
}) => (
  <>
    {nodes.map((node, index) => (
      <WireframeElement key={index} node={node} />
    ))}
  </>
);

const Screen = ({
  screen,
  current,
}: {
  readonly screen: WireframeScreen;
  readonly current: boolean;
}) => {
  const preset = WIREFRAME_VIEWPORT_PRESETS[screen.viewport];
  return (
    <section
      className="wireframe-screen"
      aria-label={`${screen.name}, ${preset.label}`}
      data-wireframe-screen={screen.id}
      {...(current ? { "data-wireframe-current": "" } : {})}
    >
      <div className="wireframe-screen-caption">
        <span className="wireframe-screen-name">{screen.name}</span>
        <span className="wireframe-screen-viewport">
          {preset.label} - {preset.width}x{preset.height}
        </span>
      </div>
      <div
        className="wireframe-artboard"
        data-wireframe-viewport={screen.viewport}
      >
        <div className="wireframe-canvas flex flex-col gap-4">
          <WireframeElements nodes={screen.children} />
        </div>
      </div>
    </section>
  );
};

export const Wireframe = ({ model }: { readonly model: CompiledWireframe }) => (
  <figure className="wireframe" data-wireframe={model.id}>
    {model.title === undefined ? null : (
      <figcaption className="wireframe-caption">{model.title}</figcaption>
    )}
    {model.screens.length < 2 ? null : (
      <nav className="wireframe-switcher" aria-label="Prototype screens">
        {model.screens.map((screen) => (
          <button
            key={screen.id}
            type="button"
            className="wireframe-switch"
            data-wireframe-navigate={screen.id}
            data-wireframe-switch=""
            {...(screen.id === model.initialScreenId
              ? { "aria-current": "true" }
              : {})}
          >
            {screen.name}
          </button>
        ))}
      </nav>
    )}
    <div className="wireframe-screens">
      {model.screens.map((screen) => (
        <Screen
          key={screen.id}
          screen={screen}
          current={screen.id === model.initialScreenId}
        />
      ))}
    </div>
  </figure>
);
