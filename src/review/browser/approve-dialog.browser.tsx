// Owns the approve moment in the review island: the toolbar control, the
// confirmation dialog, the approved control that replaces that trigger, and
// the details popover that can revoke. The record itself is written by the
// runtime; this file only asks and paints what comes back.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_DOWN_ICON } from "../../icons/lucide/chevron-down.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { PENCIL_ICON } from "../../icons/lucide/pencil.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import { X_ICON } from "../../icons/lucide/x.js";
import {
  effectiveApprovalMessage,
  APPROVAL_MESSAGE_STORAGE_KEY,
} from "../shared/approval-message.js";
import {
  approvedAtExactLabel,
  approvedOnLabel,
  unansweredNonCriticalCopy,
} from "../shared/approval-copy.js";
import type { ApprovalSummary } from "../shared/approval.js";
import {
  approveChangeSetCaveat,
  approveDecisionCaveat,
  changeSetsFromExchange,
  deriveOpenItems,
  openRequestsFromExchange,
  sectionIdFromLabel,
  titleAfterSectionId,
  type DerivedOpenItems,
  type OpenChangeSet,
  type OpenDecision,
  type OpenRequest,
} from "../shared/open-items.js";
import {
  decodeApprovalSummary,
  decodeReviewInputContract,
  decodeSnapshotDiff,
  type AgentSnapshot,
  type SnapshotDiff,
} from "../shared/review-wire.js";
import {
  emptyReviewInputContract,
  type ReviewInputContract,
} from "../shared/input-contract.js";
import { Icon } from "./icon.browser.js";
import { requestOpenInputs } from "./inputs-surface.browser.js";
import {
  foundElement,
  liveBlock,
  liveDecisionFigure,
} from "./live-target.browser.js";
import {
  onAppliedReviewRecord,
  requestJson,
  type RuntimeIdentity,
} from "./review-runtime-client.browser.js";
import { useChangeVerdicts } from "./use-change-verdicts.browser.js";
import { useDiffTour } from "./diff-tour.browser.js";
import {
  placeAnchoredDialog,
  type AnchoredDialogPosition,
} from "./alert-dialog-position.js";
import { AlertDialog, Badge, Button } from "./ui.browser.js";

const VIEW_ALL_LIMIT = 3;
const APPROVE_IN_FLIGHT_CAVEAT = "Approving now cancels all in-flight work.";

const APPROVE_ITEM_ROW_CLASS =
  "flex min-h-11 w-full cursor-pointer gap-2 rounded-md border border-edge bg-raised px-3 py-2 text-left hover:bg-surface focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent";

const APPROVE_ITEM_ACTION_CLASS = "shrink-0 text-xs font-medium text-accent";

const showLiveElement = (element: HTMLElement): void => {
  element.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
};

const showDecision = (decisionId: string): void => {
  const decision = liveDecisionFigure(decisionId);
  if ("missing" in decision) return;
  showLiveElement(decision.found);
};

const openApprovalMessageSettings = (): void => {
  document.dispatchEvent(
    new CustomEvent("bigplan:open-settings", {
      detail: { category: "approval-message" },
    }),
  );
};

const openSettingsAndClose = (close: () => void): void => {
  close();
  queueMicrotask(() => {
    openApprovalMessageSettings();
  });
};

const readStoredMessage = (): string => {
  try {
    return effectiveApprovalMessage(
      localStorage.getItem(APPROVAL_MESSAGE_STORAGE_KEY),
    );
  } catch {
    return effectiveApprovalMessage(null);
  }
};

const APPROVE_CONTROL_BASE =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium shadow-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent active:inset-shadow-pressed wide:px-2 [&>svg]:size-3.5";

const APPROVE_TRIGGER_CLASS = `${APPROVE_CONTROL_BASE} border border-approve-action-edge bg-approve-action text-approve-action-ink hover:brightness-95 hover:shadow-raised aria-expanded:shadow-raised`;

const APPROVE_APPROVED_CLASS = `${APPROVE_CONTROL_BASE} border border-review-panel-edge bg-transparent text-ink hover:border-review-panel-edge-strong hover:bg-toolbar-surface aria-expanded:border-review-panel-edge-strong aria-expanded:bg-toolbar-surface aria-expanded:inset-shadow-pressed`;

