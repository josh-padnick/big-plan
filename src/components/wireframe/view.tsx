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
    case "AppShell":
      return (
        <div className="wireframe-app-shell">
          <WireframeElements nodes={node.children} />
        </div>
      );
    case "Sidebar":
      return (
        <div className="wireframe-sidebar flex flex-col gap-3">
          {node.brand === undefined ? null : (
            <p className="wireframe-brand">{node.brand}</p>
          )}
          {node.mode === undefined ? null : (
            <p className="wireframe-eyebrow">{node.mode}</p>
          )}
          <WireframeElements nodes={node.children} />
        </div>
      );
    case "AppContent":
      return (
        <div className="wireframe-app-content flex flex-col gap-4">
          <WireframeElements nodes={node.children} />
        </div>
      );
    case "TopBar":
      return (
        <div className="wireframe-top-bar flex flex-wrap items-center gap-3">
          {node.title === undefined ? null : (
            <p className="wireframe-brand">{node.title}</p>
          )}
          <WireframeElements nodes={node.children} />
        </div>
      );
    case "PageHeader":
      return (
        <header className="wireframe-page-header flex flex-wrap items-center gap-3">
          <div className="wireframe-page-header-text flex flex-col gap-1">
            <h3 className="wireframe-heading">{node.title}</h3>
            {node.description === undefined ? null : (
              <p className="wireframe-text" data-wireframe-role="helper">
                {node.description}
              </p>
            )}
          </div>
          {node.badge === undefined ? null : (
            <span className="wireframe-badge">{node.badge}</span>
          )}
          <div className="wireframe-page-header-actions flex flex-wrap gap-2">
            <WireframeElements nodes={node.children} />
          </div>
        </header>
      );
    case "Nav":
      return (
        <nav
          className="wireframe-nav flex flex-col gap-1"
          {...(node.label === undefined ? {} : { "aria-label": node.label })}
        >
          <WireframeElements nodes={node.children} />
        </nav>
      );
    case "NavItem":
      return (
        <button
          type="button"
          className="wireframe-nav-item"
          {...(node.active ? { "aria-current": "page" } : {})}
          {...(node.navigateTo === undefined
            ? {}
            : { "data-wireframe-navigate": node.navigateTo })}
        >
          {node.label}
        </button>
      );
    case "Metric":
      return (
        <div className="wireframe-metric flex flex-col">
          <span className="wireframe-metric-label">{node.label}</span>
          <span className="wireframe-metric-value">{node.value}</span>
          {node.note === undefined ? null : (
            <span className="wireframe-metric-note">{node.note}</span>
          )}
        </div>
      );
    case "Progress":
      // The bar is decoration; the percentage beside it is the state, so a
      // reader without the drawing still knows how far along this is.
      return (
        <div className="wireframe-progress flex flex-col gap-1">
          <div className="wireframe-progress-line flex justify-between gap-2">
            <span>{node.label ?? "Progress"}</span>
            <span className="wireframe-progress-value">{node.value}%</span>
          </div>
          <div className="wireframe-progress-track" aria-hidden="true">
            <div
              className="wireframe-progress-fill"
              data-wireframe-progress={String(Math.round(node.value / 5) * 5)}
            />
          </div>
          {node.detail === undefined ? null : (
            <span className="wireframe-metric-note">{node.detail}</span>
          )}
        </div>
      );
    case "Badge":
      return <span className="wireframe-badge">{node.label}</span>;
    case "Divider":
      return node.label === undefined ? (
        <hr className="wireframe-divider" />
      ) : (
        <div className="wireframe-divider-labeled flex items-center gap-2">
          <hr className="wireframe-divider grow" />
          <span className="wireframe-eyebrow">{node.label}</span>
          <hr className="wireframe-divider grow" />
        </div>
      );
    case "ImagePlaceholder":
      return (
        <div
          className="wireframe-image flex items-center justify-center"
          data-wireframe-shape={node.shape}
        >
          <span className="wireframe-image-label">{node.label}</span>
        </div>
      );
    case "List":
      return (
        <ul className="wireframe-list flex flex-col">
          <WireframeElements nodes={node.children} />
        </ul>
      );
    case "ListItem":
      return (
        <li className="wireframe-list-item flex flex-wrap items-baseline gap-2">
          <span className="wireframe-list-label grow">{node.label}</span>
          {node.meta === undefined ? null : (
            <span className="wireframe-list-meta">{node.meta}</span>
          )}
          {node.value === undefined ? null : (
            <span className="wireframe-list-value">{node.value}</span>
          )}
        </li>
      );
    // Every control is the real element, wrapped in its own label, so the
    // association needs no generated id and a reviewer meets the affordance
    // the product will actually have.
    case "TextField":
      return (
        <Field label={node.label} hint={node.hint}>
          <input
            className="wireframe-input"
            type={node.kind}
            {...(node.placeholder === undefined
              ? {}
              : { placeholder: node.placeholder })}
            {...(node.value === undefined ? {} : { defaultValue: node.value })}
          />
        </Field>
      );
    case "TextArea":
      return (
        <Field label={node.label} hint={node.hint}>
          <textarea
            className="wireframe-input wireframe-textarea"
            rows={3}
            {...(node.placeholder === undefined
              ? {}
              : { placeholder: node.placeholder })}
            {...(node.value === undefined ? {} : { defaultValue: node.value })}
          />
        </Field>
      );
    case "Select":
      return (
        <Field label={node.label} hint={node.hint}>
          {/* A wireframe shows the chosen option, not the whole menu. */}
          <select className="wireframe-input wireframe-select">
            <option>{node.value}</option>
          </select>
        </Field>
      );
    case "Checkbox":
      return (
        <Field label={node.label} hint={node.hint} inline>
          <input
            className="wireframe-tick"
            type="checkbox"
            defaultChecked={node.checked}
          />
        </Field>
      );
    case "Switch":
      return (
        <Field label={node.label} hint={node.hint} inline>
          <input
            className="wireframe-switch-control"
            type="checkbox"
            role="switch"
            defaultChecked={node.on}
          />
        </Field>
      );
    case "Stepper":
      return (
        <ol className="wireframe-stepper flex flex-wrap items-center">
          <WireframeElements nodes={node.children} />
        </ol>
      );
    case "Step":
      return (
        <li className="wireframe-step" data-wireframe-step={node.state}>
          {node.label}
        </li>
      );
    case "Connector":
      // The arrow is decoration; the condition beside it is the meaning, so
      // the glyph is hidden and any label stays readable text.
      return (
        <div
          className="wireframe-connector flex items-center justify-center"
          data-wireframe-direction={node.direction}
        >
          <span className="wireframe-connector-line" aria-hidden="true" />
          {node.label === undefined ? null : (
            <span className="wireframe-connector-label">{node.label}</span>
          )}
        </div>
      );
  }
};

