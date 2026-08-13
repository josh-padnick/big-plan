// Owns the What-changed lens shared by comment threads and plan-wide chat. It
// portals interaction chrome beside the server-rendered block without taking
// ownership of plan content.

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { INFO_ICON } from "../../icons/lucide/info.js";
import { LIGHTBULB_ICON } from "../../icons/lucide/lightbulb.js";
import { OCTAGON_ALERT_ICON } from "../../icons/lucide/octagon-alert.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import type {
  BlockPresentation,
  DiffLocation,
  DiffPlace,
  DiffRun,
  SnapshotDiff,
} from "../shared/review-wire.js";
import type { LensPlacement } from "./diff-anchor.js";
import { Icon } from "./icon.browser.js";
import {
  foundElement,
  LENS_STAND_IN_ATTRIBUTE,
  liveBlock,
  liveLensAnchor,
} from "./live-target.browser.js";
import { useArticleVersion } from "./use-article-version.browser.js";

const placeLocations = ({
  diff,
  place,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
}): ReadonlyArray<DiffLocation> =>
  place.locationIndexes.flatMap((index) => {
    const location = diff.locations.at(index);
    return location === undefined ? [] : [location];
  });

const runsWithChanges = (runs: ReadonlyArray<DiffRun>): ReactNode =>
  runs.map((run, index) => {
    if (run.op === "same") return <span key={index}>{run.text}</span>;
    if (run.op === "del") {
      return (
        <del
          key={index}
          className="rounded-sm bg-[var(--diff-remove-bg)] px-0.5 text-[var(--diff-remove-c)] decoration-2"
        >
          {run.text}
        </del>
      );
    }
    return (
      <ins
        key={index}
        className="rounded-sm bg-[var(--diff-add-bg)] px-0.5 font-medium text-[var(--diff-add-c)] no-underline"
      >
        {run.text}
      </ins>
    );
  });

const sideText = (location: DiffLocation, side: "old" | "new"): string =>
  side === "old" ? location.oldText : location.newText;

// Each side replays the meaning-bearing presentation facts its own snapshot
// recorded on the wire. The live document can answer only for a block it still
// contains - and then only with the current side's facts - so the lens never
// asks it; an absent fact renders neutrally instead of as a guessed default.
const sidePresentation = (
  location: DiffLocation,
  side: "old" | "new",
): BlockPresentation | undefined =>
  side === "old" ? location.oldPresentation : location.newPresentation;

const listPresentationChanged = (location: DiffLocation): boolean =>
  location.oldPresentation?.aspect === "list" &&
  location.newPresentation?.aspect === "list" &&
  location.oldPresentation.isOrdered !== location.newPresentation.isOrdered;

// The field-bearing components: each declares its reviewable fields as
// sub-targets of this kind, and when a field changed the fields own the
// presentation, so the owning root kind on the right is suppressed instead of
// restating the whole card as one text wall.
const COMPONENT_FIELD_KINDS: Readonly<Record<string, string>> = {
  "quick-summary-facet": "quick-summary",
  "http-endpoint-field": "http-endpoint",
  "graphql-operation-field": "graphql-operation",
  "grpc-method-field": "grpc-method",
  "database-table-schema-field": "database-table-schema",
};

// A block that declares sub-targets deliberately overlaps with them for
// attribution: a table with its rows, columns, and cells, and a component
// root with its declared internals. A presentation must choose one
// non-overlapping level or it repeats the same text several times, so rows
// win over every other table identity and declared internals win over the
// component root that contains them.
const presentationLocations = (
  locations: ReadonlyArray<DiffLocation>,
): ReadonlyArray<DiffLocation> => {
  let visible = locations;
  if (visible.some((location) => location.kind === "table-row")) {
    visible = visible.filter(
      (location) =>
        location.kind !== "table" &&
        location.kind !== "data-table" &&
        location.kind !== "table-column" &&
        location.kind !== "table-cell",
    );
  }
  for (const [fieldKind, ownerKind] of Object.entries(COMPONENT_FIELD_KINDS)) {
    if (visible.some((location) => location.kind === fieldKind)) {
      visible = visible.filter((location) => location.kind !== ownerKind);
    }
  }
  return visible;
};

type ProsePresentation =
  | "paragraph"
  | "lede"
  | "quote"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6";

const prosePresentationFor = (
  anchor: HTMLElement,
): ProsePresentation | undefined => {
  const tag = anchor.tagName.toLocaleLowerCase();
  if (/^h[1-6]$/u.test(tag)) {
    return `heading-${tag.slice(1)}` as ProsePresentation;
  }
  if (tag === "blockquote") return "quote";
  if (tag !== "p") return undefined;
  return anchor.previousElementSibling?.matches("h1[data-authored-prose]") ===
    true
    ? "lede"
    : "paragraph";
};

