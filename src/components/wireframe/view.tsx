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
import { MAXIMIZABLE_ATTRIBUTE } from "../_model/figure-controls/figure-controls.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";

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

type WireframeTargetContext = {
  readonly prefix: string;
  readonly path: string;
};

const safeTargetSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "element";

const nodeLabel = (node: WireframeNode): string => {
  switch (node.element) {
    case "Panel":
      return node.title ?? node.eyebrow ?? "Panel";
    case "Heading":
    case "Text":
      return node.text;
    case "Button":
    case "NavItem":
    case "Crumb":
    case "Step":
    case "Badge":
      return node.label;
    case "Metric":
      return `${node.label}: ${node.value}`;
    case "Progress":
      return node.label ?? "Progress";
    case "ListItem":
      return node.label;
    case "Message":
      return `${node.author}: ${node.text}`;
    case "TextField":
    case "TextArea":
    case "Select":
    case "Checkbox":
    case "Switch":
      return node.label;
    case "PageHeader":
      return node.title;
    case "TopBar":
      return node.title ?? "Top bar";
    case "Sidebar":
      return node.brand ?? "Sidebar";
    case "ImagePlaceholder":
      return node.label;
    case "Divider":
      return node.label ?? "Divider";
    case "Nav":
      return node.label ?? "Navigation";
    case "Table":
      return node.headers.join(", ");
    default:
      return node.element.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
};

// Wireframe targets use the page commenting model's exact block contract.
// Screen ids and element paths make the address stable across copy edits, and
// the marker keeps component-specific behavior discoverable without creating
// a second draft store or transport.
const targetProps = ({
  node,
  context,
}: {
  readonly node: WireframeNode;
  readonly context: WireframeTargetContext;
}) => ({
  "data-block-anchor": `screen-${context.prefix}-element-${context.path}`,
  "data-block-kind": `wireframe-${safeTargetSegment(node.element)}`,
  "data-block-label": nodeLabel(node),
  "data-flow-anchor": `screen-${context.prefix}-element-${context.path}`,
  "data-flow-element": "review-target",
  "data-flow-name": nodeLabel(node),
  "data-wireframe-element": node.element,
});

// A workspace row is a stable pane system, not a card grid. Its list, main,
// and rail children must stay beside one another; ordinary fill rows may wrap.
const keepsWorkspacePanes = (children: ReadonlyArray<WireframeNode>): boolean =>
  children.some(
    (child) =>
      (child.element === "Panel" || child.element === "Stack") &&
      child.span !== "fill",
  );

const WireframeElement = ({
  node,
  context,
}: {
  readonly node: WireframeNode;
  readonly context: WireframeTargetContext;
}): JSX.Element => {
  const commentTarget = targetProps({ node, context });
  switch (node.element) {
    case "Stack":
      return (
        <div
          className={`wireframe-stack flex flex-col ${GAP_CLASSES[node.gap]} ${ALIGN_CLASSES[node.align]}`}
          data-wireframe-span={node.span}
          {...commentTarget}
        >
          <WireframeElements nodes={node.children} context={context} />
        </div>
      );
    case "Row":
      return (
        <div
          className={`wireframe-row flex ${keepsWorkspacePanes(node.children) ? "flex-nowrap" : "flex-wrap"} ${GAP_CLASSES[node.gap]} ${ALIGN_CLASSES[node.align]} ${JUSTIFY_CLASSES[node.justify]}`}
          {...commentTarget}
        >
          <WireframeElements nodes={node.children} context={context} />
        </div>
      );
    case "Panel":
      return (
        <section
          className="wireframe-panel"
          data-wireframe-span={node.span}
          data-wireframe-surface={node.surface}
          {...commentTarget}
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
            <WireframeElements nodes={node.children} context={context} />
          </div>
        </section>
      );
    case "Heading": {
      const Tag = HEADING_TAGS[node.level];
      return (
        <Tag className="wireframe-heading" {...commentTarget}>
          {node.text}
        </Tag>
      );
    }
    case "Text":
      return (
        <p
          className="wireframe-text"
          data-wireframe-role={node.role}
          {...commentTarget}
        >
          {node.text}
        </p>
      );
    case "Button":
      return (
        <button
          type="button"
          className="wireframe-button"
          data-wireframe-emphasis={node.emphasis}
          {...commentTarget}
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
          {...commentTarget}
        >
          <WireframeElements nodes={node.children} context={context} />
        </div>
      );
    case "AppShell":
      return (
        <div className="wireframe-app-shell" {...commentTarget}>
          <WireframeElements nodes={node.children} context={context} />
        </div>
      );
    case "Sidebar":
      return (
        <div
          className="wireframe-sidebar flex flex-col gap-3"
          {...commentTarget}
        >
          {node.brand === undefined ? null : (
            <p className="wireframe-brand">{node.brand}</p>
          )}
          {node.mode === undefined ? null : (
            <p className="wireframe-eyebrow">{node.mode}</p>
          )}
          <WireframeElements nodes={node.children} context={context} />
        </div>
      );
    case "AppContent":
      return (
        <div
          className="wireframe-app-content flex flex-col gap-4"
          {...commentTarget}
        >
          <WireframeElements nodes={node.children} context={context} />
        </div>
      );
    case "TopBar":
      return (
        <div
          className="wireframe-top-bar flex flex-wrap items-center gap-3"
          {...commentTarget}
        >
          {node.title === undefined ? null : (
            <p className="wireframe-brand">{node.title}</p>
          )}
          <WireframeElements nodes={node.children} context={context} />
        </div>
      );
    case "BottomBar":
      return (
        <div
          className="wireframe-bottom-bar flex flex-nowrap items-center justify-between gap-2"
          role="navigation"
          aria-label="Primary destinations"
          {...commentTarget}
        >
          <WireframeElements nodes={node.children} context={context} />
        </div>
      );
    case "PageHeader":
      return (
        <header
          className="wireframe-page-header flex flex-wrap items-center gap-3"
          {...commentTarget}
        >
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
            <WireframeElements nodes={node.children} context={context} />
          </div>
        </header>
      );
    case "Nav":
      return (
        <nav
          className="wireframe-nav flex flex-col gap-1"
          {...(node.label === undefined ? {} : { "aria-label": node.label })}
          {...commentTarget}
        >
          <WireframeElements nodes={node.children} context={context} />
        </nav>
      );
    case "NavItem":
      return (
        <button
          type="button"
          className="wireframe-nav-item"
          {...commentTarget}
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
        <div className="wireframe-metric flex flex-col" {...commentTarget}>
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
        <div
          className="wireframe-progress flex flex-col gap-1"
          {...commentTarget}
        >
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
        <span
          className="wireframe-badge"
          data-wireframe-tone={node.tone}
          {...commentTarget}
        >
          {node.label}
        </span>
      );
    case "Divider":
      return node.label === undefined ? (
        <hr className="wireframe-divider" {...commentTarget} />
      ) : (
        <div
          className="wireframe-divider-labeled flex items-center gap-2"
          {...commentTarget}
        >
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
          {...commentTarget}
        >
          <span className="wireframe-image-label">{node.label}</span>
        </div>
      );
    case "List":
      return (
        <ul className="wireframe-list flex flex-col" {...commentTarget}>
          <WireframeElements nodes={node.children} context={context} />
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
            {...commentTarget}
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
          {...commentTarget}
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
          {...commentTarget}
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
        <Field
          label={node.label}
          hint={node.hint}
          commentTarget={commentTarget}
        >
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
        <Field
          label={node.label}
          hint={node.hint}
          commentTarget={commentTarget}
        >
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
        <Field
          label={node.label}
          hint={node.hint}
          commentTarget={commentTarget}
        >
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
        <Field
          label={node.label}
          hint={node.hint}
          inline
          commentTarget={commentTarget}
        >
          <input
            className="wireframe-tick"
            type="checkbox"
            defaultChecked={node.checked}
          />
        </Field>
      );
    case "Switch":
      return (
        <Field
          label={node.label}
          hint={node.hint}
          inline
          commentTarget={commentTarget}
        >
          <>
            <input
              className="wireframe-switch-control"
              type="checkbox"
              role="switch"
              defaultChecked={node.on}
            />
            <span className="wireframe-switch-state" aria-hidden="true">
              <span data-wireframe-switch-on="">On</span>
              <span data-wireframe-switch-off="">Off</span>
            </span>
          </>
        </Field>
      );
    case "Stepper":
      return (
        <ol
          className="wireframe-stepper flex flex-wrap items-center"
          {...commentTarget}
        >
          <WireframeElements nodes={node.children} context={context} />
        </ol>
      );
    case "Step":
      return (
        <li
          className="wireframe-step"
          data-wireframe-step={node.state}
          {...commentTarget}
        >
          {node.label}
        </li>
      );
    case "Rail":
      return (
        <aside
          className="wireframe-rail flex flex-col gap-4"
          {...commentTarget}
        >
          <WireframeElements nodes={node.children} context={context} />
        </aside>
      );
    case "Center":
      return (
        <div
          className="wireframe-center"
          data-wireframe-measure={node.measure}
          {...commentTarget}
        >
          <div className="wireframe-center-inner flex flex-col gap-4">
            <WireframeElements nodes={node.children} context={context} />
          </div>
        </div>
      );
    case "Breadcrumbs":
      return (
        <nav
          className="wireframe-breadcrumbs flex flex-wrap items-center"
          aria-label="Breadcrumb"
          {...commentTarget}
        >
          <WireframeElements nodes={node.children} context={context} />
        </nav>
      );
    case "Crumb":
      return node.navigateTo === undefined ? (
        <span
          className="wireframe-crumb"
          aria-current="page"
          {...commentTarget}
        >
          {node.label}
        </span>
      ) : (
        <button
          type="button"
          className="wireframe-crumb wireframe-crumb-link"
          data-wireframe-navigate={node.navigateTo}
          {...commentTarget}
        >
          {node.label}
        </button>
      );
    case "Table":
      return (
        <table className="wireframe-table" {...commentTarget}>
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
          {...commentTarget}
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
  commentTarget,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly inline?: boolean;
  readonly commentTarget: ReturnType<typeof targetProps>;
  readonly children: JSX.Element;
}) => (
  <label
    className="wireframe-field"
    data-wireframe-inline={String(inline)}
    {...commentTarget}
  >
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
  context,
}: {
  readonly nodes: ReadonlyArray<WireframeNode>;
  readonly context: WireframeTargetContext;
}) => (
  <>
    {nodes.map((node, index) => (
      <WireframeElement
        key={index}
        node={node}
        context={{
          prefix: context.prefix,
          path: `${context.path}-${index + 1}`,
        }}
      />
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
  const phone = screen.device === "phone";
  const desktop = screen.device === "desktop";
  const tablet =
    screen.device === "tablet" || screen.device === "tablet-portrait";
  return (
    <section
      className="wireframe-screen"
      aria-label={`${screen.name}, ${preset.label}`}
      data-wireframe-screen={screen.id}
      data-wireframe-device={screen.device}
      data-block-anchor={`screen-${safeTargetSegment(screen.id)}`}
      data-block-kind="wireframe-screen"
      data-block-label={screen.name}
      {...(current ? { "data-wireframe-current": "" } : {})}
    >
      <div className="wireframe-screen-caption">
        {named ? (
          <span className="wireframe-screen-name">{screen.name}</span>
        ) : (
          <span />
        )}
        <span className="wireframe-screen-viewport">
          {preset.label} · {preset.width}×{preset.height}px ·{" "}
          {preset.heightMode === "viewport"
            ? "fixed viewport · content scrolls inside"
            : screen.device === "desktop"
              ? "viewport reference · workspace may scroll inside"
              : "minimum height · grows with content"}
        </span>
      </div>
      <div className="wireframe-screen-comment-area">
        <button
          type="button"
          className="wireframe-screen-comment-button"
          data-wireframe-comment-screen=""
          hidden
        >
          Comment on this screen
        </button>
      </div>
      <div className="wireframe-frame-stage">
        <div className="wireframe-frame-toolbar">
          <div
            className="wireframe-zoom-controls"
            aria-label="Wireframe zoom"
            hidden
            data-wireframe-zoom-controls=""
          >
            <button
              type="button"
              className="wireframe-zoom-button"
              aria-label="Zoom wireframe out"
              data-wireframe-zoom-out=""
            >
              −
            </button>
            <span className="wireframe-zoom-label" aria-live="polite">
              Fit
            </span>
            <button
              type="button"
              className="wireframe-zoom-button"
              aria-label="Zoom wireframe in"
              data-wireframe-zoom-in=""
            >
              +
            </button>
          </div>
          <MaximizeButton subject="wireframe" />
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
          {tablet ? (
            <span className="wireframe-tablet-camera" aria-hidden="true" />
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
              <WireframeElements
                nodes={screen.children}
                context={{
                  prefix: safeTargetSegment(screen.id),
                  path: "root",
                }}
              />
            </div>
          </div>
          {tablet ? (
            <span
              className="wireframe-tablet-home-indicator"
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>
    </section>
  );
};

export const Wireframe = ({ model }: { readonly model: CompiledWireframe }) => (
  <figure
    className="wireframe"
    data-flow-diagram=""
    data-flow-comment-only=""
    data-flow-scope={model.title ?? model.id}
    data-feedback-source="wireframe"
    data-wireframe={model.id}
    {...{ [MAXIMIZABLE_ATTRIBUTE]: "wireframe" }}
    {...(model.screens.some((screen) => screen.device === "desktop")
      ? { "data-wireframe-desktop": "" }
      : {})}
  >
    <figcaption className="wireframe-caption">
      {model.title === undefined ? null : (
        <span className="wireframe-caption-label">{model.title}</span>
      )}
    </figcaption>
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
    <div className="wireframe-screens" data-figure-body="">
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
