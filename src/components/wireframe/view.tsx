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
import { WIREFRAME_DEVICE_PRESETS } from "./model.js";

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

// A direct record collection makes its Panel the master pane. Rail is the only
// authored width primitive; the Row owns every other workspace proportion.
const isMasterPane = (node: WireframeNode): boolean =>
  node.element === "Panel" &&
  node.children.some(
    (child) => child.element === "List" || child.element === "Table",
  );

const isWorkspaceRow = (children: ReadonlyArray<WireframeNode>): boolean =>
  children.some((child) => child.element === "Rail") ||
  (children.length > 1 && children.some(isMasterPane));

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
          {...(isWorkspaceRow(node.children)
            ? { "data-wireframe-workspace": "" }
            : {})}
        >
          <WireframeElements nodes={node.children} />
        </div>
      );
    case "Panel":
      return (
        <section
          className="wireframe-panel"
          data-wireframe-surface={node.surface}
          {...(isMasterPane(node) ? { "data-wireframe-master": "" } : {})}
        >
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
    case "SegmentedControl":
      return (
        <div
          className="wireframe-segmented-control flex flex-nowrap"
          role="group"
        >
          <WireframeElements nodes={node.children} />
        </div>
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
    case "BottomBar":
      return (
        <div
          className="wireframe-bottom-bar flex flex-nowrap items-center justify-between gap-2"
          role="navigation"
          aria-label="Primary destinations"
        >
          <WireframeElements nodes={node.children} />
        </div>
      );
    case "PageHeader":
      return (
        <header className="wireframe-page-header flex flex-wrap items-center gap-3">
          <div className="wireframe-page-header-text flex flex-col gap-1">
            {/* State belongs beside what it describes. In the action group it
                reads as one more button. */}
            <div className="wireframe-page-header-title flex flex-wrap items-center gap-2">
              <h3 className="wireframe-heading">{node.title}</h3>
              {node.badge === undefined ? null : (
                <span className="wireframe-badge" data-wireframe-tone="neutral">
                  {node.badge}
                </span>
              )}
            </div>
            {node.description === undefined ? null : (
              <p className="wireframe-text" data-wireframe-role="helper">
                {node.description}
              </p>
            )}
          </div>
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
      // The bar is decoration; readable text beside it carries the state. A
      // concrete authored phrase can replace the abstract percentage.
      return (
        <div className="wireframe-progress flex flex-col gap-1">
          <div className="wireframe-progress-line flex justify-between gap-2">
            <span>{node.label ?? "Progress"}</span>
            <span className="wireframe-progress-value">
              {node.valueLabel ?? `${node.value}%`}
            </span>
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
      return (
        <span className="wireframe-badge" data-wireframe-tone={node.tone}>
          {node.label}
        </span>
      );
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
    case "ListItem": {
      // Every queue/inbox row is two lines so a narrow desktop list column never
      // jams title, status, and age onto one flex line (which overflows as
      // overlapping or one-word-per-line wrapping):
      //   line 1 - truncating title [trailing value]
      //   line 2 - metadata
      const rowInner = (
        <>
          <span className="wireframe-list-row-primary flex w-full min-w-0 flex-nowrap items-baseline gap-2">
            <span className="wireframe-list-label grow">{node.label}</span>
            {node.value === undefined ? null : (
              <span className="wireframe-list-value">{node.value}</span>
            )}
          </span>
          {node.meta === undefined ? null : (
            <span className="wireframe-list-meta">{node.meta}</span>
          )}
        </>
      );
      if (node.navigateTo !== undefined) {
        return (
          <li
            className="wireframe-list-item"
            {...(node.selected ? { "data-wireframe-selected": "" } : {})}
          >
            <button
              type="button"
              className="wireframe-list-row flex w-full min-w-0 flex-col gap-0.5"
              data-wireframe-navigate={node.navigateTo}
            >
              {rowInner}
            </button>
          </li>
        );
      }
      return (
        <li
          className="wireframe-list-item flex min-w-0 flex-col gap-0.5"
          {...(node.selected ? { "data-wireframe-selected": "" } : {})}
        >
          {rowInner}
        </li>
      );
    }
    case "Message":
      return (
        <div
          className="wireframe-message flex flex-col gap-1"
          data-wireframe-message={node.kind}
        >
          <div className="wireframe-message-meta flex flex-wrap items-baseline justify-between gap-2">
            <span>
              {node.author}
              {node.kind === "customer"
                ? " · Customer"
                : node.kind === "agent"
                  ? " · Reply"
                  : " · Internal note"}
            </span>
            <span>{node.time}</span>
          </div>
          <p className="wireframe-text">{node.text}</p>
        </div>
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
            disabled={node.disabled}
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
            disabled={node.disabled}
          />
        </Field>
      );
    case "Select":
      return (
        <Field label={node.label} hint={node.hint}>
          {/* A wireframe shows the chosen option, not the whole menu. */}
          <select
            className="wireframe-input wireframe-select"
            disabled={node.disabled}
          >
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
    case "Rail":
      return (
        <aside className="wireframe-rail flex flex-col gap-4">
          <WireframeElements nodes={node.children} />
        </aside>
      );
    case "Center":
      return (
        <div className="wireframe-center" data-wireframe-measure={node.measure}>
          <div className="wireframe-center-inner flex flex-col gap-4">
            <WireframeElements nodes={node.children} />
          </div>
        </div>
      );
    case "Breadcrumbs":
      return (
        <nav
          className="wireframe-breadcrumbs flex flex-wrap items-center"
          aria-label="Breadcrumb"
        >
          <WireframeElements nodes={node.children} />
        </nav>
      );
    case "Crumb":
      return node.navigateTo === undefined ? (
        <span className="wireframe-crumb" aria-current="page">
          {node.label}
        </span>
      ) : (
        <button
          type="button"
          className="wireframe-crumb wireframe-crumb-link"
          data-wireframe-navigate={node.navigateTo}
        >
          {node.label}
        </button>
      );
    case "Table":
      return (
        <table className="wireframe-table">
          <thead>
            <tr>
              {node.headers.map((header, column) => (
                <th
                  key={column}
                  scope="col"
                  data-wireframe-numeric={String(node.numeric[column] ?? false)}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((row, index) => (
              <tr
                key={index}
                {...(node.selected === index + 1
                  ? { "data-wireframe-selected": "" }
                  : {})}
              >
                {row.map((cell, column) => (
                  <td
                    key={column}
                    data-wireframe-numeric={String(
                      node.numeric[column] ?? false,
                    )}
                  >
                    {cell.tone === undefined ? (
                      cell.text
                    ) : (
                      <span
                        className="wireframe-chip"
                        data-wireframe-tone={cell.tone}
                      >
                        {cell.text}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
  named,
}: {
  readonly screen: WireframeScreen;
  readonly current: boolean;
  // Whether the screen's name is worth drawing. With one screen there is no
  // switcher for it to name and the prose above already said what this is, so
  // printing it again only competes with that.
  readonly named: boolean;
}) => {
  const preset = WIREFRAME_DEVICE_PRESETS[screen.device];
  const desktop = screen.device === "desktop";
  const phone = screen.device === "phone";
  return (
    <section
      className="wireframe-screen"
      aria-label={`${screen.name}, ${preset.label}`}
      data-wireframe-screen={screen.id}
      data-wireframe-device={screen.device}
      {...(current ? { "data-wireframe-current": "" } : {})}
    >
      <div className="wireframe-screen-caption">
        {named ? (
          <span className="wireframe-screen-name">{screen.name}</span>
        ) : (
          <span />
        )}
        <span className="wireframe-screen-viewport">
          {preset.label} · {preset.width}px wide ·{" "}
          {preset.minimumHeight === undefined
            ? "content height"
            : `${preset.minimumHeight}px minimum · grows with content`}
        </span>
      </div>
      <div className="wireframe-frame" data-wireframe-device={screen.device}>
        {desktop ? (
          <div className="wireframe-browser-bar">
            <span className="wireframe-browser-dots" aria-hidden="true" />
            <span className="wireframe-browser-address">
              {screen.url ?? " "}
            </span>
          </div>
        ) : null}
        {!desktop && !phone ? (
          <span className="wireframe-tablet-handle" aria-hidden="true" />
        ) : null}
        {phone ? (
          <span className="wireframe-phone-notch" aria-hidden="true" />
        ) : null}
        <div
          className="wireframe-artboard"
          data-wireframe-device={screen.device}
          {...(screen.pattern === undefined
            ? {}
            : { "data-wireframe-pattern": screen.pattern })}
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
  <figure
    className="wireframe"
    data-wireframe={model.id}
    {...(model.screens.some((screen) => screen.device === "desktop")
      ? { "data-wireframe-desktop": "" }
      : {})}
  >
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
          named={model.screens.length > 1}
        />
      ))}
    </div>
  </figure>
);