const STAMP_FRAME =
  "inline-flex rounded-md border-2 border-accent p-0.5 bg-paper";

const STAMP_INNER =
  "inline-flex items-center justify-center rounded-sm border border-accent bg-transparent px-1.5 py-0.5";

const STAMP_TYPE =
  "text-2xs font-bold tracking-caps whitespace-nowrap text-accent uppercase";

const ApprovedStampMark = () => (
  <span className={STAMP_FRAME}>
    <span className={STAMP_INNER}>
      <span className={STAMP_TYPE}>Approved</span>
    </span>
  </span>
);

/** A rubber-stamp mark just above the plan title, on the reading surface. */
const ApprovedStampOverlay = () => {
  const [slot, setSlot] = useState<HTMLElement | null>(() =>
    document.querySelector<HTMLElement>("[data-review-approval-page-stamp]"),
  );

  useLayoutEffect(() => {
    const read = () =>
      setSlot(
        document.querySelector<HTMLElement>(
          "[data-review-approval-page-stamp]",
        ),
      );
    read();
    document.addEventListener("bigplan:article-replaced", read);
    return () => document.removeEventListener("bigplan:article-replaced", read);
  }, []);

  useLayoutEffect(() => {
    if (slot === null) return;
    slot.hidden = false;
    return () => {
      slot.hidden = true;
    };
  }, [slot]);

  if (slot === null) return null;
  return createPortal(
    <span aria-hidden="true" data-review-approval-stamp="">
      <ApprovedStampMark />
    </span>,
    slot,
  );
};

const QuietCheck = () => (
  <span
    className="mt-0.5 inline-flex size-3.5 shrink-0 text-[var(--callout-tip-c)]"
    aria-hidden="true"
  >
    <Icon icon={CHECK_ICON} />
  </span>
);