const WordRunContent = ({
  runs,
  presentation,
}: {
  readonly runs: ReadonlyArray<DiffRun>;
  readonly presentation?: ProsePresentation;
}) => {
  const content = runsWithChanges(runs);
  const properties = {
    className: "m-0 max-w-[var(--measure)] [overflow-wrap:anywhere]",
    "data-authored-prose": "",
    "data-review-diff-content": "",
    "data-review-diff-presentation": presentation ?? "paragraph",
  } as const;
  switch (presentation) {
    case "heading-1":
      return <h1 {...properties}>{content}</h1>;
    case "heading-2":
      return <h2 {...properties}>{content}</h2>;
    case "heading-3":
      return <h3 {...properties}>{content}</h3>;
    case "heading-4":
      return <h4 {...properties}>{content}</h4>;
    case "heading-5":
      return <h5 {...properties}>{content}</h5>;
    case "heading-6":
      return <h6 {...properties}>{content}</h6>;
    case "quote":
      return <blockquote {...properties}>{content}</blockquote>;
    default:
      return <p {...properties}>{content}</p>;
  }
};

/** Preserves list-item boundaries while reusing the centralized word diff. */
const runsByLine = (
  runs: ReadonlyArray<DiffRun>,
): ReadonlyArray<ReadonlyArray<DiffRun>> => {
  const lines: Array<Array<DiffRun>> = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, index) => {
      if (part !== "") lines.at(-1)?.push({ ...run, text: part });
      if (index < parts.length - 1) lines.push([]);
    });
  }
  return lines.filter((line) => line.some((run) => run.text.trim() !== ""));
};

// The list container for diffed list content. Ordering is a meaning-bearing
// authored fact carried per side on the wire: an unknown fact renders a
// marker-free list, because bullets and numbers each assert a claim about
// sequence that nothing recorded.
const DiffList = ({
  presentation,
  children,
}: {
  readonly presentation: BlockPresentation | undefined;
  readonly children: ReactNode;
}) => {
  if (presentation?.aspect === "list") {
    const List = presentation.isOrdered ? "ol" : "ul";
    return (
      <List data-authored-prose="" data-review-diff-content="">
        {children}
      </List>
    );
  }
  return (
    <ul
      className="list-none"
      data-authored-prose=""
      data-review-diff-content=""
    >
      {children}
    </ul>
  );
};

const ListRunContent = ({
  runs,
  location,
}: {
  readonly runs: ReadonlyArray<DiffRun>;
  readonly location: DiffLocation;
}) => (
  // The merged word-run view shows one list for both sides, so it carries the
  // Now side's ordering - the plan the reader is accepting - and falls back to
  // the Was side's only when the new fact is absent.
  <DiffList presentation={location.newPresentation ?? location.oldPresentation}>
    {runsByLine(runs).map((line, index) => (
      <li
        key={`${index}-${line.map((run) => run.text).join("")}`}
        data-authored-prose=""
      >
        {runsWithChanges(line)}
      </li>
    ))}
  </DiffList>
);