// One control and the label it belongs to. Wrapping rather than pairing by id
// keeps every field self-contained, which matters when the same wireframe is
// drawn more than once in a document.
const Field = ({
  label,
  hint,
  inline = false,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly inline?: boolean;
  readonly children: JSX.Element;
}) => (
  <label className="wireframe-field" data-wireframe-inline={String(inline)}>
    {inline ? children : null}
    <span className="wireframe-field-label">{label}</span>
    {inline ? null : children}
    {hint === undefined ? null : (
      <span className="wireframe-field-hint">{hint}</span>
    )}
  </label>
);

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
      <div className="wireframe-frame" data-wireframe-chrome={screen.chrome}>
        {screen.chrome === "browser" ? (
          <div className="wireframe-browser-bar">
            <span className="wireframe-browser-dots" aria-hidden="true" />
            <span className="wireframe-browser-address">
              {screen.url ?? " "}
            </span>
          </div>
        ) : null}
        {screen.chrome === "phone" ? (
          <span className="wireframe-phone-notch" aria-hidden="true" />
        ) : null}
        <div
          className="wireframe-artboard"
          data-wireframe-viewport={screen.viewport}
        >
          <div className="wireframe-canvas flex flex-col gap-4">
            <WireframeElements nodes={screen.children} />
          </div>
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
