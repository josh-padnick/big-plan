// Owns the one-at-a-time What-changed tour, acceptance state, and stepper
// shared by comment threads and plan-wide chat.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { X_ICON } from "../../icons/lucide/x.js";
import type { SnapshotDiff } from "../shared/review-wire.js";
import { DiffLensPortal } from "./diff-lens.browser.js";
import { tourStartIndex } from "./diff-anchor.js";
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
  readonly thread?: {
    readonly label: string;
    readonly onOpen: () => void;
  };
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
          <DiffLensPortal
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
              {tour.thread === undefined ? null : (
                <Button
                  variant="ghost"
                  size="compact"
                  className="min-w-0 max-w-64 justify-start [&>svg]:size-4"
                  aria-label={`Open comment thread: ${tour.thread.label}`}
                  onClick={tour.thread.onOpen}
                >
                  <Icon icon={MESSAGE_SQUARE_ICON} />
                  <span className="truncate">{tour.thread.label}</span>
                </Button>
              )}
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
