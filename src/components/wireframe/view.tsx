// Renders a compiled Wireframe as a hand-drawn, semantic artboard: every
// screen in authored order, each element as the HTML element it depicts, and
// navigation expressed as data attributes the viewer script acts on. Without
// scripts the block degrades to a readable storyboard of every screen.

import type { JSX, ReactNode } from "react";
import type {
  CompiledWireframe,
  WireframeAlign,
  WireframeHeadingLevel,
  WireframeJustify,
  WireframeNode,
  WireframeScreen,
  WireframeSpace,
  WireframeStatus,
} from "./model.js";
import { WIREFRAME_DEVICE_PRESETS } from "./model.js";
import {
  WIREFRAME_PLACEHOLDER_GLYPH,
  wireframeGlyphFor,
} from "./view-glyphs.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CIRCLE_X_ICON } from "../../icons/lucide/circle-x.js";
import { HOURGLASS_ICON } from "../../icons/lucide/hourglass.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import {
  BODY_ATTRIBUTE,
  MAXIMIZABLE_ATTRIBUTE,
} from "../_model/figure-controls/figure-controls.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";

// /* off-scale */ Phase A preserves the sketch radii, device silhouettes,
// 0.9375rem caption, and hand-drawn primitive metrics exactly. Phase B may
// regularize ordinary chrome while keeping the authored sketch language.

// Token-to-utility maps are written as literals so the stylesheet generator
// sees every class this view can emit.
const GAP_CLASSES: Readonly<Record<WireframeSpace, string>> = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-12",
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

// One mark per status, and a word beside it. The marks are chosen to differ in
// silhouette rather than only in colour, so a reviewer scanning a column of
// them tells the states apart in greyscale, at artboard scale, and without
// reading the labels.
const STATUS_ICONS: Readonly<Record<WireframeStatus, LucideIcon>> = {
  done: CHECK_ICON,
  attention: TRIANGLE_ALERT_ICON,
  waiting: HOURGLASS_ICON,
  blocked: CIRCLE_X_ICON,
};

const StatusMark = ({
  status,
}: {
  readonly status: WireframeStatus;
}): JSX.Element => (
  <span className="wireframe-status-mark" data-wireframe-status={status}>
    {lucideIconToReact({ icon: STATUS_ICONS[status], hidden: false })}
    <span className="sr-only">{`Status: ${status}`}</span>
  </span>
);

const statusMarkFor = (status: WireframeStatus | undefined): ReactNode =>
  status === undefined ? null : <StatusMark status={status} />;

// A named glyph, or the crossed placeholder for a meaning the set does not
// hold. Every icon in the drawing goes through here, so a standalone mark and
// the same mark inside a button can never drift apart.
const Glyph = ({ name }: { readonly name: string }): JSX.Element => {
  const glyph = wireframeGlyphFor(name);
  return (
    <span
      className="wireframe-glyph"
      data-wireframe-icon={name}
      {...(glyph === undefined ? { "data-wireframe-icon-unnamed": "" } : {})}
      aria-hidden="true"
    >
      {lucideIconToReact({
        icon: glyph ?? WIREFRAME_PLACEHOLDER_GLYPH,
        hidden: false,
      })}
      {/* A glyph nobody drew says so, in the words the author asked for.
          Substituting a nearby mark would put a wrong screen in front of a
          reviewer who reads the drawing rather than the source. */}
      {glyph === undefined ? (
        <span className="wireframe-glyph-name">{name}</span>
      ) : null}
    </span>
  );
};

// A direct record collection makes its Panel the master pane. Rail is the only
// authored width primitive; the Row owns every other workspace proportion.
const holdsCollection = (node: WireframeNode): boolean =>
  node.element === "Panel" &&
  node.children.some(
    (child) => child.element === "List" || child.element === "Table",
  );

// Exactly one pane in a row is the collection: the first one. A detail pane
// often holds a list too - properties, context, a checklist - and reading that
// as a second collection is what produces two equally bounded panes with no
// primary surface between them. Reading order decides, because the collection
// is what the reader came through to reach the record.
const masterIndexIn = (children: ReadonlyArray<WireframeNode>): number =>
  children.length > 1 ? children.findIndex(holdsCollection) : -1;

