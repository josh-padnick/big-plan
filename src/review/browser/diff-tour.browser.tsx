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
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { EYE_ICON } from "../../icons/lucide/eye.js";
import { EYE_OFF_ICON } from "../../icons/lucide/eye-off.js";
import { UNDO_2_ICON } from "../../icons/lucide/undo-2.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { BAN_ICON } from "../../icons/lucide/ban.js";
import { CIRCLE_CHECK_ICON } from "../../icons/lucide/circle-check.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { X_ICON } from "../../icons/lucide/x.js";
import type { SnapshotDiff } from "../shared/review-wire.js";
import {
  changeDispositionOf,
  changeSetStanding,
  type ChangeDisposition,
  type ChangeSetStanding,
} from "../shared/change-verdict.js";
import {
  useChangeVerdicts,
  type VerdictWriteResult,
} from "./use-change-verdicts.browser.js";
import { reviewerMessageLabel } from "../shared/reviewer-markdown.js";
import { DiffLensPortal } from "./diff-lens.browser.js";
import { tourStartIndex } from "./diff-anchor.js";
import { advancedTourPlaceId } from "./tour-advance.js";
import { Icon } from "./icon.browser.js";
import { Badge, Button } from "./ui.browser.js";
import { OverflowMenu } from "./overflow-menu.browser.js";
import {
  ChangeChatDrawer,
  type ChangeChatValue,
} from "./change-chat-drawer.browser.js";
import { changeChatMessage } from "../shared/change-chat.js";

type OpenTour = {
  readonly diff: SnapshotDiff;
  /** The thread whose change set this tour is reviewing, where one owns it. */
  readonly changeSetId?: string;
  readonly placeIds: ReadonlyArray<string>;
  readonly startPlaceId?: string;
  readonly isSuperseded?: boolean;
  /**
   * True when this tour compares the plan as it was when the reviewer
   * commented with the plan now, rather than reviewing a change set an agent
   * published.
   *
   * It is a different thing to look at, and it must read as one: nobody
   * proposed this, so there is nothing here to accept or reject, and a verdict
   * recorded against it would restore a baseline over another thread's work.
   */
  readonly isPremiseView?: boolean;
  readonly onResolve?: () => void;
  /**
   * Opens the confirmation that deletes the thread this change set belongs to.
   * What that deletion costs is derived where the thread is, not here: the
   * dialog has to name the content it removes, and the tour holds only the
   * places, not the thread the reviewer is about to lose.
   */
  readonly onDeleteThread?: () => void;
  readonly thread?: {
    readonly label: string;
    readonly onOpen: () => void;
  };
  /**
   * The thread whose conversation the drawer shows. It is an id rather than
   * the conversation itself because the conversation outlives every card that
   * could hand one over: a staged comment becomes a sent thread the moment it
   * is sent, and the card that was supplying the messages unmounts mid-answer.
   * One owner that always has the exchange publishes it against this id.
   */
  readonly chatThreadId?: string;
  /** The conversation itself, kept current by that owner. */
  readonly chat?: ChangeChatValue;
};