const Disclosure = ({
  id,
  title,
  count,
  complete,
  defaultOpen,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly count: string;
  readonly complete: boolean;
  readonly defaultOpen: boolean;
  readonly children: ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `${id}-panel`;
  return (
    <div className="min-w-0 rounded-lg border border-edge bg-paper">
      <button
        type="button"
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        data-review-approve-disclosure={id}
      >
        <span
          className={
            complete
              ? "inline-flex size-4 shrink-0 text-accent"
              : "inline-flex size-4 shrink-0 text-[var(--callout-warning-c)]"
          }
          aria-hidden="true"
        >
          <Icon icon={complete ? CHECK_ICON : TRIANGLE_ALERT_ICON} />
        </span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-ink">
          {title}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {count}
        </span>
        <span
          className={`inline-flex size-4 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          <Icon icon={CHEVRON_RIGHT_ICON} />
        </span>
      </button>
      {open ? (
        <div id={panelId} className="border-t border-edge py-2">
          {children}
        </div>
      ) : null}
    </div>
  );
};

const BoundedList = ({
  items,
}: {
  readonly items: ReadonlyArray<ReactNode>;
}) => {
  const extra = items.length - VIEW_ALL_LIMIT;
  const shown = extra > 0 ? items.slice(0, VIEW_ALL_LIMIT) : items;
  return (
    <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 px-3">
      {shown}
      {extra > 0 ? (
        <li className="px-1 py-1 text-xs text-muted">{`View all ${items.length}`}</li>
      ) : null}
    </ul>
  );
};

const SectionKicker = ({
  sectionId,
}: {
  readonly sectionId: string | undefined;
}) =>
  sectionId === undefined ? null : (
    <span className="shrink-0 rounded-sm bg-surface px-1.5 py-0.5 text-2xs font-semibold tabular-nums tracking-caps text-muted">
      {sectionId}
    </span>
  );

const sectionIdFromDiff = (
  diff: SnapshotDiff | undefined,
): string | undefined => {
  if (diff === undefined) return undefined;
  for (const place of diff.places) {
    const fromSection = sectionIdFromLabel(place.section);
    if (fromSection !== undefined) return fromSection;
    for (const index of place.locationIndexes) {
      const location = diff.locations.at(index);
      const blockId = location?.newBlockId ?? location?.oldBlockId;
      if (blockId === undefined) continue;
      const kicker = foundElement(liveBlock(blockId))
        ?.closest<HTMLElement>("[data-slide]")
        ?.querySelector<HTMLElement>("[data-slide-kicker]")
        ?.textContent?.trim();
      const id = kicker?.match(/^(\d+(?:\.\d+)*)/u)?.[1];
      if (id !== undefined) return id;
    }
  }
  return undefined;
};

const DecisionRow = ({
  decision,
  action,
  rowRef,
  onJump,
}: {
  readonly decision: OpenDecision;
  readonly action: string;
  readonly rowRef?: (element: HTMLButtonElement | null) => void;
  readonly onJump: (decisionId: string) => void;
}) => (
  <li>
    <button
      ref={rowRef}
      type="button"
      className={`${APPROVE_ITEM_ROW_CLASS} items-start`}
      onClick={() => onJump(decision.inputId)}
      data-review-approve-decision={decision.inputId}
      {...(decision.isCritical ? { "data-review-approve-critical": "" } : {})}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink">{decision.label}</span>
        <span className="mt-0.5 block text-xs text-muted">
          {decision.detail}
        </span>
      </span>
      {decision.isCritical ? (
        <Badge size="status" tone="statusWarningOutline">
          Critical
        </Badge>
      ) : null}
      <span data-review-chrome-link="" className={APPROVE_ITEM_ACTION_CLASS}>
        {action}
      </span>
    </button>
  </li>
);

const ChangeSetRow = ({
  changeSet,
  sectionId,
  onJump,
}: {
  readonly changeSet: OpenChangeSet;
  readonly sectionId: string | undefined;
  readonly onJump: (changeSet: OpenChangeSet) => void;
}) => {
  const title = titleAfterSectionId(changeSet.label, sectionId);
  return (
    <li>
      <button
        type="button"
        className={`${APPROVE_ITEM_ROW_CLASS} items-center`}
        onClick={() => onJump(changeSet)}
        data-review-approve-changeset={changeSet.id}
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <SectionKicker sectionId={sectionId} />
          <span className="min-w-0 text-sm text-ink">{title}</span>
        </span>
        <span data-review-chrome-link="" className={APPROVE_ITEM_ACTION_CLASS}>
          Jump to change
        </span>
      </button>
    </li>
  );
};

const RequestRow = ({
  request,
  onJump,
}: {
  readonly request: OpenRequest;
  readonly onJump: (requestId: string) => void;
}) => {
  const title = titleAfterSectionId(request.label, request.sectionId);
  return (
    <li>
      <button
        type="button"
        className={`${APPROVE_ITEM_ROW_CLASS} items-center`}
        onClick={() => onJump(request.requestId)}
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <SectionKicker sectionId={request.sectionId} />
          <span className="min-w-0 text-sm text-ink">{title}</span>
        </span>
        <span data-review-chrome-link="" className={APPROVE_ITEM_ACTION_CLASS}>
          View the work
        </span>
      </button>
    </li>
  );
};

const useApprovalMessage = (open: boolean): string => {
  const [message, setMessage] = useState(readStoredMessage);
  const unsaved = useRef<string | undefined>(undefined);
  useEffect(() => {
    const changed = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (
        typeof detail !== "object" ||
        detail === null ||
        !("message" in detail) ||
        typeof detail.message !== "string" ||
        !("persisted" in detail) ||
        typeof detail.persisted !== "boolean"
      ) {
        return;
      }
      unsaved.current = detail.persisted ? undefined : detail.message;
      setMessage(detail.message);
    };
    document.addEventListener("bigplan:approval-message-changed", changed);
    return () =>
      document.removeEventListener("bigplan:approval-message-changed", changed);
  }, []);
  useEffect(() => {
    if (!open) return;
    if (unsaved.current !== undefined) setMessage(unsaved.current);
    else setMessage(readStoredMessage());
    const refresh = () => {
      if (unsaved.current === undefined) setMessage(readStoredMessage());
    };
    document.addEventListener("bigplan:settings-closed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      document.removeEventListener("bigplan:settings-closed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [open]);
  return message;
};

const useInputContract = (
  identity: RuntimeIdentity | null,
): ReviewInputContract => {
  const [contract, setContract] = useState(emptyReviewInputContract);
  useEffect(() => {
    if (identity === null) return;
    let cancelled = false;
    const read = () => {
      void requestJson({ path: "/api/input-contract", identity })
        .then((value) => {
          if (!cancelled) {
            const next = decodeReviewInputContract(value);
            if (next !== undefined) setContract(next);
          }
        })
        .catch(() => undefined);
    };
    // The Inputs panel and this dialog must describe the same record. A
    // one-shot fetch would keep showing unanswered after the cards already
    // recorded an answer.
    read();
    const stopWatching = onAppliedReviewRecord(read);
    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [identity]);
  return contract;
};

const useChangeSetDiffs = ({
  identity,
  changeSets,
}: {
  readonly identity: RuntimeIdentity | null;
  readonly changeSets: ReadonlyArray<OpenChangeSet>;
}): ReadonlyMap<string, SnapshotDiff> => {
  const [diffs, setDiffs] = useState<ReadonlyMap<string, SnapshotDiff>>(
    () => new Map(),
  );
  useEffect(() => {
    if (identity === null) return;
    let cancelled = false;
    const missing = changeSets.filter(
      (changeSet) => !diffs.has(`${changeSet.from}:${changeSet.to}`),
    );
    if (missing.length === 0) return;
    void Promise.all(
      missing.map(async (changeSet) => {
        const value = await requestJson({
          path: `/api/snapshot-diff?from=${encodeURIComponent(changeSet.from)}&to=${encodeURIComponent(changeSet.to)}`,
          identity,
        });
        return {
          key: `${changeSet.from}:${changeSet.to}`,
          diff: decodeSnapshotDiff(value),
        };
      }),
    )
      .then((loaded) => {
        if (cancelled) return;
        setDiffs((current) => {
          const next = new Map(current);
          for (const entry of loaded) {
            if (entry.diff !== null) next.set(entry.key, entry.diff);
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [changeSets, diffs, identity]);
  return diffs;
};

export const ApproveDialog = ({
  open,
  approval,
  items,
  diffs,
  message,
  onKeepReviewing,
  onApprove,
  onJumpToChange,
  onJumpToDecision,
  onJumpToRequest,
  submitting,
  blockReason,
  anchorRef,
}: {
  readonly open: boolean;
  readonly approval: ApprovalSummary | undefined;
  readonly items: DerivedOpenItems;
  readonly diffs: ReadonlyMap<string, SnapshotDiff>;
  readonly message: string;
  readonly onKeepReviewing: () => void;
  readonly onApprove: () => void;
  readonly onJumpToChange: (changeSet: OpenChangeSet) => void;
  readonly onJumpToDecision: (decisionId: string) => void;
  readonly onJumpToRequest: (requestId: string) => void;
  readonly submitting: boolean;
  readonly blockReason: string | undefined;
  readonly anchorRef: RefObject<HTMLElement | null>;
}) => {
  const firstBlocking = useRef<HTMLButtonElement | null>(null);
  const stale = approval?.status === "stale";
  const changeComplete = items.changeSets.open.length === 0;
  const decisionComplete = items.decisions.unanswered.length === 0;
  const changeSetCaveat = approveChangeSetCaveat(items);
  const decisionCaveat = approveDecisionCaveat(items);
  const unansweredAdvisory = items.decisions.unansweredNonCritical;

  const handleApprove = () => {
    if (items.decisions.blockingCritical.length > 0) {
      firstBlocking.current?.focus();
      return;
    }
    onApprove();
  };

  return (
    <AlertDialog
      open={open}
      title={stale ? "Re-approve this plan?" : "Approve this plan?"}
      description={
        stale
          ? "The plan has changed since you approved it. Approving again records the plan and message for the agent handoff."
          : "Approving records the plan and your message for the agent handoff."
      }
      cancelLabel="Keep reviewing"
      actionLabel={stale ? "Re-approve" : "Approve plan"}
      tone="neutral"
      actionVariant="default"
      width="wide"
      footerAlign="end"
      anchorRef={anchorRef}
      onCancel={onKeepReviewing}
      onAction={handleApprove}
    >
      <div
        className="grid grid-cols-[minmax(0,1fr)] gap-3"
        data-review-approve-dialog=""
      >
        {stale ? (
          <p className="m-0 text-xs text-muted">
            Re-approval covers the plan as it reads now.
          </p>
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <p className="m-0 text-xs font-semibold tracking-caps text-muted uppercase">
            Review status
          </p>
          <Disclosure
            id="approve-changesets"
            title="Change sets"
            count={`${items.changeSets.accepted} of ${items.changeSets.total} accepted`}
            complete={changeComplete}
            defaultOpen={!changeComplete}
          >
            {changeComplete ? (
              <p className="m-0 px-3 py-1 text-xs text-muted">
                Every change set is accepted.
              </p>
            ) : (
              <BoundedList
                items={items.changeSets.open.map((changeSet) => (
                  <ChangeSetRow
                    key={changeSet.id}
                    changeSet={changeSet}
                    sectionId={
                      changeSet.sectionId ??
                      sectionIdFromDiff(
                        diffs.get(`${changeSet.from}:${changeSet.to}`),
                      )
                    }
                    onJump={onJumpToChange}
                  />
                ))}
              />
            )}
            {changeSetCaveat === undefined ? null : (
              <p
                className="m-0 mt-2 px-3 text-xs text-muted"
                data-review-approve-changeset-caveat=""
              >
                {changeSetCaveat}
              </p>
            )}
          </Disclosure>
          <Disclosure
            id="approve-decisions"
            title="Decisions"
            count={`${items.decisions.answered} of ${items.decisions.total} answered`}
            complete={decisionComplete}
            defaultOpen={
              !decisionComplete || items.decisions.recorded.length > 0
            }
          >
            {decisionComplete ? (
              items.decisions.recorded.length === 0 ? (
                <p className="m-0 px-3 py-1 text-xs text-muted">
                  This plan does not ask any decisions.
                </p>
              ) : (
                <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 px-3">
                  {items.decisions.recorded.map((decision) => (
                    <li
                      key={decision.inputId}
                      className="rounded-md border border-edge bg-raised px-3 py-2 text-sm text-ink"
                    >
                      <span className="block">{decision.label}</span>
                      <span className="text-xs text-muted">
                        {decision.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <>
                <BoundedList
                  items={[
                    ...items.decisions.blockingCritical.map(
                      (decision, index) => (
                        <DecisionRow
                          key={decision.inputId}
                          decision={decision}
                          action="Answer"
                          onJump={onJumpToDecision}
                          rowRef={
                            index === 0
                              ? (element) => {
                                  firstBlocking.current = element;
                                }
                              : undefined
                          }
                        />
                      ),
                    ),
                    ...unansweredAdvisory.map((decision) => (
                      <DecisionRow
                        key={decision.inputId}
                        decision={decision}
                        action="Answer"
                        onJump={onJumpToDecision}
                      />
                    )),
                  ]}
                />
                {decisionCaveat === undefined ? null : (
                  <p
                    className="m-0 mt-2 px-3 text-xs text-muted"
                    data-review-approve-decision-caveat=""
                  >
                    {decisionCaveat}
                  </p>
                )}
              </>
            )}
          </Disclosure>
          {items.requests.open.length === 0 ? null : (
            <Disclosure
              id="approve-requests"
              title="In-flight work"
              count={`${items.requests.open.length}`}
              complete={false}
              defaultOpen
            >
              <BoundedList
                items={items.requests.open.map((request) => (
                  <RequestRow
                    key={request.requestId}
                    request={request}
                    onJump={onJumpToRequest}
                  />
                ))}
              />
              <p className="m-0 mt-2 px-3 text-xs text-muted">
                {APPROVE_IN_FLIGHT_CAVEAT}
              </p>
            </Disclosure>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="m-0 text-xs font-semibold tracking-caps text-muted uppercase">
              Message to your agent
            </p>
            <button
              type="button"
              className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1 text-xs font-medium text-accent hover:bg-surface focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent wide:min-h-0"
              onClick={() => openSettingsAndClose(onKeepReviewing)}
              data-review-approve-edit-message=""
              data-review-chrome-link=""
            >
              <span className="inline-flex size-3" aria-hidden="true">
                <Icon icon={PENCIL_ICON} />
              </span>
              Edit in Settings
            </button>
          </div>
          <blockquote
            className="m-0 border-l-2 border-accent pl-3 text-sm leading-normal text-ink not-italic"
            data-review-approve-message=""
          >
            {message}
          </blockquote>
        </div>
        {blockReason === undefined ? null : (
          <p
            className="m-0 text-xs text-[var(--callout-warning-c)]"
            role="alert"
            data-review-approve-block=""
          >
            {blockReason}
          </p>
        )}
        {submitting ? (
          <p className="m-0 text-xs text-muted">Approving…</p>
        ) : null}
      </div>
    </AlertDialog>
  );
};

const DETAILS_HEADING = "Approval details";

const DETAILS_FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const ApprovalDetails = ({
  id,
  open,
  approval,
  canRevoke,
  unansweredDecisionIds,
  onClose,
  onRevoke,
  anchorRef,
}: {
  readonly id: string;
  readonly open: boolean;
  readonly approval: ApprovalSummary;
  readonly canRevoke: boolean;
  readonly unansweredDecisionIds: ReadonlyArray<string>;
  readonly onClose: () => void;
  readonly onRevoke: () => void;
  readonly anchorRef: RefObject<HTMLElement | null>;
}) => {
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const leftoverCopy = unansweredNonCriticalCopy(unansweredDecisionIds.length);
  const approvedLabel = approvedOnLabel(approval.at);
  const exactLabel = approvedAtExactLabel(approval.at);
  const [anchorPosition, setAnchorPosition] =
    useState<AnchoredDialogPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected === true) previousFocus.focus();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setAnchorPosition(null);
      return;
    }
    const update = () => {
      const anchor = anchorRef.current;
      if (anchor === null) {
        setAnchorPosition(null);
        return;
      }
      setAnchorPosition(
        placeAnchoredDialog({
          anchor: anchor.getBoundingClientRect(),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          preferredWidth: 20 * 16,
        }),
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirming) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming, onClose, open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || confirming) return;
    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(DETAILS_FOCUSABLE) ?? [],
    ).filter((element) => !element.hasAttribute("disabled"));
    if (controls.length === 0) return;
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next =
      current === -1
        ? event.shiftKey
          ? controls.length - 1
          : 0
        : event.shiftKey
          ? (current - 1 + controls.length) % controls.length
          : (current + 1) % controls.length;
    event.preventDefault();
    controls[next]?.focus();
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50"
        onClick={onClose}
        data-review-approval-details-backdrop=""
      />
      <div
        ref={dialogRef}
        id={id}
        className="fixed z-50 rounded-lg border border-edge bg-raised p-3 text-ink shadow-floating"
        style={
          anchorPosition === null
            ? { top: 48, right: 12, width: 20 * 16 }
            : {
                top: anchorPosition.top,
                right: anchorPosition.right,
                width: anchorPosition.maxWidth,
                maxHeight: anchorPosition.maxHeight,
                maxWidth: anchorPosition.maxWidth,
              }
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        data-review-approval-details=""
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} className="m-0 text-sm font-semibold text-ink">
            {DETAILS_HEADING}
          </h2>
          <button
            type="button"
            className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent wide:size-6"
            aria-label={`Close ${DETAILS_HEADING}`}
            onClick={onClose}
            data-review-approval-details-close=""
          >
            <span className="inline-flex size-4" aria-hidden="true">
              <Icon icon={X_ICON} />
            </span>
          </button>
        </div>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
          <div className="flex items-start gap-2">
            <QuietCheck />
            <p
              className="m-0 text-sm text-ink"
              {...(exactLabel === undefined ? {} : { title: exactLabel })}
            >
              {approvedLabel}
            </p>
          </div>
          {approval.status === "stale" ? (
            <p className="m-0 text-xs text-[var(--callout-warning-c)]">
              The plan changed after this approval. Re-approve to stamp the plan
              as it reads now.
            </p>
          ) : null}
          <div className="flex items-start gap-2 border-t border-edge pt-3">
            <QuietCheck />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-ink">
                Saved for your agent
              </p>
              <p className="mt-1 mb-0 text-xs leading-normal text-muted">
                This message is recorded for the agent handoff.
              </p>
              <blockquote className="mx-0 mt-2 mb-0 rounded-md border-l-2 border-edge bg-paper px-3 py-2 text-sm leading-normal text-ink not-italic">
                {approval.message}
              </blockquote>
              <button
                type="button"
                className="mt-1.5 inline-flex min-h-11 cursor-pointer items-center rounded-sm border-0 bg-transparent p-0 text-xs font-normal text-muted underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent wide:min-h-0"
                onClick={() => openSettingsAndClose(onClose)}
                data-review-approve-edit-message=""
              >
                Edit this message
              </button>
            </div>
          </div>
          {leftoverCopy === undefined ? null : (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1">
              <span
                className="mt-0.5 inline-flex size-3.5 shrink-0 text-[var(--callout-warning-c)]"
                aria-hidden="true"
              >
                <Icon icon={TRIANGLE_ALERT_ICON} />
              </span>
              <p className="m-0 text-sm text-[var(--callout-warning-c)]">
                {leftoverCopy}
              </p>
              <button
                type="button"
                className="col-start-2 min-h-11 cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left text-sm font-normal text-accent underline underline-offset-2 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent wide:min-h-0"
                data-review-chrome-link=""
                onClick={() => {
                  onClose();
                  requestOpenInputs();
                }}
                data-review-approve-jump-decisions=""
              >
                Review decisions →
              </button>
            </div>
          )}
          {canRevoke ? (
            <div className="border-t border-edge pt-3">
              <Button
                className="w-full"
                variant="destructive"
                size="compact"
                onClick={() => setConfirming(true)}
                data-review-approve-revoke=""
              >
                Revoke approval
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <AlertDialog
        open={confirming}
        title="Revoke this approval?"
        description="The plan returns to review. Nothing already recorded in the source is undone."
        cancelLabel="Keep approved"
        actionLabel="Revoke"
        onCancel={() => setConfirming(false)}
        onAction={() => {
          setConfirming(false);
          onRevoke();
        }}
      />
    </>,
    document.body,
  );
};

export const ApproveControl = ({
  identity,
  approval,
  agent,
  currentSnapshot,
  canWrite,
  onOpenAgent,
  onApprovalChange,
}: {
  readonly identity: RuntimeIdentity;
  readonly approval: ApprovalSummary | undefined;
  readonly agent: AgentSnapshot;
  readonly currentSnapshot: string;
  readonly canWrite: boolean;
  readonly onOpenAgent: () => void;
  readonly onApprovalChange: (next: ApprovalSummary | undefined) => void;
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [blockReason, setBlockReason] = useState<string | undefined>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  const isApproved = approval?.status === "approved";
  const contract = useInputContract(identity);
  const verdicts = useChangeVerdicts();
  const { openTour } = useDiffTour();
  const message = useApprovalMessage(dialogOpen);
  const skeletonSets = useMemo(
    () =>
      changeSetsFromExchange({
        requests: agent.requests,
        responses: agent.responses,
        placeIdsByRevision: new Map(),
      }),
    [agent.requests, agent.responses],
  );
  const diffs = useChangeSetDiffs({ identity, changeSets: skeletonSets });
  const changeSets = useMemo(
    () =>
      changeSetsFromExchange({
        requests: agent.requests,
        responses: agent.responses,
        placeIdsByRevision: new Map(
          [...diffs.entries()].map(([key, diff]) => [
            key,
            diff.places.map((place) => place.placeId),
          ]),
        ),
      }),
    [agent.requests, agent.responses, diffs],
  );
  const items = useMemo(
    () =>
      deriveOpenItems({
        changeSets,
        accepted: verdicts.accepted,
        inputs: contract.inputs,
        requests: openRequestsFromExchange(agent.requests),
      }),
    [agent.requests, changeSets, contract.inputs, verdicts.accepted],
  );
  const status = approval?.status;

  useEffect(() => {
    if (!isApproved) setDetailsOpen(false);
  }, [isApproved]);

  useEffect(() => {
    document.documentElement.toggleAttribute(
      "data-review-approved",
      isApproved,
    );
    document.dispatchEvent(new CustomEvent("bigplan:approval-changed"));
    return () => {
      document.documentElement.removeAttribute("data-review-approved");
      document.dispatchEvent(new CustomEvent("bigplan:approval-changed"));
    };
  }, [isApproved]);

  useEffect(() => {
    const openDetails = () => {
      if (isApproved) setDetailsOpen(true);
    };
    const onReplaced = () => setDetailsOpen(false);
    document.addEventListener("bigplan:open-approval-details", openDetails);
    document.addEventListener("bigplan:article-replaced", onReplaced);
    return () => {
      document.removeEventListener(
        "bigplan:open-approval-details",
        openDetails,
      );
      document.removeEventListener("bigplan:article-replaced", onReplaced);
    };
  }, [isApproved]);

  const closeDialog = () => {
    setDialogOpen(false);
    setBlockReason(undefined);
  };

  const jumpToChange = (changeSet: OpenChangeSet) => {
    const diff = diffs.get(`${changeSet.from}:${changeSet.to}`);
    if (diff !== undefined) {
      openTour({ diff, placeIds: changeSet.placeIds });
    }
    closeDialog();
  };

  const jumpToDecision = (decisionId: string) => {
    closeDialog();
    showDecision(decisionId);
  };

  const approve = async () => {
    if (items.decisions.blockingCritical.length > 0) {
      setBlockReason(
        "This plan cannot be approved until every critical decision is answered.",
      );
      return;
    }
    setSubmitting(true);
    setBlockReason(undefined);
    try {
      const value = await requestJson({
        path: "/api/approve",
        identity,
        method: "POST",
        body: { expectedSnapshot: currentSnapshot, message },
      });
      const next =
        typeof value === "object" && value !== null && "approval" in value
          ? decodeApprovalSummary(
              (value as { readonly approval: unknown }).approval,
            )
          : undefined;
      onApprovalChange(next);
      closeDialog();
    } catch (error: unknown) {
      setBlockReason(
        error instanceof Error
          ? error.message
          : "The plan could not be approved.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async () => {
    if (approval === undefined) return;
    try {
      await requestJson({
        path: "/api/revoke-approval",
        identity,
        method: "POST",
        body: { approvalId: approval.approvalId },
      });
      onApprovalChange(undefined);
    } catch {
      setBlockReason("The approval could not be revoked.");
    }
  };

  const unansweredDecisionIds = items.decisions.unansweredNonCritical.map(
    (decision) => decision.inputId,
  );

  if (approval !== undefined && isApproved) {
    return (
      <span data-review-approval-status={approval.status}>
        <button
          ref={triggerRef}
          type="button"
          className={APPROVE_APPROVED_CLASS}
          aria-label="Plan approved"
          aria-haspopup="dialog"
          aria-expanded={detailsOpen}
          aria-controls={detailsOpen ? detailsId : undefined}
          onClick={() => setDetailsOpen((current) => !current)}
          data-review-approve-status="approved"
        >
          <Icon icon={CHECK_ICON} />
          Plan approved
          <Icon icon={CHEVRON_DOWN_ICON} />
        </button>
        <ApprovedStampOverlay />
        <ApprovalDetails
          id={detailsId}
          open={detailsOpen}
          approval={approval}
          canRevoke={canWrite}
          unansweredDecisionIds={unansweredDecisionIds}
          onClose={() => setDetailsOpen(false)}
          onRevoke={() => {
            setDetailsOpen(false);
            void revoke();
          }}
          anchorRef={triggerRef}
        />
      </span>
    );
  }

  return (
    <>
      {status === "stale" ? (
        <Badge size="status" tone="statusWarning" data-review-approve-stale="">
          Changed since approval
        </Badge>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className={APPROVE_TRIGGER_CLASS}
        aria-label={status === "stale" ? "Re-approve" : "Approve plan"}
        aria-haspopup="dialog"
        aria-expanded={dialogOpen}
        onClick={() => setDialogOpen(true)}
        data-review-approve-trigger=""
        data-review-approve-emphasis="secondary"
      >
        <Icon icon={CHECK_ICON} />
        {status === "stale" ? "Re-approve" : "Approve plan"}
        <Icon icon={CHEVRON_DOWN_ICON} />
      </button>
      <ApproveDialog
        open={dialogOpen}
        approval={approval}
        items={items}
        diffs={diffs}
        message={message}
        onKeepReviewing={closeDialog}
        onApprove={() => void approve()}
        onJumpToChange={jumpToChange}
        onJumpToDecision={jumpToDecision}
        onJumpToRequest={(requestId) => {
          closeDialog();
          onOpenAgent();
          void requestId;
        }}
        submitting={submitting}
        blockReason={
          items.decisions.blockingCritical.length > 0
            ? "This plan cannot be approved until every critical decision is answered."
            : blockReason
        }
        anchorRef={triggerRef}
      />
    </>
  );
};