const isWorkspaceRow = (children: ReadonlyArray<WireframeNode>): boolean =>
  children.some((child) => child.element === "Rail") ||
  masterIndexIn(children) >= 0;

// A conversation has two independently behaving regions behind the ordinary
// Panel interface: the thread scrolls, while the mode and composer stay
// anchored. Authors only arrange the familiar message and control primitives.
const conversationPartsFor = (
  children: ReadonlyArray<WireframeNode>,
):
  | {
      readonly thread: ReadonlyArray<WireframeNode>;
      readonly composer: ReadonlyArray<WireframeNode>;
    }
  | undefined => {
  const composerIndex = children.findIndex(
    (child) => child.element === "SegmentedControl",
  );
  if (
    composerIndex < 0 ||
    !children
      .slice(0, composerIndex)
      .some((child) => child.element === "Message")
  ) {
    return undefined;
  }
  return {
    thread: children.slice(0, composerIndex),
    composer: children.slice(composerIndex),
  };
};

const WireframeElement = ({
  node,
  isMasterPane = false,
}: {
  readonly node: WireframeNode;
  // Set only by the Row that owns this pane, because whether a panel is the
  // collection is a fact about its siblings, not about the panel alone.
  readonly isMasterPane?: boolean;
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
          <WireframeElements
            nodes={node.children}
            masterIndex={masterIndexIn(node.children)}
          />
        </div>
      );
    case "Group":
      return (
        <div
          className={`wireframe-group flex flex-wrap ${GAP_CLASSES[node.gap]} ${ALIGN_CLASSES[node.align]}`}
        >
          <WireframeElements nodes={node.children} />
        </div>
      );
    case "Panel": {
      const conversation = conversationPartsFor(node.children);
      return (
        <section
          className="wireframe-panel relative"
          data-wireframe-surface={node.surface}
          {...(isMasterPane ? { "data-wireframe-master": "" } : {})}
        >
          {node.eyebrow === undefined && node.title === undefined ? null : (
            <header className="wireframe-panel-head">
              {node.eyebrow === undefined ? null : (
                <p className="wireframe-eyebrow">{node.eyebrow}</p>
              )}
              {node.title === undefined ? null : (
                <h4 className="wireframe-panel-title flex min-w-0 items-center gap-2">
                  {statusMarkFor(node.status)}
                  <span className="min-w-0">{node.title}</span>
                </h4>
              )}
            </header>
          )}
          <div
            className="wireframe-panel-body flex flex-col gap-3"
            {...(conversation === undefined
              ? {}
              : { "data-wireframe-conversation": "" })}
          >
            {conversation === undefined ? (
              <WireframeElements nodes={node.children} />
            ) : (
              <>
                <div className="wireframe-thread flex flex-col gap-3">
                  <WireframeElements nodes={conversation.thread} />
                </div>
                <div className="wireframe-composer flex flex-col gap-3">
                  <WireframeElements nodes={conversation.composer} />
                </div>
              </>
            )}
          </div>
        </section>
      );
    }
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
          {...(node.icon === undefined
            ? {}
            : { "data-wireframe-has-icon": "" })}
          {...(node.iconOnly
            ? // An icon-only control keeps its words where the product keeps
              // them: as the accessible name and the hover tooltip. Hiding the
              // label from the drawing never hides it from the reader.
              {
                "data-wireframe-icon-only": "",
                "aria-label": node.label,
                title: node.label,
              }
            : {})}
          {...(node.navigateTo === undefined
            ? {}
            : { "data-wireframe-navigate": node.navigateTo })}
        >
          {node.icon === undefined ? null : <Glyph name={node.icon} />}
          {node.iconOnly ? null : (
            <span className="wireframe-button-label">{node.label}</span>
          )}
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
          {/* A product's top bar names where the reader is on the left and
              keeps its controls on the right; clustering everything against
              the title is the one arrangement no real application uses.
              Authors who want a different split write Groups inside a Row. */}
          <div className="wireframe-top-bar-actions ml-auto flex flex-wrap items-center gap-2">
            <WireframeElements nodes={node.children} />
          </div>
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
        <header className="wireframe-page-header flex w-full flex-wrap items-center justify-between gap-3">
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
          <div className="wireframe-page-header-actions ml-auto flex flex-wrap gap-2">
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
    case "Overlay":
      return (
        <div
          className="wireframe-overlay absolute inset-0 flex items-center justify-center"
          data-wireframe-overlay={node.kind}
          data-wireframe-backdrop={node.backdrop}
        >
          <div
            className="wireframe-overlay-surface flex flex-col gap-3"
            role={node.kind === "alert" ? "alertdialog" : "dialog"}
            aria-modal="true"
            {...(node.title === undefined ? {} : { "aria-label": node.title })}
          >
            {node.title === undefined ? null : (
              <h4 className="wireframe-overlay-title flex min-w-0 items-center gap-2">
                {node.kind === "alert" ? (
                  <span className="wireframe-overlay-mark" aria-hidden="true">
                    {lucideIconToReact({
                      icon: TRIANGLE_ALERT_ICON,
                      hidden: false,
                    })}
                  </span>
                ) : null}
                <span className="min-w-0">{node.title}</span>
              </h4>
            )}
            <WireframeElements nodes={node.children} />
          </div>
        </div>
      );
    case "Icon":
      return (
        <span
          className="wireframe-icon"
          data-wireframe-size={node.size}
          {...(node.labelled ? { "data-wireframe-labelled": "" } : {})}
        >
          <Glyph name={node.name} />
          {node.labelled ? (
            <span className="wireframe-icon-label">{node.label}</span>
          ) : (
            <span className="sr-only">{node.label}</span>
          )}
        </span>
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
    case "ChoiceGroup":
      return (
        <div
          className="wireframe-choice-group flex flex-col"
          role="radiogroup"
          aria-label="Choose one"
        >
          <WireframeElements nodes={node.children} />
        </div>
      );
    case "ChoiceCard":
      return (
        <button
          type="button"
          className="wireframe-choice-card"
          role="radio"
          aria-checked={node.selected}
          {...(node.selected ? { "data-wireframe-selected": "" } : {})}
          {...(node.navigateTo === undefined
            ? {}
            : { "data-wireframe-navigate": node.navigateTo })}
        >
          <span className="wireframe-choice-icon" aria-hidden="true">
            {node.icon}
          </span>
          <span className="wireframe-choice-copy">
            <span className="wireframe-choice-title">{node.title}</span>
            <span className="wireframe-choice-description">
              {node.description}
            </span>
          </span>
          <span className="wireframe-choice-state" aria-hidden="true">
            <span className="wireframe-choice-radio" />
            <span className="wireframe-choice-check">
              {node.selected ? "✓" : ""}
            </span>
          </span>
        </button>
      );
    case "ListItem": {
      // Every queue/inbox row is two lines so a narrow desktop list column never
      // jams title, status, and age onto one flex line (which overflows as
      // overlapping or one-word-per-line wrapping):
      //   line 1 - truncating title [trailing value, when the row has no
      //            second line to carry it]
      //   line 2 - metadata [trailing value]
      // The trailing value rides with the metadata whenever there is metadata,
      // because a title competing with a timestamp for one narrow line is what
      // truncates the only words that identify the record.
      const valueOnMetaLine =
        node.meta !== undefined && node.value !== undefined;
      const value =
        node.value === undefined ? null : (
          <span className="wireframe-list-value">{node.value}</span>
        );
      const rowInner = (
        <>
          <span className="wireframe-list-row-primary flex w-full min-w-0 flex-nowrap items-baseline gap-2">
            {statusMarkFor(node.status)}
            <span className="wireframe-list-label grow">{node.label}</span>
            {valueOnMetaLine ? null : value}
          </span>
          {node.meta === undefined ? null : (
            <span className="wireframe-list-row-secondary flex w-full min-w-0 flex-nowrap items-baseline justify-between gap-2">
              <span className="wireframe-list-meta">{node.meta}</span>
              {valueOnMetaLine ? value : null}
            </span>
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
  masterIndex = -1,
}: {
  readonly nodes: ReadonlyArray<WireframeNode>;
  readonly masterIndex?: number;
}) => (
  <>
    {nodes.map((node, index) => (
      <WireframeElement
        key={index}
        node={node}
        isMasterPane={index === masterIndex}
      />
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
  const preset = WIREFRAME_DEVICE_PRESETS[screen.device];
  const desktop = screen.device === "desktop";
  const phone = screen.device === "phone";
  const workspaceViewport =
    desktop && screen.children.some((child) => child.element === "AppShell");
  return (
    <figure
      className="wireframe-screen mx-auto w-full overflow-x-auto [container-type:inline-size]"
      data-wireframe-screen={screen.id}
      data-wireframe-device={screen.device}
      {...(current ? { "data-wireframe-current": "" } : {})}
    >
      <div className="wireframe-frame-card mx-auto block w-fit">
        <div
          className="wireframe-frame box-border w-[var(--wf-outer)] overflow-hidden [zoom:1]"
          data-wireframe-device={screen.device}
        >
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
            data-wireframe-height-policy={preset.heightPolicy}
            {...(screen.pattern === undefined
              ? {}
              : { "data-wireframe-pattern": screen.pattern })}
          >
            <div className="wireframe-canvas flex flex-col gap-4">
              <WireframeElements nodes={screen.children} />
            </div>
          </div>
        </div>
      </div>
      {/* The caption reads after the drawing it names, as a figure's caption
          does: the reader looks at the screen, then learns what it is. It is a
          direct child of the screen's own `<figure>` so the caption/figure
          relationship is the one HTML already defines, rather than a styled
          div a screen reader has to infer. The name leads on its own line and
          the viewport note follows as a subordinate second line, because two
          facts of unequal weight on one row read as one run-on label. Every
          screen carries it, including a lone screen: a drawing with no name
          under it is a drawing the reader has to name from context.

          The fit module pins this element's width to the frame's painted
          width, so both lines wrap inside the frame instead of running past
          its edge. */}
      <figcaption className="wireframe-screen-caption mx-auto mt-3 w-full text-sm">
        <span className="wireframe-screen-name wireframe-screen-title block break-words">
          {screen.name}
        </span>
        <span className="wireframe-screen-viewport mt-1 block break-words text-xs text-muted">
          {preset.label} · {preset.width} × {preset.height}px{" "}
          {workspaceViewport
            ? "workspace viewport"
            : preset.heightPolicy === "fixed"
              ? "fixed frame"
              : "minimum · grows with content"}
        </span>
      </figcaption>
    </figure>
  );
};

export const Wireframe = ({ model }: { readonly model: CompiledWireframe }) => (
  <figure
    className="wireframe my-8"
    data-wireframe={model.id}
    {...{ [MAXIMIZABLE_ATTRIBUTE]: "wireframe" }}
    {...(model.screens.some((screen) => screen.device === "desktop")
      ? { "data-wireframe-desktop": "" }
      : {})}
  >
    <div className="wireframe-header flex w-full flex-wrap items-center gap-3">
      {model.title === undefined ? null : (
        <figcaption className="wireframe-caption wireframe-figure-title text-sm font-semibold text-ink">
          {model.title}
        </figcaption>
      )}
      <div className="figure-control-bar wireframe-toolbar ml-auto flex shrink-0 items-center gap-2">
        <MaximizeButton subject="wireframe" />
      </div>
    </div>
    <div className="wireframe-content" {...{ [BODY_ATTRIBUTE]: "" }}>
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
      <div className="wireframe-screens flex flex-col gap-6">
        {model.screens.map((screen) => (
          <Screen
            key={screen.id}
            screen={screen}
            current={screen.id === model.initialScreenId}
          />
        ))}
      </div>
    </div>
  </figure>
);
