// Owns the one-at-a-time What-changed tour and the stepper shared by comment
// threads and plan-wide chat. Acceptance itself belongs to the review store, so
// this reads and writes it through the verdict record rather than holding a
// copy: two surfaces show one change set's standing at the same moment, and a
// reload must not reopen work the reviewer already closed.

import {
  createContext,
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
import {
  changeVerdictKey,
  changeSetStanding,
  type ChangeSetStanding,
} from "../shared/change-verdict.js";
import { useChangeVerdicts } from "./use-change-verdicts.browser.js";
import { reviewerMessageLabel } from "../shared/reviewer-markdown.js";
import { DiffLensPortal } from "./diff-lens.browser.js";
import { tourStartIndex } from "./diff-anchor.js";
import { Icon } from "./icon.browser.js";
import { Badge, Button } from "./ui.browser.js";

type OpenTour = {
  readonly diff: SnapshotDiff;
  /** The thread whose change set this tour is reviewing, where one owns it. */
  readonly changeSetId?: string;
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
  readonly activeChangeSetId: string | null;
  readonly activePlaceId: string | null;
  readonly isPlaceAccepted: (diff: SnapshotDiff, placeId: string) => boolean;
  /** How much of one change set is closed, from the one selector that decides. */
  readonly standingOf: (
    diff: SnapshotDiff,
    placeIds: ReadonlyArray<string>,
  ) => ChangeSetStanding;
  readonly setPlacesAccepted: (
    diff: SnapshotDiff,
    placeIds: ReadonlyArray<string>,
    accepted: boolean,
  ) => void;
  /** False while this page may not record anything, so no control offers to. */
  readonly canRecordAcceptance: boolean;
  readonly openTour: (tour: OpenTour) => void;
  readonly closeTour: () => void;
};

const DiffTourContext = createContext<DiffTourValue | null>(null);
type EscapeKeyboardEvent = KeyboardEvent & {
  bigPlanEscapeHandled?: boolean;
};

// Acceptance is recorded with the review, so a page that may not write cannot
// accept anything. Two different pages land here - a read-only session, and a
// standalone rendered document that was never a session at all - so the label
// names the shared consequence rather than guessing which cause applies.
export const UNRECORDABLE_ACCEPTANCE_LABEL =
  "Accepting is unavailable because this page cannot record review state";

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
  const { accepted, canRecord, recordChangeVerdicts } = useChangeVerdicts();
  const places = useMemo(() => {
    if (tour === null) return [];
    const allowed = new Set(tour.placeIds);
    return tour.diff.places.filter((place) => allowed.has(place.placeId));
  }, [tour]);
  const active = places.at(index);
  const closeTour = () => setTour(null);
  const tourValue = useMemo(() => {
    const isPlaceAccepted = (diff: SnapshotDiff, placeId: string): boolean =>
      accepted.has(changeVerdictKey({ from: diff.from, to: diff.to, placeId }));
    return {
      isPlaceAccepted,
      standingOf: (
        diff: SnapshotDiff,
        placeIds: ReadonlyArray<string>,
      ): ChangeSetStanding =>
        changeSetStanding({
          from: diff.from,
          to: diff.to,
          placeIds,
          accepted,
        }),
      setPlacesAccepted: (
        diff: SnapshotDiff,
        placeIds: ReadonlyArray<string>,
        isAccepted: boolean,
      ): void => {
        // A gesture that would record what the store already holds is not a
        // write; sending one would advance the revision for nothing.
        const changing = placeIds.filter(
          (placeId) => isPlaceAccepted(diff, placeId) !== isAccepted,
        );
        recordChangeVerdicts({
          op: isAccepted ? "accept" : "withdraw",
          from: diff.from,
          to: diff.to,
          placeIds: changing,
        });
      },
    };
  }, [accepted, recordChangeVerdicts]);
  const { isPlaceAccepted, standingOf, setPlacesAccepted } = tourValue;
  const openTour = (next: OpenTour): void => {
    setTour(next);
    setIndex(tourStartIndex(next));
    // The lens scrolls itself into view once it knows where it landed. A scroll
    // from here could only guess, and picking the document's first lens would
    // send the reader to a historical change instead of the one they opened.
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const escapeEvent = event as EscapeKeyboardEvent;
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        tour === null ||
        escapeEvent.bigPlanEscapeHandled === true
      )
        return;
      event.preventDefault();
      escapeEvent.bigPlanEscapeHandled = true;
      closeTour();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tour]);
  const value = useMemo<DiffTourValue>(
    () => ({
      activeDiff: tour?.diff ?? null,
      activeChangeSetId: tour?.changeSetId ?? null,
      activePlaceId: active?.placeId ?? null,
      canRecordAcceptance: canRecord,
      ...tourValue,
      openTour,
      closeTour,
    }),
    [active?.placeId, canRecord, tourValue, tour],
  );
  const isActiveAccepted =
    tour !== null &&
    active !== undefined &&
    isPlaceAccepted(tour.diff, active.placeId);
  const standing =
    tour === null
      ? null
      : standingOf(
          tour.diff,
          places.map((place) => place.placeId),
        );
  const allAccepted = standing?.isAccepted === true;
  useEffect(() => {
    if (!allAccepted) setShowCompletionSummary(false);
    else setShowCompletionSummary(true);
  }, [allAccepted, tour?.diff.from, tour?.diff.to]);

  /** Accepts the current evidence and advances to the next open decision. */
  const acceptActivePlace = (): void => {
    if (tour === null || active === undefined) return;
    if (isActiveAccepted) {
      setPlacesAccepted(tour.diff, [active.placeId], false);
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
            isAccepted={isActiveAccepted}
          />
          <div
            // The bar floats clear of the viewport edge rather than hugging
            // it, and holds a wide enough measure that the change it is
            // reviewing and the thread that caused it read as two separate
            // ends of the same row.
            className="fixed right-4 bottom-11 left-4 z-40 mx-auto grid w-auto min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl border border-edge-strong bg-raised text-xs text-ink shadow-floating wide:w-fit wide:min-w-lg"
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
              {showCompletionSummary && standing !== null ? (
                <Badge tone="statusAccent" size="status">
                  All changes accepted ({standing.accepted} of {standing.total})
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
                  className="min-w-0 max-w-64 justify-start [&>svg]:size-4 [&>svg]:shrink-0"
                  aria-label={`Open comment thread: ${reviewerMessageLabel(tour.thread.label)}`}
                  onClick={tour.thread.onOpen}
                >
                  <Icon icon={MESSAGE_SQUARE_ICON} />
                  <span className="min-w-0 truncate">
                    {reviewerMessageLabel(tour.thread.label)}
                  </span>
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
                      disabled={!canRecord}
                      aria-label={
                        canRecord
                          ? "Accept all changes"
                          : UNRECORDABLE_ACCEPTANCE_LABEL
                      }
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
                        disabled={!canRecord}
                        aria-label={
                          canRecord
                            ? "Undo acceptance for this change"
                            : UNRECORDABLE_ACCEPTANCE_LABEL
                        }
                        onClick={acceptActivePlace}
                      >
                        Undo
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="micro"
                      disabled={!canRecord}
                      aria-label={
                        canRecord
                          ? "Accept this change"
                          : UNRECORDABLE_ACCEPTANCE_LABEL
                      }
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
