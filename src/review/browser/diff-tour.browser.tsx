// Owns the one-at-a-time What-changed lens and guided tour shared by comment
// threads and plan-wide chat. It portals interaction chrome beside the
// server-rendered block without taking ownership of plan content.

import {
  createContext,
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
  readonly activePlaceId: string | null;
  readonly activePlaceIsHistorical: boolean;
  readonly openTour: (tour: OpenTour) => void;
  readonly closeTour: () => void;
};

const DiffTourContext = createContext<DiffTourValue | null>(null);

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

const joinedText = ({
  locations,
  side,
}: {
  readonly locations: ReadonlyArray<DiffLocation>;
  readonly side: "old" | "new";
}): string =>
  locations
    .map((location) => (side === "old" ? location.oldText : location.newText))
    .filter((text) => text !== "")
    .join("\n\n");

/** Renders the common word-level or stacked Was/Now lens vocabulary. */
export const DiffLensContent = ({
  diff,
  place,
  isHistorical,
  isSuperseded,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
  readonly isHistorical: boolean;
  readonly isSuperseded: boolean;
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
  const oldText = joinedText({ locations, side: "old" });
  const newText = joinedText({ locations, side: "new" });
  const title = isHistorical
    ? "Historical change"
    : isSuperseded
      ? "What changed - plan revised again"
      : "What changed";
  const isCode = locations.some(
    (location) => location.kind === "code" || location.kind.startsWith("code-"),
  );
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
        <p className="m-0 max-w-[var(--measure)] text-base [overflow-wrap:anywhere]">
          {runsWithChanges(only.runs)}
        </p>
      ) : (
        <div className="grid min-w-0 gap-2">
          {oldText === "" ? null : (
            <div className="min-w-0 rounded-lg bg-[var(--diff-remove-bg)] p-3 text-[var(--diff-remove-c)] inset-shadow-well">
              <strong className="mb-1 block text-2xs uppercase tracking-caps">
                Was
              </strong>
              {isCode ? (
                <pre className="m-0 max-w-full overflow-x-auto font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <code>{oldText}</code>
                </pre>
              ) : (
                <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {oldText}
                </p>
              )}
            </div>
          )}
          {newText === "" ? null : (
            <div className="min-w-0 rounded-lg bg-[var(--diff-add-bg)] p-3 text-[var(--diff-add-c)] inset-shadow-well">
              <strong className="mb-1 block text-2xs uppercase tracking-caps">
                Now
              </strong>
              {isCode ? (
                <pre className="m-0 max-w-full overflow-x-auto font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <code>{newText}</code>
                </pre>
              ) : (
                <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {newText}
                </p>
              )}
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
  useEffect(() => {
    if (!isVisible) {
      setHost(null);
      return;
    }
    const first = locations[0];
    const anchor = first === undefined ? null : anchorFor(first, isSuperseded);
    if (anchor === null) {
      setIsHistorical(true);
      setHost(null);
      return;
    }
    setIsHistorical(false);
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
  if (isHistorical) return null;
  return host === null
    ? null
    : createPortal(
        <DiffLensContent
          diff={diff}
          place={place}
          isHistorical={false}
          isSuperseded={isSuperseded}
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
  const places = useMemo(() => {
    if (tour === null) return [];
    const allowed = new Set(tour.placeIds);
    return tour.diff.places.filter((place) => allowed.has(place.placeId));
  }, [tour]);
  const active = places.at(index);
  const isHistorical =
    tour !== null &&
    active !== undefined &&
    placeLocations({ diff: tour.diff, place: active }).every(
      (location) => anchorFor(location, tour.isSuperseded === true) === null,
    );
  const closeTour = () => setTour(null);
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
      activePlaceId: active?.placeId ?? null,
      activePlaceIsHistorical: isHistorical,
      openTour,
      closeTour,
    }),
    [active?.placeId, isHistorical],
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
