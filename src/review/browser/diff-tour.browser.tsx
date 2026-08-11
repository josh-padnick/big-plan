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
import type {
  DiffLocation,
  DiffPlace,
  DiffRun,
  SnapshotDiff,
} from "../shared/review-wire.js";

type OpenTour = {
  readonly diff: SnapshotDiff;
  readonly placeIds: ReadonlyArray<string>;
  readonly startPlaceId?: string;
  readonly isSuperseded?: boolean;
};

type DiffTourValue = {
  readonly activeDiff: SnapshotDiff | null;
  readonly activePlaceId: string | null;
  readonly isPlaceAccepted: (diff: SnapshotDiff, placeId: string) => boolean;
  readonly acceptPlace: (diff: SnapshotDiff, placeId: string) => void;
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

// A table's aggregate, row, column, and cell identities deliberately overlap
// for attribution. A presentation must choose one non-overlapping level or it
// repeats the same text several times.
const presentationLocations = (
  locations: ReadonlyArray<DiffLocation>,
): ReadonlyArray<DiffLocation> => {
  if (!locations.some((location) => location.kind === "table-row")) {
    return locations;
  }
  return locations.filter(
    (location) =>
      location.kind !== "table" &&
      location.kind !== "table-column" &&
      location.kind !== "table-cell",
  );
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

const SnapshotTable = ({
  rows,
  side,
}: {
  readonly rows: ReadonlyArray<DiffLocation>;
  readonly side: "old" | "new";
}) => (
  <div className="max-w-full min-w-0 overflow-hidden">
    <table
      className="w-full table-fixed"
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

const SnapshotBlock = ({
  location,
  side,
}: {
  readonly location: DiffLocation;
  readonly side: "old" | "new";
}) => {
  const text = sideText(location, side);
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
    const blockId = location.newBlockId ?? location.oldBlockId;
    const current =
      blockId === undefined
        ? null
        : document.querySelector<HTMLElement>(
            `[data-block-id="${CSS.escape(blockId)}"]`,
          );
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
  const visible = presentationLocations(locations).filter(
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
  const only = locations.length === 1 ? locations[0] : undefined;
  const canUseWordRuns =
    only?.status === "changed" &&
    place.note === "reworded" &&
    (only.kind === "paragraph" ||
      only.kind === "heading" ||
      only.kind === "quote");
  const hasOldText = locations.some(
    (location) => location.oldText.trim() !== "",
  );
  const hasNewText = locations.some(
    (location) => location.newText.trim() !== "",
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
      {canUseWordRuns && only !== undefined ? (
        <WordRunContent runs={only.runs} presentation={presentation} />
      ) : (
        <div className="grid min-w-0 gap-2">
          {!hasOldText ? null : (
            <div className="min-w-0 rounded-lg bg-[var(--diff-remove-bg)] p-3 text-[var(--diff-remove-c)] inset-shadow-well">
              <strong className="mb-1 block text-2xs uppercase tracking-caps">
                Was
              </strong>
              <div className="min-w-0 [&>:last-child]:mb-0">
                <SnapshotSideContent locations={locations} side="old" />
              </div>
            </div>
          )}
          {!hasNewText ? null : (
            <div className="min-w-0 rounded-lg bg-[var(--diff-add-bg)] p-3 text-[var(--diff-add-c)] inset-shadow-well">
              <strong className="mb-1 block text-2xs uppercase tracking-caps">
                Now
              </strong>
              <div className="min-w-0 [&>:last-child]:mb-0">
                <SnapshotSideContent locations={locations} side="new" />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const anchorFor = (
  location: DiffLocation,
  isSuperseded: boolean,
): HTMLElement | null => {
  const blockIds = isSuperseded
    ? [location.newBlockId]
    : [location.newBlockId, location.beforeBlockId, location.afterBlockId];
  for (const blockId of blockIds) {
    if (blockId === undefined) continue;
    const element = document.querySelector<HTMLElement>(
      `[data-block-id="${CSS.escape(blockId)}"]`,
    );
    if (element !== null) return element;
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
    const first = locations[0];
    const anchor = first === undefined ? null : anchorFor(first, isSuperseded);
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
      const firstSlide = main.querySelector<HTMLElement>("[data-slide]");
      if (firstSlide === null) main.prepend(container);
      else firstSlide.before(container);
      setHost(container);
      requestAnimationFrame(() =>
        container.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
      return () => container.remove();
    }
    setIsHistorical(false);
    setPresentation(prosePresentationFor(anchor));
    const direct = locations
      .map((location) => location.newBlockId)
      .filter((blockId): blockId is string => blockId !== undefined)
      .map((blockId) =>
        document.querySelector<HTMLElement>(
          `[data-block-id="${CSS.escape(blockId)}"]`,
        ),
      )
      .filter((element): element is HTMLElement => element !== null);
    const displayValues = direct.map((element) => element.style.display);
    direct.forEach((element) => {
      element.style.display = "none";
    });
    const container = document.createElement("div");
    container.dataset.reviewDiffLensHost = "";
    container.className = "my-4 min-w-0 max-w-full";
    let removalNode: HTMLElement = container;
    if (anchor instanceof HTMLTableRowElement) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = Math.max(1, anchor.cells.length);
      cell.append(container);
      row.append(cell);
      anchor.before(row);
      removalNode = row;
    } else {
      anchor.before(container);
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
  }, [isVisible, locations]);
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
  const [isVisible, setIsVisible] = useState(true);
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
  const acceptPlace = useCallback(
    (diff: SnapshotDiff, placeId: string): void => {
      setAcceptedPlaces((current) => {
        const next = new Set(current);
        next.add(acceptedPlaceKey(diff, placeId));
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
    const startIndex =
      next.startPlaceId === undefined
        ? 0
        : Math.max(0, next.placeIds.indexOf(next.startPlaceId));
    setTour(next);
    setIndex(startIndex);
    setIsVisible(true);
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
      acceptPlace,
      openTour,
      closeTour,
    }),
    [acceptPlace, active?.placeId, isPlaceAccepted, tour],
  );
  return (
    <DiffTourContext.Provider value={value}>
      {children}
      {tour === null || active === undefined ? null : (
        <>
          <LensPortal
            diff={tour.diff}
            place={active}
            isVisible={isVisible}
            isSuperseded={tour.isSuperseded === true}
          />
          <div
            className="fixed right-4 bottom-4 left-4 z-40 mx-auto flex w-fit max-w-[calc(100vw_-_2rem)] min-w-0 items-center gap-1 rounded-full border border-edge-strong bg-raised p-1.5 text-xs text-ink shadow-floating"
            data-review-diff-stepper=""
          >
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-full border-0 bg-transparent px-3 text-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:text-subtle wide:min-h-8"
              disabled={index === 0}
              aria-label="Previous change"
              onClick={() => {
                setIndex((current) => Math.max(0, current - 1));
                setIsVisible(true);
              }}
            >
              Previous
            </button>
            <span className="min-w-0 max-w-72 truncate px-2 text-center text-xs text-muted">
              Change {index + 1} of {places.length} - {active.section}
            </span>
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-full border-0 bg-transparent px-3 text-ink hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:text-subtle wide:min-h-8"
              disabled={index >= places.length - 1}
              aria-label="Next change"
              onClick={() => {
                setIndex((current) => Math.min(places.length - 1, current + 1));
                setIsVisible(true);
              }}
            >
              Next
            </button>
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-full border border-edge bg-paper px-3 font-semibold text-accent hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent wide:min-h-8"
              onClick={() => setIsVisible((current) => !current)}
            >
              {isVisible ? "Show current text" : "Show changes"}
            </button>
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-full border border-accent bg-accent-soft px-3 font-semibold text-accent hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:border-edge disabled:bg-surface disabled:text-muted wide:min-h-8"
              disabled={isPlaceAccepted(tour.diff, active.placeId)}
              onClick={() => acceptPlace(tour.diff, active.placeId)}
            >
              {isPlaceAccepted(tour.diff, active.placeId)
                ? "Accepted"
                : "Accept change"}
            </button>
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-full border-0 bg-transparent px-3 text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent wide:min-h-8"
              onClick={closeTour}
            >
              Hide changes
            </button>
          </div>
        </>
      )}
    </DiffTourContext.Provider>
  );
};
