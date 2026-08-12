// Owns the one-at-a-time What-changed lens and guided tour shared by comment
// threads and plan-wide chat. It portals interaction chrome beside the
// server-rendered block without taking ownership of plan content.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { INFO_ICON } from "../../icons/lucide/info.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { LIGHTBULB_ICON } from "../../icons/lucide/lightbulb.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { OCTAGON_ALERT_ICON } from "../../icons/lucide/octagon-alert.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import { X_ICON } from "../../icons/lucide/x.js";
import type {
  DiffLocation,
  DiffPlace,
  DiffRun,
  SnapshotDiff,
} from "../shared/review-wire.js";
import {
  candidateMatchesLiveText,
  lensAnchorCandidates,
  tourStartIndex,
  type LensPlacement,
} from "./diff-anchor.js";
import { Icon } from "./icon.browser.js";
import { Badge, Button } from "./ui.browser.js";

type OpenTour = {
  readonly diff: SnapshotDiff;
  readonly placeIds: ReadonlyArray<string>;
  readonly startPlaceId?: string;
  readonly isSuperseded?: boolean;
  readonly onResolve?: () => void;
  readonly onRevert?: () => void;
  readonly canRevert?: boolean;
  readonly threadLabel?: string;
  readonly onOpenThread?: () => void;
  readonly onKeepChatting?: () => void;
};

type DiffTourValue = {
  readonly activeDiff: SnapshotDiff | null;
  readonly activePlaceId: string | null;
  readonly isPlaceAccepted: (diff: SnapshotDiff, placeId: string) => boolean;
  readonly togglePlaceAccepted: (diff: SnapshotDiff, placeId: string) => void;
  readonly setPlacesAccepted: (
    diff: SnapshotDiff,
    placeIds: ReadonlyArray<string>,
    accepted: boolean,
  ) => void;
  readonly openTour: (tour: OpenTour) => void;
  readonly closeTour: () => void;
};

const DiffTourContext = createContext<DiffTourValue | null>(null);
const ACCEPTED_PLACES_STORAGE_KEY = "big-plan.review.accepted-diff-places.v1";

const acceptedPlaceKey = (diff: SnapshotDiff, placeId: string): string =>
  `${diff.from}:${diff.to}:${placeId}`;

/** Restores only bounded diff identifiers from optional browser preference state. */
const initialAcceptedPlaces = (): ReadonlySet<string> => {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(ACCEPTED_PLACES_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length <= 256,
      ),
    );
  } catch {
    return new Set();
  }
};