type DiffTourValue = {
  readonly activeDiff: SnapshotDiff | null;
  readonly activeChangeSetId: string | null;
  /**
   * Whether the open tour is comparing a revision the plan has since moved
   * past. It lives here rather than only in the card that opened the tour
   * because the plan can advance while the reviewer is reading, and a fact
   * captured at open time would go on saying the ground had not moved.
   */
  readonly activeIsSuperseded: boolean | null;
  /** The thread the open tour is chatting in, so its owner can publish it. */
  readonly activeChatThreadId: string | null;
  /**
   * The block the open tour's current change is about, which is what narrows
   * the conversation to that change rather than to the whole thread.
   */
  readonly activeChangeBlockId: string | null;
  readonly activePlaceId: string | null;
  readonly isPlaceAccepted: (diff: SnapshotDiff, placeId: string) => boolean;
  /**
   * What the review has decided about one place. Every surface that presents a
   * change asks this rather than reading the record itself, so a verdict added
   * later reaches all of them through one selector - which is how the reject
   * verdict arrives as a third answer here rather than a second question.
   */
  readonly dispositionOf: (
    diff: SnapshotDiff,
    placeId: string,
  ) => ChangeDisposition;
  /** How much of one change set is closed, from the one selector that decides. */
  readonly standingOf: (
    diff: SnapshotDiff,
    placeIds: ReadonlyArray<string>,
  ) => ChangeSetStanding;
  /**
   * Records one verdict over the named places, or takes back whatever verdict
   * they hold. `undefined` is undo rather than a third verdict, because the
   * record stores no such row: a change nobody has decided is a change with no
   * entry in it.
   */
  readonly setPlacesDecided: (
    diff: SnapshotDiff,
    placeIds: ReadonlyArray<string>,
    verdict: "accepted" | "rejected" | undefined,
    options?: { readonly onlyUndecided: boolean },
  ) => Promise<VerdictWriteResult>;
  /** False while this page may not record anything, so no control offers to. */
  readonly canRecordAcceptance: boolean;
  /** Keys closed specifically by the session's auto-accept mode. */
  readonly autoAccepted: ReadonlySet<string>;
  /** Re-read verdicts after arming auto-accept closes the current thread. */
  readonly refreshVerdicts: () => void;
  readonly openTour: (tour: OpenTour) => void;
  /**
   * Keeps the open tour's conversation current.
   *
   * The tour is opened once and read for as long as the reviewer stays in it,
   * so a conversation captured at that moment would never show the answer they
   * are waiting for. The owner of the thread pushes each new turn in rather
   * than the bar reaching for one, because only the owner knows which thread
   * the set belongs to.
   */
  readonly syncTourChat: (input: {
    readonly threadId: string;
    readonly chat: ChangeChatValue;
  }) => void;
  /**
   * Keeps the open tour's comparison current.
   *
   * The reviewer is owed the latest comparison of whatever they are standing
   * on, and the plan can advance under them at any moment - a reply of their
   * own commits, or an agent publishes. The owner pushes the recomputed diff
   * in, rather than the card that opened the tour reaching for it, because
   * that card is unmounted whenever the feedback rail is closed and the
   * reviewer's right to see the truth does not depend on which panels they
   * happen to have open.
   *
   * Only the comparison is replaced. The reviewer keeps their place, found in
   * the advanced set by the block it is about, because every place is renamed
   * when the set's bounds move.
   */
  readonly syncTourDiff: (input: {
    readonly changeSetId: string;
    readonly diff: SnapshotDiff;
    readonly placeIds: ReadonlyArray<string>;
    readonly isSuperseded: boolean;
  }) => void;
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
  // The tour as the handlers see it, so opening one can ask what the last one
  // was without taking a dependency on the render that created it.
  const tourRef = useRef<OpenTour | null>(null);
  const [index, setIndex] = useState(0);
  const [showCompletionSummary, setShowCompletionSummary] = useState(false);
  // Which accepted place the reviewer has asked to see the evidence for. It is
  // one place rather than a flag because the ask is about the change in front
  // of them: carrying it to the next place would put the proposal treatment
  // back on a change they never asked to reopen.
  const [shownChangesPlaceId, setShownChangesPlaceId] = useState<string | null>(
    null,
  );
  // Bumped when the reviewer asks for a change back. Undo is the one gesture
  // that reopens a question rather than answering one, so it owes the reader
  // the change itself - and they may have scrolled anywhere since deciding it.
  const [revealCount, setRevealCount] = useState(0);
  // Whether the conversation is open under the bar. Closed on every new tour,
  // because the reviewer opened a change to read it, not to talk about it.
  const [isChatOpen, setIsChatOpen] = useState(false);
  useEffect(() => {
    tourRef.current = tour;
  }, [tour]);
  const {
    accepted,
    rejected,
    autoAccepted,
    canRecord,
    recordChangeVerdicts,
    refresh,
  } = useChangeVerdicts();
  const places = useMemo(() => {
    if (tour === null) return [];
    const allowed = new Set(tour.placeIds);
    return tour.diff.places.filter((place) => allowed.has(place.placeId));
  }, [tour]);
  const active = places.at(index);
  // The block the current change is about, which is how a message is tied to
  // it: a place id belongs to one revision and stops naming anything once the
  // agent publishes the next, while the block survives being reworded again.
  const activeChangeBlockId =
    tour === null || active === undefined
      ? undefined
      : active.locationIndexes
          .map((locationIndex) => tour.diff.locations.at(locationIndex))
          .flatMap((location) => {
            const blockId = location?.newBlockId ?? location?.oldBlockId;
            return blockId === undefined ? [] : [blockId];
          })
          .at(0);
  const closeTour = () => {
    setShownChangesPlaceId(null);
    setIsChatOpen(false);
    setTour(null);
  };
  // The stepper floats over the end of the document, so the last change in a
  // set has nowhere to rise to: the page is already scrolled as far as it goes
  // and the change stays behind the bar, which is exactly where a reader
  // cannot read it. Room is reserved under the plan for as long as a tour is
  // open, and given back when it closes, so every change in the set can reach
  // the same reading position as the first.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tour === null) return;
    const root = document.documentElement;
    root.dataset.reviewTourOpen = "";
    // The reserve follows the bar, because the bar is not one height: opening
    // the chat drawer roughly triples it, and a fixed reserve would leave the
    // change the reviewer is discussing permanently behind the drawer they are
    // discussing it in, with no scroll left to lift it clear.
    const publishReserve = (): void => {
      const height = barRef.current?.getBoundingClientRect().height ?? 0;
      root.style.setProperty(
        "--review-tour-reserve",
        `${Math.round(height + 96)}px`,
      );
    };
    publishReserve();
    const bar = barRef.current;
    const observer =
      bar === null ? null : new ResizeObserver(() => publishReserve());
    if (bar !== null && observer !== null) observer.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--review-tour-reserve");
      delete root.dataset.reviewTourOpen;
    };
  }, [tour]);
  const tourValue = useMemo(() => {
    const dispositionOf = (
      diff: SnapshotDiff,
      placeId: string,
    ): ChangeDisposition =>
      changeDispositionOf({
        address: { from: diff.from, to: diff.to, placeId },
        accepted,
        rejected,
      });
    const isPlaceAccepted = (diff: SnapshotDiff, placeId: string): boolean =>
      dispositionOf(diff, placeId) === "accepted";
    return {
      isPlaceAccepted,
      dispositionOf,
      standingOf: (
        diff: SnapshotDiff,
        placeIds: ReadonlyArray<string>,
      ): ChangeSetStanding =>
        changeSetStanding({
          from: diff.from,
          to: diff.to,
          placeIds,
          accepted,
          rejected,
        }),
      setPlacesDecided: (
        diff: SnapshotDiff,
        placeIds: ReadonlyArray<string>,
        verdict: "accepted" | "rejected" | undefined,
        options?: { readonly onlyUndecided: boolean },
      ): Promise<VerdictWriteResult> => {
        // A gesture that would record what the store already holds is not a
        // write; sending one would advance the revision for nothing.
        const changing = placeIds.filter(
          (placeId) =>
            dispositionOf(diff, placeId) !== (verdict ?? "undecided"),
        );
        // Only two of the four gestures move bytes: rejecting takes a change
        // back out of the plan, and undoing a rejection puts it back. The
        // other two are pure record writes, so nothing downstream should wait
        // on an article swap that is never coming.
        const movesPlanSource =
          verdict === "rejected" ||
          (verdict === undefined &&
            changing.some(
              (placeId) => dispositionOf(diff, placeId) === "rejected",
            ));
        return recordChangeVerdicts({
          op:
            verdict === "accepted"
              ? "accept"
              : verdict === "rejected"
                ? "reject"
                : "undo",
          from: diff.from,
          to: diff.to,
          placeIds: changing,
          movesPlanSource,
          ...(options === undefined ? {} : options),
        });
      },
    };
  }, [accepted, recordChangeVerdicts, rejected]);
  const { dispositionOf, standingOf, setPlacesDecided } = tourValue;
  // Replacing only the conversation leaves every other thing the tour is
  // holding - which change, which verdict, where the reader is - untouched.
  const syncTourChat = ({
    threadId,
    chat,
  }: {
    readonly threadId: string;
    readonly chat: ChangeChatValue;
  }): void => {
    setTour((current) =>
      current === null || current.chatThreadId !== threadId
        ? current
        : { ...current, chat },
    );
  };
  const syncTourDiff = ({
    changeSetId,
    diff,
    placeIds,
    isSuperseded,
  }: {
    readonly changeSetId: string;
    readonly diff: SnapshotDiff;
    readonly placeIds: ReadonlyArray<string>;
    readonly isSuperseded: boolean;
  }): void => {
    setTour((current) => {
      if (current === null || current.changeSetId !== changeSetId) {
        return current;
      }
      const isSameComparison =
        current.diff.from === diff.from && current.diff.to === diff.to;
      if (isSameComparison && current.isSuperseded === isSuperseded) {
        return current;
      }
      const startPlaceId = isSameComparison
        ? current.startPlaceId
        : advancedTourPlaceId({
            activeDiff: current.diff,
            activePlaceId: active?.placeId ?? null,
            diff,
            placeIds,
          });
      const next = {
        ...current,
        diff,
        placeIds,
        isSuperseded,
        ...(startPlaceId === undefined ? {} : { startPlaceId }),
      };
      // Every place is renamed when the bounds move, so the index the reviewer
      // was on names a different change in the new set - or none at all.
      if (!isSameComparison) setIndex(tourStartIndex(next));
      return next;
    });
  };
  const openTour = (next: OpenTour): void => {
    setShownChangesPlaceId(null);
    // A tour re-opened on the same thread is the same review advancing, not a
    // new one: the agent answered and the set moved on. Closing the drawer
    // there would take the conversation away at the exact moment it produced
    // something - which is the moment the reviewer most wants to read it.
    setIsChatOpen(
      (open) =>
        open &&
        next.chatThreadId !== undefined &&
        next.chatThreadId === tourRef.current?.chatThreadId,
    );
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
      activeIsSuperseded: tour?.isSuperseded ?? null,
      activeChatThreadId: tour?.chatThreadId ?? null,
      activeChangeBlockId: activeChangeBlockId ?? null,
      activePlaceId: active?.placeId ?? null,
      canRecordAcceptance: canRecord,
      autoAccepted,
      refreshVerdicts: refresh,
      ...tourValue,
      openTour,
      syncTourChat,
      syncTourDiff,
      closeTour,
    }),
    [
      active?.placeId,
      activeChangeBlockId,
      autoAccepted,
      canRecord,
      refresh,
      tourValue,
      tour,
    ],
  );
  const activeDisposition =
    tour === null || active === undefined
      ? null
      : dispositionOf(tour.diff, active.placeId);
  const isActiveAccepted = activeDisposition === "accepted";
  const isActiveRejected = activeDisposition === "rejected";
  // Whether the current change is one the reviewer has already answered. A
  // premise view is a comparison, not a proposal, so it is never "decided": it
  // carries no verdict and its bar keeps the undecided shape. The decided bar
  // is a different row from the undecided one - it drops Chat (the decision is
  // made, so the conversation belongs in the thread the top-row link reaches),
  // and it moves the verdict badge to the far right - so it is worth one name.
  const isPremiseView = tour?.isPremiseView === true;
  const isActiveDecided =
    !isPremiseView && (isActiveAccepted || isActiveRejected);
  const isShowingActiveChanges =
    active !== undefined && shownChangesPlaceId === active.placeId;
  const standing =
    tour === null
      ? null
      : standingOf(
          tour.diff,
          places.map((place) => place.placeId),
        );
  const allDecided = standing?.isSettled === true;
  const openCount = standing?.open ?? 0;
  useEffect(() => {
    if (!allDecided) setShowCompletionSummary(false);
    else setShowCompletionSummary(true);
  }, [allDecided, tour?.diff.from, tour?.diff.to]);
  // Opening or closing the drawer moves the bar's top edge, which is the floor
  // the change is positioned above. Without re-placing it, the conversation
  // the reviewer just opened covers the change they opened it about.
  const isChatOpenRef = useRef(isChatOpen);
  useEffect(() => {
    if (isChatOpenRef.current === isChatOpen) return;
    isChatOpenRef.current = isChatOpen;
    setRevealCount((count) => count + 1);
  }, [isChatOpen]);

  /** The places in this set nobody has decided, in document order. */
  const undecidedPlaceIds = (): ReadonlyArray<string> =>
    tour === null
      ? []
      : places
          .filter(
            (place) => dispositionOf(tour.diff, place.placeId) === "undecided",
          )
          .map((place) => place.placeId);

  /** Takes back whatever verdict the current change holds. */
  const undoActivePlace = (): void => {
    if (tour === null || active === undefined) return;
    // Undo is a return to undecided, so the change is asking to be decided
    // again and the evidence it was decided against comes back with it - and
    // the reader is taken to it, because a change they cannot see is not one
    // they can decide.
    setShownChangesPlaceId(null);
    setRevealCount((count) => count + 1);
    void setPlacesDecided(tour.diff, [active.placeId], undefined);
  };

  /** Answers the current change and advances to the next open decision. */
  const decideActivePlace = (verdict: "accepted" | "rejected"): void => {
    if (tour === null || active === undefined) return;
    // Either direction settles the question the evidence was open for, so the
    // reviewer's ask to see it does not survive the answer: an undecided place
    // shows its proposal again, and one accepted a second time is plan content
    // again rather than the card the reviewer last had open.
    setShownChangesPlaceId(null);
    // Under the hood the conversation belongs to the thread, but to the
    // reviewer this drawer is about the one change in front of them. Answering
    // that change ends what the drawer was for, so it closes with the answer.
    setIsChatOpen(false);
    void setPlacesDecided(tour.diff, [active.placeId], verdict);
    const nextIndex = places.findIndex(
      (place, placeIndex) =>
        placeIndex > index &&
        dispositionOf(tour.diff, place.placeId) === "undecided",
    );
    if (nextIndex >= 0) {
      setIndex(nextIndex);
    }
  };

  /** Records one verdict over everything in the set nobody has decided yet. */
  const decideEveryOpenPlace = (verdict: "accepted" | "rejected"): void => {
    if (tour === null) return;
    const undecided = undecidedPlaceIds();
    if (undecided.length === 0) return;
    setShownChangesPlaceId(null);
    void setPlacesDecided(tour.diff, undecided, verdict, {
      onlyUndecided: true,
    });
  };
  return (
    <DiffTourContext.Provider value={value}>
      {children}
      {tour === null || active === undefined ? null : (
        <>
          {!isActiveRejected || isShowingActiveChanges ? (
            <DiffLensPortal
              diff={tour.diff}
              place={active}
              isVisible
              isSuperseded={tour.isSuperseded === true}
              isAccepted={isActiveAccepted}
              isShowingChanges={isShowingActiveChanges}
              revealKey={revealCount}
            />
          ) : null}
          <div
            // The bar floats clear of the viewport edge rather than hugging
            // it, and holds a wide enough measure that the change it is
            // reviewing and the thread that caused it read as two separate
            // ends of the same row.
            ref={barRef}
            className="fixed right-4 bottom-11 left-4 z-40 mx-auto grid max-h-[min(70vh,34rem)] w-auto min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-edge-strong bg-raised text-xs text-ink shadow-floating wide:w-fit wide:min-w-2xl wide:max-w-4xl"
            data-review-diff-stepper=""
          >
            <div className="flex min-w-0 items-center gap-2 border-b border-accent bg-[color-mix(in_srgb,var(--accent-c)_10%,var(--raised))] px-3 py-2">
              {/* The title says which of the two states the bar is in, so a
                  finished set does not read as one still asking to be
                  reviewed. How it finished is already drawn beside every
                  change in the digest, and repeating it as a tally here only
                  asks the reader to hold two numbers they cannot act on. */}
              {/* A premise view is a comparison, not a proposal: it says what
                  moved under the reviewer's comment while they were writing
                  it. Naming it as a change set is what made one block look
                  like it had two identical diffs with nothing to tell them
                  apart. */}
              <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-ink [&>svg]:size-3.5">
                <Icon icon={CHECK_ICON} />
                {tour.isPremiseView === true
                  ? "Since your comment"
                  : showCompletionSummary
                    ? "All changes decided"
                    : "Reviewing change set"}
              </span>
              {showCompletionSummary ? null : (
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
              {/* The label follows the thread rather than the moment the tour
                  opened: a draft the drawer rewrites keeps announcing the
                  sentence it no longer says otherwise. */}
              {tour.thread === undefined ? null : (
                <Button
                  variant="ghost"
                  size="compact"
                  className="min-w-0 max-w-64 justify-start [&>svg]:size-4 [&>svg]:shrink-0"
                  aria-label={`Open comment thread: ${reviewerMessageLabel(tour.chat?.threadLabel ?? tour.thread.label)}`}
                  onClick={tour.thread.onOpen}
                >
                  <Icon icon={MESSAGE_SQUARE_ICON} />
                  <span className="min-w-0 truncate">
                    {reviewerMessageLabel(
                      tour.chat?.threadLabel ?? tour.thread.label,
                    )}
                  </span>
                </Button>
              )}
            </div>
            <div
              className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2"
              data-review-bar-actions=""
            >
              {showCompletionSummary && tour.isPremiseView !== true ? (
                <>
                  <Button
                    variant="outline"
                    size="micro"
                    onClick={() => setShowCompletionSummary(false)}
                  >
                    Back to review
                  </Button>
                  <span className="min-w-0 flex-1" />
                  {tour.chat === undefined ? null : (
                    <Button
                      variant="secondary"
                      size="micro"
                      aria-pressed={isChatOpen}
                      onClick={() => setIsChatOpen((open) => !open)}
                    >
                      <Icon icon={MESSAGE_SQUARE_ICON} />
                      Chat
                    </Button>
                  )}
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
                  {/* A reviewer who does not want this change as written has
                      two answers, not one: reject it, or say what they want
                      instead. Chat is that second answer, so it sits in the
                      row beside the two verdicts - and it opens under the bar
                      rather than navigating away, because the change has to
                      stay in view while they describe what it should say. Once
                      the change is decided the conversation moves on: the
                      reviewer talks in the thread, which the top-row link
                      already reaches, so the decided row drops Chat. */}
                  {isActiveDecided || tour.chat === undefined ? null : (
                    <Button
                      variant="outline"
                      size="micro"
                      aria-pressed={isChatOpen}
                      aria-label="Chat about this change"
                      onClick={() => setIsChatOpen((open) => !open)}
                    >
                      <Icon icon={MESSAGE_SQUARE_ICON} />
                      Chat
                    </Button>
                  )}
                  {isPremiseView ? null : isActiveDecided ? (
                    <>
                      <Button
                        variant="outline"
                        size="micro"
                        aria-pressed={isShowingActiveChanges}
                        onClick={() =>
                          setShownChangesPlaceId(
                            isShowingActiveChanges ? null : active.placeId,
                          )
                        }
                      >
                        <Icon
                          icon={
                            isShowingActiveChanges ? EYE_OFF_ICON : EYE_ICON
                          }
                        />
                        {isShowingActiveChanges
                          ? "Hide changes"
                          : "View changes"}
                      </Button>
                      {/* One control takes back whichever verdict the change
                          holds, and says the same word either way: the change
                          returns to undecided, and what it returns from is
                          already on the badge beside it. */}
                      <Button
                        variant="secondary"
                        size="micro"
                        disabled={!canRecord}
                        aria-label={
                          canRecord
                            ? isActiveRejected
                              ? "Undo rejection for this change"
                              : "Undo acceptance for this change"
                            : UNRECORDABLE_ACCEPTANCE_LABEL
                        }
                        onClick={undoActivePlace}
                      >
                        <Icon icon={UNDO_2_ICON} />
                        Undo
                      </Button>
                      {/* The verdict badge is the row's outcome, so it sits
                          after the actions that produced it and reads as what
                          the row settled on rather than another control. The
                          set-wide overflow follows it at the far right, because
                          it acts on the whole set, not on this decided change. */}
                      <Badge
                        tone={
                          isActiveRejected ? "statusDanger" : "statusAccent"
                        }
                        size="status"
                        data-review-verdict-badge=""
                      >
                        {isActiveRejected ? "Rejected" : "Accepted"}
                      </Badge>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="micro"
                        className="hover:border-danger hover:text-danger"
                        disabled={!canRecord}
                        aria-label={
                          canRecord
                            ? "Reject this change"
                            : UNRECORDABLE_ACCEPTANCE_LABEL
                        }
                        onClick={() => decideActivePlace("rejected")}
                      >
                        <Icon icon={BAN_ICON} />
                        Reject change
                      </Button>
                      <Button
                        size="micro"
                        disabled={!canRecord}
                        aria-label={
                          canRecord
                            ? "Accept this change"
                            : UNRECORDABLE_ACCEPTANCE_LABEL
                        }
                        onClick={() => decideActivePlace("accepted")}
                      >
                        <Icon icon={CHECK_ICON} />
                        Accept change
                      </Button>
                    </>
                  )}
                  {/* Deciding the whole set at once, and deleting the thread
                      that proposed it, sit behind the row rather than in it.
                      Each one is rarer than the per-change answer beside them
                      and heavier than it, and a row of five equally weighted
                      buttons would make the common answer harder to find. */}
                  {tour.isPremiseView === true ? null : (
                    <OverflowMenu
                      label="More change set actions"
                      items={[
                        {
                          id: "accept-all",
                          label: "Accept all changes",
                          icon: CIRCLE_CHECK_ICON,
                          disabled: !canRecord || openCount === 0,
                          description:
                            openCount === 0
                              ? "Every change in this set is decided"
                              : `${openCount} still undecided`,
                          onSelect: () => decideEveryOpenPlace("accepted"),
                        },
                        {
                          id: "reject-all",
                          label: "Reject all changes",
                          icon: BAN_ICON,
                          disabled: !canRecord || openCount === 0,
                          description:
                            openCount === 0
                              ? "Every change in this set is decided"
                              : "Takes them back out of the plan",
                          onSelect: () => decideEveryOpenPlace("rejected"),
                        },
                        ...(tour.onDeleteThread === undefined
                          ? []
                          : [
                              {
                                id: "delete-thread",
                                label: "Delete thread",
                                icon: TRASH_2_ICON,
                                tone: "danger" as const,
                                disabled: !canRecord,
                                description:
                                  "Rejects every undecided change and deletes the thread",
                                onSelect: () => tour.onDeleteThread?.(),
                              },
                            ]),
                      ]}
                    />
                  )}
                </>
              )}
            </div>
            {tour.chat === undefined || !isChatOpen ? null : (
              <ChangeChatDrawer
                chat={{
                  ...tour.chat,
                  onSend: (body) =>
                    tour.chat?.onSend(
                      changeChatMessage({
                        body,
                        subject: {
                          section: active.section,
                          note: active.note,
                          position: {
                            index: index + 1,
                            total: places.length,
                          },
                        },
                      }),
                    ),
                }}
                subjectLabel={
                  active.section.trim() === ""
                    ? "this change"
                    : active.section.trim()
                }
                onShowChange={() => setRevealCount((count) => count + 1)}
                onClose={() => setIsChatOpen(false)}
              />
            )}
          </div>
        </>
      )}
    </DiffTourContext.Provider>
  );
};