const SnapshotTable = ({
  rows,
  side,
}: {
  readonly rows: ReadonlyArray<DiffLocation>;
  readonly side: "old" | "new";
}) => (
  <div className="max-w-full min-w-0 overflow-hidden">
    <table
      className={`w-full table-fixed ${
        side === "old"
          ? "[&_th]:bg-[color-mix(in_srgb,var(--diff-remove-c)_18%,var(--diff-remove-bg))]"
          : "[&_th]:bg-[color-mix(in_srgb,var(--diff-add-c)_18%,var(--diff-add-bg))]"
      }`}
      data-authored-prose=""
      data-review-diff-table=""
    >
      {(() => {
        const headers = rows.find((row) =>
          side === "old"
            ? row.oldTableHeaders !== undefined
            : row.newTableHeaders !== undefined,
        );
        const labels =
          side === "old" ? headers?.oldTableHeaders : headers?.newTableHeaders;
        return labels === undefined ? null : (
          <thead data-authored-prose="">
            <tr data-authored-prose="">
              {labels.map((label) => (
                <th key={label} data-authored-prose="">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
        );
      })()}
      <tbody data-authored-prose="">
        {rows
          .filter((row) => !row.isTableHeader)
          .map((row, rowIndex) => {
            const cells = sideText(row, side).trim().split(/\n+/u);
            return (
              <tr key={`${row.scope}-${rowIndex}`} data-authored-prose="">
                {cells.map((cell, cellIndex) => {
                  return (
                    <td
                      key={`${cellIndex}-${cell}`}
                      className="min-w-0 [overflow-wrap:anywhere]"
                      data-authored-prose=""
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            );
          })}
      </tbody>
    </table>
  </div>
);

type SnapshotCalloutType = "note" | "tip" | "warning" | "danger";

const SNAPSHOT_CALLOUT_ICONS = {
  note: INFO_ICON,
  tip: LIGHTBULB_ICON,
  warning: TRIANGLE_ALERT_ICON,
  danger: OCTAGON_ALERT_ICON,
} satisfies Readonly<Record<SnapshotCalloutType, LucideIcon>>;

const SnapshotCallout = ({
  location,
  side,
}: {
  readonly location: DiffLocation;
  readonly side: "old" | "new";
}) => {
  const presentation = sidePresentation(location, side);
  const type: SnapshotCalloutType | undefined =
    presentation?.aspect === "callout" ? presentation.calloutType : undefined;
  const title = location.label.trim() || "Callout";
  const text = sideText(location, side).trim();
  const body = text.startsWith(title) ? text.slice(title.length).trim() : text;
  return (
    // An unknown kind renders neutrally - no kind attribute, no kind icon,
    // edge-toned accents - because asserting "note" would misstate the risk
    // the authored callout may have claimed.
    <aside
      className={`callout mb-0 max-w-[var(--measure)] rounded-r-md border-l-4 px-4 py-3 ${
        type === undefined ? "border-edge bg-surface text-ink" : ""
      }`}
      {...(type === undefined ? {} : { "data-callout": type })}
      data-review-diff-callout=""
    >
      <header className="callout-header mb-2 flex items-center gap-2 font-semibold text-[var(--callout-accent)] [&_svg]:size-4 [&_svg]:shrink-0">
        {type === undefined ? null : (
          <Icon icon={SNAPSHOT_CALLOUT_ICONS[type]} />
        )}
        <span className="callout-title text-sm leading-5">{title}</span>
      </header>
      <div className="callout-body text-[var(--callout-ink)]">
        <p className="m-0" data-authored-prose="">
          {body}
        </p>
      </div>
    </aside>
  );
};

// The words a field's body repeats from its label: a plain label repeats
// itself ("Why"), while a prefixed label repeats only its subject
// ("Column: user_id" opens with "user_id").
const fieldTermOf = (label: string): string => {
  const trimmed = label.trim();
  const separator = trimmed.indexOf(": ");
  return separator < 0 ? trimmed : trimmed.slice(separator + 2).trim();
};

// A field's flattened text leads with the words its own label already names,
// so that lead is stripped before the body is shown under the label header.
const fieldBodyText = (location: DiffLocation, side: "old" | "new"): string => {
  const term = fieldTermOf(location.label);
  const raw = sideText(location, side).trim();
  return raw.startsWith(term) ? raw.slice(term.length).trim() : raw;
};

const FieldTerm = ({ location }: { readonly location: DiffLocation }) => (
  <strong className="mb-1 block text-2xs font-semibold uppercase tracking-caps">
    {location.label.trim()}
  </strong>
);

const SnapshotFieldBlock = ({
  location,
  side,
}: {
  readonly location: DiffLocation;
  readonly side: "old" | "new";
}) => {
  const body = fieldBodyText(location, side);
  const items = body
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return (
    <div data-review-diff-field="">
      <FieldTerm location={location} />
      {items.length > 1 ? (
        <ul className="m-0 list-disc pl-4" data-authored-prose="">
          {items.map((item, index) => (
            <li key={`${index}-${item}`} data-authored-prose="">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0" data-authored-prose="">
          {body}
        </p>
      )}
    </div>
  );
};

/** Drops the field term the header already names from the leading run. */
const runsWithoutLeadingTerm = (
  runs: ReadonlyArray<DiffRun>,
  term: string,
): ReadonlyArray<DiffRun> => {
  const [first, ...rest] = runs;
  if (first === undefined || first.op !== "same") return runs;
  const text = first.text.trimStart();
  if (!text.startsWith(term)) return runs;
  const remainder = text.slice(term.length).trimStart();
  return remainder === "" ? rest : [{ op: "same", text: remainder }, ...rest];
};

// The word-level lens for one reworded field: the field's label stays a calm
// header while the body carries the exact removed and inserted words, with
// authored line boundaries preserved so multi-line fields read as their lines.
const FieldRunContent = ({
  runs,
  location,
}: {
  readonly runs: ReadonlyArray<DiffRun>;
  readonly location: DiffLocation;
}) => (
  <div data-review-diff-field="">
    <FieldTerm location={location} />
    <p
      className="m-0 max-w-[var(--measure)] whitespace-pre-line [overflow-wrap:anywhere]"
      data-authored-prose=""
      data-review-diff-content=""
      data-review-diff-presentation="field"
    >
      {runsWithChanges(
        runsWithoutLeadingTerm(runs, fieldTermOf(location.label)),
      )}
    </p>
  </div>
);

const SnapshotBlock = ({
  location,
  side,
}: {
  readonly location: DiffLocation;
  readonly side: "old" | "new";
}) => {
  const text = sideText(location, side);
  if (location.kind === "callout") {
    return <SnapshotCallout location={location} side={side} />;
  }
  if (location.kind in COMPONENT_FIELD_KINDS) {
    return <SnapshotFieldBlock location={location} side={side} />;
  }
  if (location.kind === "heading") {
    return (
      <h3 data-authored-prose="" data-review-diff-content="">
        {text}
      </h3>
    );
  }
  if (location.kind === "quote") {
    return (
      <blockquote data-authored-prose="" data-review-diff-content="">
        {text}
      </blockquote>
    );
  }
  if (location.kind === "code" || location.kind.startsWith("code-")) {
    return (
      <pre data-authored-prose="" data-review-diff-content="">
        <code data-authored-prose="">{text}</code>
      </pre>
    );
  }
  if (location.kind === "list") {
    const items = text
      .split("\n")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return (
      <DiffList presentation={sidePresentation(location, side)}>
        {items.map((item, index) => (
          <li key={`${index}-${item}`} data-authored-prose="">
            {item}
          </li>
        ))}
      </DiffList>
    );
  }
  return (
    <p data-authored-prose="" data-review-diff-content="">
      {text}
    </p>
  );
};

const SnapshotSideContent = ({
  locations,
  side,
}: {
  readonly locations: ReadonlyArray<DiffLocation>;
  readonly side: "old" | "new";
}) => {
  const visible = locations.filter(
    (location) => sideText(location, side).trim() !== "",
  );
  const tableRows = visible.filter((location) => location.kind === "table-row");
  const firstTableRow = tableRows[0];
  return visible.map((location, index) => {
    if (location.kind === "table-row") {
      return location === firstTableRow ? (
        <SnapshotTable key={`table-${side}`} rows={tableRows} side={side} />
      ) : null;
    }
    return (
      <SnapshotBlock
        key={`${location.scope}-${location.kind}-${index}`}
        location={location}
        side={side}
      />
    );
  });
};

type WireframeScreenDiff = {
  readonly id: string;
  readonly name: string;
  readonly status: "added" | "removed" | "updated";
};

const wireframeScreenMarkup = (
  html: string | undefined,
): Map<string, string> => {
  const screens = new Map<string, string>();
  if (html === undefined) return screens;
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const screen of document.querySelectorAll<HTMLElement>(
    "[data-wireframe-screen]",
  )) {
    const id = screen.dataset.wireframeScreen;
    if (id === undefined) continue;
    screen.removeAttribute("data-wireframe-current");
    screens.set(id, screen.outerHTML);
  }
  return screens;
};

const wireframeScreenName = (html: string, id: string): string => {
  const document = new DOMParser().parseFromString(html, "text/html");
  const screen = document.querySelector<HTMLElement>(
    `[data-wireframe-screen="${CSS.escape(id)}"]`,
  );
  return (
    screen?.querySelector<HTMLElement>(".wireframe-screen-name")?.textContent ??
    screen?.getAttribute("aria-label")?.split(",")[0] ??
    id
  ).trim();
};

const wireframeScreenDiffs = (
  oldHtml: string | undefined,
  newHtml: string | undefined,
): ReadonlyArray<WireframeScreenDiff> => {
  const oldScreens = wireframeScreenMarkup(oldHtml);
  const newScreens = wireframeScreenMarkup(newHtml);
  const ids = [...new Set([...newScreens.keys(), ...oldScreens.keys()])];
  return ids.flatMap((id) => {
    const oldMarkup = oldScreens.get(id);
    const newMarkup = newScreens.get(id);
    const status =
      oldMarkup === undefined
        ? "added"
        : newMarkup === undefined
          ? "removed"
          : oldMarkup === newMarkup
            ? undefined
            : "updated";
    if (status === undefined) return [];
    const nameSource = newMarkup === undefined ? oldHtml : newHtml;
    return [
      {
        id,
        name: wireframeScreenName(nameSource ?? "", id),
        status,
      },
    ];
  });
};

const screenStatusLabel = (status: WireframeScreenDiff["status"]): string =>
  status.charAt(0).toUpperCase() + status.slice(1);

const screenStatusClasses = (status: WireframeScreenDiff["status"]): string => {
  if (status === "added") {
    return "bg-[var(--diff-add-bg)] text-[var(--diff-add-c)]";
  }
  if (status === "removed") {
    return "bg-[var(--diff-remove-bg)] text-[var(--diff-remove-c)]";
  }
  return "bg-[color-mix(in_srgb,var(--callout-warning-c)_14%,var(--callout-warning-bg))] text-[var(--callout-warning-c)]";
};

const screenStatusBorder = (status: WireframeScreenDiff["status"]): string => {
  if (status === "added") {
    return "color-mix(in srgb, var(--diff-add-c) 52%, var(--diff-add-bg))";
  }
  if (status === "removed") {
    return "color-mix(in srgb, var(--diff-remove-c) 52%, var(--diff-remove-bg))";
  }
  return "color-mix(in srgb, var(--callout-warning-c) 52%, var(--callout-warning-bg))";
};

const ComponentSnapshotComparison = ({
  location,
}: {
  readonly location: DiffLocation;
}) => {
  const initialSide = location.newHtml === undefined ? "old" : "new";
  const screenDiffs = useMemo(
    () => wireframeScreenDiffs(location.oldHtml, location.newHtml),
    [location.oldHtml, location.newHtml],
  );
  const [side, setSide] = useState<"old" | "new">(initialSide);
  const [selectedScreenId, setSelectedScreenId] = useState(screenDiffs[0]?.id);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSide(initialSide);
    setSelectedScreenId(screenDiffs[0]?.id);
  }, [initialSide, location, screenDiffs]);
  const html = side === "old" ? location.oldHtml : location.newHtml;
  const fallbackHtml = side === "old" ? location.newHtml : location.oldHtml;
  const renderedHtml =
    selectedScreenId === undefined ||
    html?.includes(`data-wireframe-screen="${selectedScreenId}"`) === true
      ? html
      : fallbackHtml;
  const selectedScreen = screenDiffs.find(
    (screen) => screen.id === selectedScreenId,
  );
  useEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    const diffWireframeIds = new Set(
      Array.from(content.querySelectorAll<HTMLElement>("[data-wireframe]"))
        .map((element) => element.dataset.wireframe)
        .filter((id): id is string => id !== undefined),
    );
    const originalWireframes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-wireframe]"),
    ).filter(
      (element) =>
        !content.contains(element) &&
        diffWireframeIds.has(element.dataset.wireframe ?? ""),
    );
    const originalDisplayValues = originalWireframes.map(
      (element) => element.style.display,
    );
    originalWireframes.forEach((element) => {
      element.style.display = "none";
    });
    const fitWireframes = (): void => {
      for (const card of content.querySelectorAll<HTMLElement>(
        ".wireframe-frame-card",
      )) {
        const frame = card.querySelector<HTMLElement>(
          ":scope > .wireframe-frame",
        );
        if (frame === null || card.clientWidth === 0) continue;
        frame.style.zoom = "1";
        const cardStyle = getComputedStyle(card);
        const availableWidth =
          card.clientWidth -
          Number.parseFloat(cardStyle.paddingLeft) -
          Number.parseFloat(cardStyle.paddingRight);
        frame.style.zoom = String(
          Math.min(1, availableWidth / frame.offsetWidth),
        );
      }
      for (const screen of content.querySelectorAll<HTMLElement>(
        "[data-wireframe-screen]",
      )) {
        const selected = screen.dataset.wireframeScreen === selectedScreenId;
        screen.hidden = !selected;
        const diff = screenDiffs.find(
          (candidate) => candidate.id === screen.dataset.wireframeScreen,
        );
        screen.style.border =
          selected && diff !== undefined
            ? `4px solid ${screenStatusBorder(diff.status)}`
            : "";
        screen.style.borderRadius = selected ? "0.75rem" : "";
        screen.style.padding = selected ? "1rem" : "";
        const name = screen.querySelector<HTMLElement>(
          ".wireframe-screen-name",
        );
        if (name !== null && diff?.status === "removed") {
          name.style.textDecoration = "line-through";
          name.style.textDecorationThickness = "2px";
          name.style.textDecorationColor = "var(--diff-remove-c)";
        }
      }
    };
    fitWireframes();
    const observer = new ResizeObserver(fitWireframes);
    observer.observe(content);
    return () => {
      observer.disconnect();
      originalWireframes.forEach((element, index) => {
        element.style.display = originalDisplayValues[index] ?? "";
      });
    };
  }, [renderedHtml, screenDiffs, selectedScreenId]);
  return (
    <div className="grid min-w-0 gap-2" data-review-component-diff="">
      {/* A component snapshot is a diff, not a pair of ordinary tabs, so the
          selected side and the panel it opens carry the same removed/added
          colours the word-level lens uses. The border repeats the colour at
          the edge of the content, where the reader is actually looking. */}
      {screenDiffs.length > 0 ? (
        <nav className="wireframe-switcher" aria-label="Prototype screens">
          {screenDiffs.map((screen) => (
            <button
              key={screen.id}
              type="button"
              className="wireframe-switch"
              aria-current={selectedScreenId === screen.id ? "true" : undefined}
              onClick={() => setSelectedScreenId(screen.id)}
            >
              <span
                className={
                  screen.status === "removed" ? "line-through decoration-2" : ""
                }
              >
                {screen.name}
              </span>
              <span
                className={`rounded-md px-2 py-1 text-2xs font-bold ${screenStatusClasses(screen.status)}`}
              >
                {screenStatusLabel(screen.status)}
              </span>
            </button>
          ))}
        </nav>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {selectedScreen === undefined ? null : (
          <span
            className={`inline-flex items-center gap-2 text-xs font-bold uppercase tracking-caps ${screenStatusClasses(selectedScreen.status)}`}
          >
            <span aria-hidden="true">●</span>
            {screenStatusLabel(selectedScreen.status)}
          </span>
        )}
        <div
          className="flex items-center gap-3"
          role="group"
          aria-label="Choose component snapshot"
        >
          {location.oldHtml === undefined ? null : (
            <button
              type="button"
              className="cursor-pointer rounded-md border border-edge bg-surface px-3 py-2 text-xs font-semibold text-muted aria-pressed:border-[var(--diff-remove-c)] aria-pressed:bg-[var(--diff-remove-bg)] aria-pressed:text-[var(--diff-remove-c)]"
              aria-pressed={side === "old"}
              onClick={() => setSide("old")}
            >
              Was
            </button>
          )}
          {location.oldHtml === undefined ||
          location.newHtml === undefined ? null : (
            <span className="text-xl text-ink" aria-hidden="true">
              →
            </span>
          )}
          {location.newHtml === undefined ? null : (
            <button
              type="button"
              className="cursor-pointer rounded-md border border-edge bg-surface px-3 py-2 text-xs font-semibold text-muted aria-pressed:border-[var(--diff-add-c)] aria-pressed:bg-[var(--diff-add-bg)] aria-pressed:text-[var(--diff-add-c)]"
              aria-pressed={side === "new"}
              onClick={() => setSide("new")}
            >
              Now
            </button>
          )}
        </div>
      </div>
      <div
        className={`min-w-0 overflow-hidden rounded-lg border-4 bg-surface p-3 text-ink inset-shadow-well ${
          side === "old"
            ? "[border-color:color-mix(in_srgb,var(--diff-remove-c)_55%,var(--diff-remove-bg))]"
            : "[border-color:color-mix(in_srgb,var(--diff-add-c)_55%,var(--diff-add-bg))]"
        }`}
        data-review-component-snapshot={side}
      >
        <div
          ref={contentRef}
          className="pointer-events-none min-w-0 [&_.figure-control-bar]:hidden [&_.figure-action-group]:hidden [&_[data-flow-controls]]:hidden"
          inert
          dangerouslySetInnerHTML={{ __html: renderedHtml ?? "" }}
        />
      </div>
    </div>
  );
};

/** Renders the common word-level or stacked Was/Now lens vocabulary. */
export const DiffLensContent = ({
  diff,
  place,
  isHistorical,
  isSuperseded,
  presentation,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
  readonly isHistorical: boolean;
  readonly isSuperseded: boolean;
  readonly presentation?: ProsePresentation;
}) => {
  const locations = useMemo(
    () => placeLocations({ diff, place }),
    [diff, place],
  );
  // One overlap-free level is chosen up front so a component root grouped
  // with its declared sub-targets never repeats their text.
  const visibleLocations = useMemo(
    () => presentationLocations(locations),
    [locations],
  );
  const only = visibleLocations.length === 1 ? visibleLocations[0] : undefined;
  const canUseWordRuns =
    only?.status === "changed" &&
    place.note === "reworded" &&
    !listPresentationChanged(only) &&
    (only.kind === "paragraph" ||
      only.kind === "heading" ||
      only.kind === "quote" ||
      only.kind === "list" ||
      only.kind in COMPONENT_FIELD_KINDS);
  const hasOldText = visibleLocations.some(
    (location) => location.oldText.trim() !== "",
  );
  const hasNewText = visibleLocations.some(
    (location) => location.newText.trim() !== "",
  );
  const componentLocation = visibleLocations.find(
    (location) =>
      location.oldHtml !== undefined || location.newHtml !== undefined,
  );
  const title = isHistorical
    ? "Updated"
    : isSuperseded
      ? "What changed - plan revised again"
      : "What changed";
  return (
    <section
      className="grid w-full min-w-0 max-w-[var(--measure)] gap-3 rounded-lg border border-dashed border-accent bg-raised p-4 text-ink shadow-raised"
      aria-label={title}
      data-review-diff-lens=""
      data-review-diff-note={place.note}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <strong
          className={`rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-caps ${
            isHistorical
              ? "bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]"
              : "bg-accent-soft text-accent"
          }`}
        >
          {title}
        </strong>
        <em className="text-2xs text-muted">{place.note}</em>
      </div>
      {componentLocation !== undefined ? (
        <ComponentSnapshotComparison location={componentLocation} />
      ) : canUseWordRuns && only !== undefined ? (
        only.kind === "list" ? (
          <ListRunContent runs={only.runs} location={only} />
        ) : only.kind in COMPONENT_FIELD_KINDS ? (
          <FieldRunContent runs={only.runs} location={only} />
        ) : (
          <WordRunContent runs={only.runs} presentation={presentation} />
        )
      ) : (
        <div className="grid min-w-0 gap-2">
          {!hasOldText ? null : (
            <div className="min-w-0 rounded-lg bg-[var(--diff-remove-bg)] p-3 text-[var(--diff-remove-c)] inset-shadow-well">
              <strong className="mb-1 block text-2xs uppercase tracking-caps">
                Was
              </strong>
              <div className="min-w-0 [&>:last-child]:mb-0">
                <SnapshotSideContent locations={visibleLocations} side="old" />
              </div>
            </div>
          )}
          {!hasNewText ? null : (
            <div className="min-w-0 rounded-lg bg-[var(--diff-add-bg)] p-3 text-[var(--diff-add-c)] inset-shadow-well">
              <strong className="mb-1 block text-2xs uppercase tracking-caps">
                Now
              </strong>
              <div className="min-w-0 [&>:last-child]:mb-0">
                <SnapshotSideContent locations={visibleLocations} side="new" />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

type LensAnchor = {
  readonly element: HTMLElement;
  readonly placement: LensPlacement;
};

/** Uses instant scrolling when the reader asks the viewer to reduce motion. */
const lensScrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

/**
 * Finds the first of a place's locations that still has somewhere to land. A
 * place can describe several locations, and one unresolvable location does not
 * make the place historical while another can still show the change in place.
 */
const firstLiveAnchor = (
  locations: ReadonlyArray<DiffLocation>,
  isSuperseded: boolean,
): LensAnchor | null => {
  for (const location of locations) {
    const anchor = liveLensAnchor(location, { isSuperseded });
    if ("found" in anchor) {
      return { element: anchor.found, placement: anchor.placement };
    }
  }
  return null;
};

export const DiffLensPortal = ({
  diff,
  place,
  isVisible,
  isSuperseded,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
  readonly isVisible: boolean;
  readonly isSuperseded: boolean;
}) => {
  const locations = useMemo(
    () => placeLocations({ diff, place }),
    [diff, place],
  );
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [isHistorical, setIsHistorical] = useState(false);
  const [presentation, setPresentation] = useState<ProsePresentation>();
  // The host, the anchor it sits beside, and the blocks it hides all belong to
  // the article that was displayed when the lens opened. A refresh replaces
  // that article, so the lens re-resolves against the new one: it lands beside
  // the revised block, or falls back to the archive when the block it was
  // showing is no longer there.
  const articleVersion = useArticleVersion();
  useEffect(() => {
    if (!isVisible) {
      setHost(null);
      setPresentation(undefined);
      return;
    }
    const anchor = firstLiveAnchor(locations, isSuperseded);
    if (anchor === null) {
      setIsHistorical(true);
      setPresentation(undefined);
      const main = document.querySelector<HTMLElement>("main");
      if (main === null) {
        setHost(null);
        return;
      }
      const container = document.createElement("div");
      container.dataset.reviewDiffLensHost = "";
      container.dataset.reviewHistoricalDiff = "";
      container.className =
        "mx-auto my-4 min-w-0 w-full max-w-[var(--measure)] px-4";
      let archive = main.querySelector<HTMLElement>(
        "[data-review-historical-changes]",
      );
      const ownsArchive = archive === null;
      if (archive === null) {
        archive = document.createElement("section");
        archive.dataset.reviewHistoricalChanges = "";
        archive.className = "mx-auto my-8 w-full max-w-[var(--measure)]";
        archive.setAttribute("aria-label", "Historical changes");
        const slides = main.querySelectorAll<HTMLElement>("[data-slide]");
        const lastSlide = slides.item(slides.length - 1);
        if (lastSlide === null) main.append(archive);
        else lastSlide.after(archive);
      }
      archive.append(container);
      setHost(container);
      requestAnimationFrame(() =>
        container.scrollIntoView({
          behavior: lensScrollBehavior(),
          block: "center",
        }),
      );
      return () => {
        container.remove();
        if (ownsArchive && archive?.childElementCount === 0) archive.remove();
      };
    }
    setIsHistorical(false);
    setPresentation(prosePresentationFor(anchor.element));
    const replaced = locations
      .map((location) => location.newBlockId)
      .filter((blockId): blockId is string => blockId !== undefined)
      .map((blockId) => ({
        blockId,
        element: foundElement(liveBlock(blockId)),
      }))
      .filter(
        (entry): entry is { blockId: string; element: HTMLElement } =>
          entry.element !== null,
      );
    const direct = replaced.map((entry) => entry.element);
    const wireframeTarget =
      anchor.element.closest<HTMLElement>("[data-wireframe]");
    const wireframeBlockIds = new Set(
      locations.flatMap((location) =>
        [location.oldBlockId, location.newBlockId].filter(
          (blockId): blockId is string => blockId !== undefined,
        ),
      ),
    );
    const wireframeIds = new Set(
      locations.flatMap((location) =>
        [location.oldHtml, location.newHtml].flatMap((html) => {
          if (html === undefined) return [];
          const document = new DOMParser().parseFromString(html, "text/html");
          return Array.from(
            document.querySelectorAll<HTMLElement>("[data-wireframe]"),
          )
            .map((element) => element.dataset.wireframe)
            .filter((id): id is string => id !== undefined);
        }),
      ),
    );
    const originalWireframes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-wireframe]"),
    ).filter(
      (element) =>
        element.closest("[data-review-diff-lens-host]") === null &&
        (wireframeBlockIds.has(element.dataset.blockId ?? "") ||
          wireframeIds.has(element.dataset.wireframe ?? "")),
    );
    const hiddenElements = [
      ...new Set(
        wireframeTarget === null
          ? [...direct, ...originalWireframes]
          : [...direct, wireframeTarget, ...originalWireframes],
      ),
    ];
    const displayValues = hiddenElements.map(
      (element) => element.style.display,
    );
    hiddenElements.forEach((element) => {
      element.style.display = "none";
    });
    const container = document.createElement("div");
    container.dataset.reviewDiffLensHost = "";
    // A hidden block has no box, so anything sending a reader to it would
    // scroll nowhere. Naming the blocks this lens shows in place of is what
    // lets a jump land on the content the reader can actually see.
    container.setAttribute(
      LENS_STAND_IN_ATTRIBUTE,
      replaced.map((entry) => entry.blockId).join(" "),
    );
    container.className = "my-4 min-w-0 max-w-full";
    let removalNode: HTMLElement = container;
    const target = anchor.element;
    if (target instanceof HTMLTableRowElement) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = Math.max(1, target.cells.length);
      cell.append(container);
      row.append(cell);
      if (anchor.placement === "after") target.after(row);
      else target.before(row);
      removalNode = row;
    } else if (anchor.placement === "after") {
      target.after(container);
    } else {
      target.before(container);
    }
    setHost(container);
    requestAnimationFrame(() =>
      container.scrollIntoView({
        behavior: lensScrollBehavior(),
        block: "center",
      }),
    );
    return () => {
      hiddenElements.forEach((element, index) => {
        element.style.display = displayValues[index] ?? "";
      });
      removalNode.remove();
    };
  }, [articleVersion, isSuperseded, isVisible, locations]);
  return host === null
    ? null
    : createPortal(
        <DiffLensContent
          diff={diff}
          place={place}
          isHistorical={isHistorical}
          isSuperseded={isSuperseded}
          presentation={presentation}
        />,
        host,
      );
};