/** Gives change attachments one shared tour without coupling them together. */
export const useDiffTour = (): DiffTourValue => {
  const value = useContext(DiffTourContext);
  if (value === null) {
    throw new Error("A diff attachment must render inside DiffTourProvider");
  }
  return value;
};

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
  if (visible.some((location) => location.kind === "quick-summary-facet")) {
    visible = visible.filter((location) => location.kind !== "quick-summary");
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

const ListRunContent = ({
  runs,
  location,
}: {
  readonly runs: ReadonlyArray<DiffRun>;
  readonly location: DiffLocation;
}) => {
  const current =
    currentBlockFor(location, "new") ?? currentBlockFor(location, "old");
  const List = current?.tagName === "OL" ? "ol" : "ul";
  return (
    <List data-authored-prose="" data-review-diff-content="">
      {runsByLine(runs).map((line, index) => (
        <li
          key={`${index}-${line.map((run) => run.text).join("")}`}
          data-authored-prose=""
        >
          {runsWithChanges(line)}
        </li>
      ))}
    </List>
  );
};

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
      <tbody data-authored-prose="">
        {rows.map((row, rowIndex) => {
          const cells = sideText(row, side).trim().split(/\n+/u);
          return (
            <tr key={`${row.scope}-${rowIndex}`} data-authored-prose="">
              {cells.map((cell, cellIndex) => {
                const Cell = rowIndex === 0 ? "th" : "td";
                return (
                  <Cell
                    key={`${cellIndex}-${cell}`}
                    className="min-w-0 [overflow-wrap:anywhere]"
                    data-authored-prose=""
                  >
                    {cell}
                  </Cell>
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

const currentBlockFor = (
  location: DiffLocation,
  side: "old" | "new",
): HTMLElement | null => {
  const blockId = side === "old" ? location.oldBlockId : location.newBlockId;
  return blockId === undefined
    ? null
    : document.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(blockId)}"]`,
      );
};

const SnapshotCallout = ({
  location,
  side,
}: {
  readonly location: DiffLocation;
  readonly side: "old" | "new";
}) => {
  const current = currentBlockFor(location, side);
  const authoredType = current?.dataset.callout;
  const type: SnapshotCalloutType =
    authoredType === "tip" ||
    authoredType === "warning" ||
    authoredType === "danger"
      ? authoredType
      : "note";
  const title = location.label.trim() || "Note";
  const text = sideText(location, side).trim();
  const body = text.startsWith(title) ? text.slice(title.length).trim() : text;
  return (
    <aside
      className="callout mb-0 max-w-[var(--measure)] rounded-r-md border-l-4 px-4 py-3"
      data-callout={type}
      data-review-diff-callout=""
    >
      <header className="callout-header mb-2 flex items-center gap-2 font-semibold text-[var(--callout-accent)] [&_svg]:size-4 [&_svg]:shrink-0">
        <Icon icon={SNAPSHOT_CALLOUT_ICONS[type]} />
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

// A quick-summary facet's flattened text leads with the facet's own term,
// which the header above the body already names, so the term is stripped
// before the body is shown.
const facetBodyText = (location: DiffLocation, side: "old" | "new"): string => {
  const term = location.label.trim();
  const raw = sideText(location, side).trim();
  return raw.startsWith(term) ? raw.slice(term.length).trim() : raw;
};

const FacetTerm = ({ location }: { readonly location: DiffLocation }) => (
  <strong className="mb-1 block text-2xs font-semibold uppercase tracking-caps">
    {location.label.trim()}
  </strong>
);

const SnapshotSummaryFacet = ({
  location,
  side,
}: {
  readonly location: DiffLocation;
  readonly side: "old" | "new";
}) => {
  const body = facetBodyText(location, side);
  const items = body
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return (
    <div data-review-diff-facet="">
      <FacetTerm location={location} />
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

/** Drops the facet term the header already names from the leading run. */
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

// The word-level lens for one reworded facet: the facet term stays a calm
// header while the body carries the exact removed and inserted words, with
// authored line boundaries preserved so multi-item facets read as their items.
const FacetRunContent = ({
  runs,
  location,
}: {
  readonly runs: ReadonlyArray<DiffRun>;
  readonly location: DiffLocation;
}) => (
  <div data-review-diff-facet="">
    <FacetTerm location={location} />
    <p
      className="m-0 max-w-[var(--measure)] whitespace-pre-line [overflow-wrap:anywhere]"
      data-authored-prose=""
      data-review-diff-content=""
      data-review-diff-presentation="facet"
    >
      {runsWithChanges(runsWithoutLeadingTerm(runs, location.label.trim()))}
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
  if (location.kind === "quick-summary-facet") {
    return <SnapshotSummaryFacet location={location} side={side} />;
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
    const current =
      currentBlockFor(location, side) ??
      currentBlockFor(location, side === "old" ? "new" : "old");
    const List = current?.tagName === "OL" ? "ol" : "ul";
    const items = text
      .split("\n")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return (
      <List data-authored-prose="" data-review-diff-content="">
        {items.map((item, index) => (
          <li key={`${index}-${item}`} data-authored-prose="">
            {item}
          </li>
        ))}
      </List>
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

const ComponentSnapshotComparison = ({
  location,
}: {
  readonly location: DiffLocation;
}) => {
  const initialSide = location.newHtml === undefined ? "old" : "new";
  const [side, setSide] = useState<"old" | "new">(initialSide);
  useEffect(() => setSide(initialSide), [initialSide, location]);
  const html = side === "old" ? location.oldHtml : location.newHtml;
  return (
    <div className="grid min-w-0 gap-2" data-review-component-diff="">
      {/* A component snapshot is a diff, not a pair of ordinary tabs, so the
          selected side and the panel it opens carry the same removed/added
          colours the word-level lens uses. The border repeats the colour at
          the edge of the content, where the reader is actually looking. */}
      <div
        className="flex w-fit items-center rounded-md border border-edge bg-surface p-0.5"
        role="group"
        aria-label="Choose component snapshot"
      >
        {location.oldHtml === undefined ? null : (
          <button
            type="button"
            className="cursor-pointer rounded-sm px-2 py-1 text-2xs font-semibold text-muted aria-pressed:bg-[var(--diff-remove-bg)] aria-pressed:text-[var(--diff-remove-c)] aria-pressed:shadow-raised"
            aria-pressed={side === "old"}
            onClick={() => setSide("old")}
          >
            Was
          </button>
        )}
        {location.newHtml === undefined ? null : (
          <button
            type="button"
            className="cursor-pointer rounded-sm px-2 py-1 text-2xs font-semibold text-muted aria-pressed:bg-[var(--diff-add-bg)] aria-pressed:text-[var(--diff-add-c)] aria-pressed:shadow-raised"
            aria-pressed={side === "new"}
            onClick={() => setSide("new")}
          >
            Now
          </button>
        )}
      </div>
      <div
        className={`min-w-0 overflow-hidden rounded-lg border-2 bg-surface p-3 text-ink inset-shadow-well ${
          side === "old"
            ? "border-[var(--diff-remove-c)]"
            : "border-[var(--diff-add-c)]"
        }`}
        data-review-component-snapshot={side}
      >
        <div
          className="pointer-events-none min-w-0 [&_.figure-control-bar]:hidden [&_.figure-action-group]:hidden [&_[data-flow-controls]]:hidden"
          inert
          dangerouslySetInnerHTML={{ __html: html ?? "" }}
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
    (only.kind === "paragraph" ||
      only.kind === "heading" ||
      only.kind === "quote" ||
      only.kind === "list" ||
      only.kind === "quick-summary-facet");
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
    ? "Historical change"
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
        <strong className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-bold text-accent uppercase tracking-caps">
          {title}
        </strong>
        <em className="text-2xs text-muted">{place.note}</em>
      </div>
      {componentLocation !== undefined ? (
        <ComponentSnapshotComparison location={componentLocation} />
      ) : canUseWordRuns && only !== undefined ? (
        only.kind === "list" ? (
          <ListRunContent runs={only.runs} location={only} />
        ) : only.kind === "quick-summary-facet" ? (
          <FacetRunContent runs={only.runs} location={only} />
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

/**
 * Resolves a block id to the block the reader is reading, never to a copy of
 * that block rendered inside another lens's Was/Now snapshot.
 */
const documentBlock = (blockId: string): HTMLElement | null => {
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-block-id="${CSS.escape(blockId)}"]`,
  );
  for (const candidate of candidates) {
    if (candidate.closest("[data-review-diff-lens]") === null) return candidate;
  }
  return null;
};

/**
 * Reads the text a live block presents to the reader, mirroring what
 * compile-time extraction recorded: screen-reader-only scaffolding never
 * enters a snapshot's text, and review chrome injected after load did not
 * exist at compile time, so both are stripped before this text is compared
 * with a snapshot's record of the block.
 */
const liveBlockText = (element: HTMLElement): string => {
  const clone = element.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return element.textContent ?? "";
  for (const injected of clone.querySelectorAll(
    ".sr-only, [data-review-anchor-host], [data-review-toolbar-host], [data-flow-comment-marker]",
  )) {
    injected.remove();
  }
  return clone.textContent ?? "";
};

const anchorFor = (
  location: DiffLocation,
  isSuperseded: boolean,
): LensAnchor | null => {
  for (const candidate of lensAnchorCandidates(location, { isSuperseded })) {
    const element = documentBlock(candidate.blockId);
    if (element === null) continue;
    // A block id resolved across a snapshot boundary can name different
    // content than the diff recorded. Such a drifted candidate is treated as
    // missing, so the change falls back to the honest historical archive
    // instead of rendering beside the wrong block.
    if (
      !candidateMatchesLiveText({ candidate, liveText: liveBlockText(element) })
    ) {
      continue;
    }
    return { element, placement: candidate.placement };
  }
  return null;
};

const LensPortal = ({
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
  useEffect(() => {
    if (!isVisible) {
      setHost(null);
      setPresentation(undefined);
      return;
    }
    const anchor =
      locations
        .map((location) => anchorFor(location, isSuperseded))
        .find((candidate) => candidate !== null) ?? null;
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
        container.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
      return () => {
        container.remove();
        if (ownsArchive && archive?.childElementCount === 0) archive.remove();
      };
    }
    setIsHistorical(false);
    setPresentation(prosePresentationFor(anchor.element));
    const direct = locations
      .map((location) => location.newBlockId)
      .filter((blockId): blockId is string => blockId !== undefined)
      .map((blockId) => documentBlock(blockId))
      .filter((element): element is HTMLElement => element !== null);
    const displayValues = direct.map((element) => element.style.display);
    direct.forEach((element) => {
      element.style.display = "none";
    });
    const container = document.createElement("div");
    container.dataset.reviewDiffLensHost = "";
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
      container.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
    return () => {
      direct.forEach((element, index) => {
        element.style.display = displayValues[index] ?? "";
      });
      removalNode.remove();
    };
  }, [isSuperseded, isVisible, locations]);
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

/** Coordinates the active lens, fixed stepper, Escape, and round-trip toggle. */
export const DiffTourProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const [tour, setTour] = useState<OpenTour | null>(null);
  const [index, setIndex] = useState(0);
  const [showCompletionSummary, setShowCompletionSummary] = useState(false);
  const [acceptedPlaces, setAcceptedPlaces] = useState(initialAcceptedPlaces);
  const places = useMemo(() => {
    if (tour === null) return [];
    const allowed = new Set(tour.placeIds);
    return tour.diff.places.filter((place) => allowed.has(place.placeId));
  }, [tour]);
  const active = places.at(index);
  const closeTour = () => setTour(null);
  const isPlaceAccepted = useCallback(
    (diff: SnapshotDiff, placeId: string): boolean =>
      acceptedPlaces.has(acceptedPlaceKey(diff, placeId)),
    [acceptedPlaces],
  );
  const togglePlaceAccepted = useCallback(
    (diff: SnapshotDiff, placeId: string): void => {
      setAcceptedPlaces((current) => {
        const next = new Set(current);
        const key = acceptedPlaceKey(diff, placeId);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [],
  );
  const setPlacesAccepted = useCallback(
    (
      diff: SnapshotDiff,
      placeIds: ReadonlyArray<string>,
      accepted: boolean,
    ): void => {
      setAcceptedPlaces((current) => {
        const next = new Set(current);
        for (const placeId of placeIds) {
          const key = acceptedPlaceKey(diff, placeId);
          if (accepted) next.add(key);
          else next.delete(key);
        }
        return next;
      });
    },
    [],
  );
  useEffect(() => {
    window.localStorage.setItem(
      ACCEPTED_PLACES_STORAGE_KEY,
      JSON.stringify([...acceptedPlaces]),
    );
  }, [acceptedPlaces]);
  const openTour = (next: OpenTour): void => {
    setTour(next);
    setIndex(tourStartIndex(next));
    // The lens scrolls itself into view once it knows where it landed. A scroll
    // from here could only guess, and picking the document's first lens would
    // send the reader to a historical change instead of the one they opened.
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || tour === null) return;
      event.preventDefault();
      closeTour();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tour]);
  const value = useMemo<DiffTourValue>(
    () => ({
      activeDiff: tour?.diff ?? null,
      activePlaceId: active?.placeId ?? null,
      isPlaceAccepted,
      togglePlaceAccepted,
      setPlacesAccepted,
      openTour,
      closeTour,
    }),
    [
      active?.placeId,
      isPlaceAccepted,
      setPlacesAccepted,
      togglePlaceAccepted,
      tour,
    ],
  );
  const isActiveAccepted =
    tour !== null &&
    active !== undefined &&
    isPlaceAccepted(tour.diff, active.placeId);
  const allAccepted =
    tour !== null &&
    places.length > 0 &&
    places.every((place) => isPlaceAccepted(tour.diff, place.placeId));
  useEffect(() => {
    if (!allAccepted) setShowCompletionSummary(false);
    else setShowCompletionSummary(true);
  }, [allAccepted, tour?.diff.from, tour?.diff.to]);

  /** Accepts the current evidence and advances to the next open decision. */
  const acceptActivePlace = (): void => {
    if (tour === null || active === undefined) return;
    if (isActiveAccepted) {
      togglePlaceAccepted(tour.diff, active.placeId);
      return;
    }
    setPlacesAccepted(tour.diff, [active.placeId], true);
    const nextIndex = places.findIndex(
      (place, placeIndex) =>
        placeIndex > index && !isPlaceAccepted(tour.diff, place.placeId),
    );
    if (nextIndex >= 0) {
      setIndex(nextIndex);
    }
  };
  return (
    <DiffTourContext.Provider value={value}>
      {children}
      {tour === null || active === undefined ? null : (
        <>
          <LensPortal
            diff={tour.diff}
            place={active}
            isVisible
            isSuperseded={tour.isSuperseded === true}
          />
          <div
            // The bar floats clear of the viewport edge rather than hugging
            // it, and holds a wide enough measure that the change it is
            // reviewing and the thread that caused it read as two separate
            // ends of the same row.
            className="fixed right-4 bottom-11 left-4 z-40 mx-auto grid w-auto min-w-0 overflow-hidden rounded-xl border border-edge-strong bg-raised text-xs text-ink shadow-floating wide:w-fit wide:min-w-lg"
            data-review-diff-stepper=""
          >
            <div className="flex min-w-0 items-center gap-2 border-b border-accent bg-[color-mix(in_srgb,var(--accent-c)_10%,var(--raised))] px-3 py-2">
              <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-ink [&>svg]:size-3.5">
                <Icon icon={CHECK_ICON} />
                Reviewing change set
              </span>
              {/* Progress through the set and the fact that the set is
                  finished are the same piece of information, so they share one
                  slot beside the title instead of sitting at opposite ends. */}
              {showCompletionSummary ? (
                <Badge tone="statusAccent" size="status">
                  All changes accepted ({places.length} of {places.length})
                </Badge>
              ) : (
                <Badge tone="statusNeutral" size="status">
                  {index + 1} of {places.length}
                </Badge>
              )}
              {!showCompletionSummary && places.length > 1 ? (
                <div
                  className="flex shrink-0 items-center gap-1"
                  role="group"
                  aria-label="Change navigation"
                >
                  <Button
                    variant="ghost"
                    size="compactIcon"
                    className="[&>svg]:rotate-180"
                    disabled={index === 0}
                    aria-label="Previous change"
                    onClick={() => {
                      setIndex((current) => Math.max(0, current - 1));
                    }}
                  >
                    <Icon icon={CHEVRON_RIGHT_ICON} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="compactIcon"
                    disabled={index >= places.length - 1}
                    aria-label="Next change"
                    onClick={() => {
                      setIndex((current) =>
                        Math.min(places.length - 1, current + 1),
                      );
                    }}
                  >
                    <Icon icon={CHEVRON_RIGHT_ICON} />
                  </Button>
                </div>
              ) : null}
              <span className="min-w-0 flex-1" />
              <Button
                variant="ghost"
                size="compact"
                className="min-w-0 max-w-64 justify-start [&>svg]:size-4"
                aria-label={`Open comment thread: ${tour.threadLabel ?? "Plan-wide chat"}`}
                onClick={tour.onOpenThread}
              >
                <Icon icon={MESSAGE_SQUARE_ICON} />
                <span className="truncate">
                  {tour.threadLabel ?? "Plan-wide chat"}
                </span>
              </Button>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
              {showCompletionSummary ? (
                <>
                  <Button
                    variant="outline"
                    size="micro"
                    onClick={() => setShowCompletionSummary(false)}
                  >
                    Back to review
                  </Button>
                  <span className="min-w-0 flex-1" />
                  <Button
                    variant="secondary"
                    size="micro"
                    onClick={() => {
                      closeTour();
                      tour.onKeepChatting?.();
                    }}
                  >
                    Keep chatting
                  </Button>
                  {tour.onResolve === undefined ? null : (
                    <Button
                      size="micro"
                      onClick={() => {
                        tour.onResolve?.();
                        closeTour();
                      }}
                    >
                      <Icon icon={CHECK_ICON} />
                      Resolve thread
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button variant="outline" size="micro" onClick={closeTour}>
                    <Icon icon={X_ICON} />
                    Exit review
                  </Button>
                  <span className="min-w-0 flex-1" />
                  {places.length <= 1 || allAccepted ? null : (
                    <Button
                      variant="accentOutline"
                      size="micro"
                      onClick={() =>
                        setPlacesAccepted(
                          tour.diff,
                          places.map((place) => place.placeId),
                          true,
                        )
                      }
                    >
                      Accept all
                    </Button>
                  )}
                  {tour.onRevert === undefined ? null : (
                    <Button
                      variant="ghost"
                      size="micro"
                      className="hover:text-danger"
                      disabled={tour.canRevert !== true}
                      aria-label={
                        tour.canRevert === true
                          ? "Revert the full agent response"
                          : "Revert unavailable because the plan changed again"
                      }
                      onClick={tour.onRevert}
                    >
                      <Icon icon={ROTATE_CCW_ICON} />
                      Revert
                    </Button>
                  )}
                  {isActiveAccepted ? (
                    <>
                      <Badge tone="statusAccent" size="status">
                        Accepted
                      </Badge>
                      <Button
                        variant="ghost"
                        size="micro"
                        aria-label="Undo acceptance for this change"
                        onClick={acceptActivePlace}
                      >
                        Undo
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="micro"
                      aria-label="Accept this change"
                      onClick={acceptActivePlace}
                    >
                      <Icon icon={CHECK_ICON} />
                      Accept change
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </DiffTourContext.Provider>
  );
};
