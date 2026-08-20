// Owns the approve moment in the review island: the toolbar control, the
// confirmation dialog, the approved stamp, and the details surface that can
// revoke. The record itself is written by the runtime; this file only asks
// and paints what comes back.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { PENCIL_ICON } from "../../icons/lucide/pencil.js";
import { SETTINGS_ICON } from "../../icons/lucide/settings.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import {
  effectiveApprovalMessage,
  APPROVAL_MESSAGE_STORAGE_KEY,
} from "../shared/approval-message.js";
import type { ApprovalSummary } from "../shared/approval.js";
import {
  approveFootnote,
  approveIsPrimary,
  changeSetsFromExchange,
  deriveOpenItems,
  openRequestsFromExchange,
  type DerivedOpenItems,
  type OpenChangeSet,
  type OpenDecision,
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
import {
  displayedStandIn,
  liveDecisionFigure,
  liveFirstDecision,
} from "./live-target.browser.js";
import {
  requestJson,
  type RuntimeIdentity,
} from "./review-runtime-client.browser.js";
import { useChangeDispositions } from "./use-change-dispositions.browser.js";
import { useDiffTour } from "./diff-tour.browser.js";
import { AlertDialog, Badge, Button } from "./ui.browser.js";

const VIEW_ALL_LIMIT = 3;

const showLiveElement = (element: HTMLElement): void => {
  (displayedStandIn(element) ?? element).scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
};

const showDecision = (decisionId: string): void => {
  const decision = liveDecisionFigure(decisionId);
  if ("missing" in decision) return;
  showLiveElement(decision.found);
};

const jumpToPlanDecisions = (decisionIds: ReadonlyArray<string>): void => {
  for (const id of decisionIds) {
    const decision = liveDecisionFigure(id);
    if ("found" in decision) {
      showLiveElement(decision.found);
      return;
    }
  }
  const first = liveFirstDecision();
  if ("missing" in first) return;
  showLiveElement(first.found);
};

const openApprovalMessageSettings = (): void => {
  document.dispatchEvent(
    new CustomEvent("bigplan:open-settings", {
      detail: { category: "approval-message" },
    }),
  );
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

type ApprovalClockParts = {
  readonly month: string;
  readonly day: string;
  readonly time: string;
  readonly unavailable: boolean;
};

const approvalClockParts = (at: string): ApprovalClockParts => {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    return {
      month: "",
      day: "",
      time: "Time unavailable",
      unavailable: true,
    };
  }
  const date = new Date(parsed);
  return {
    month: date.toLocaleString(undefined, { month: "short" }),
    day: date.toLocaleString(undefined, { day: "numeric" }),
    time: date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
    unavailable: false,
  };
};

type StampSize = "toolbar" | "page";

const STAMP_FRAME: Readonly<Record<StampSize, string>> = {
  toolbar: "inline-flex rounded-md border-2 border-accent p-0.5",
  page: "inline-flex -rotate-2 rounded-md border-2 border-accent p-1 motion-reduce:rotate-0",
};

const STAMP_INNER: Readonly<Record<StampSize, string>> = {
  toolbar:
    "inline-flex items-center justify-center rounded-sm border border-accent bg-transparent px-1.5 py-0.5 group-hover:bg-accent-wash group-active:bg-accent-soft",
  page: "inline-flex items-center justify-center rounded-sm border border-accent bg-transparent px-3 py-1",
};

const STAMP_TYPE: Readonly<Record<StampSize, string>> = {
  toolbar:
    "text-2xs font-bold tracking-caps whitespace-nowrap text-accent uppercase",
  page: "text-sm font-bold tracking-caps whitespace-nowrap text-accent uppercase",
};

const STAMP_BUTTON_CLASS =
  "group inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 -rotate-2 transition hover:rotate-0 hover:shadow-lifted active:inset-shadow-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:rotate-0 motion-reduce:transition-none wide:min-h-0";

const ApproveStampMark = ({
  label,
  size,
}: {
  readonly label: string;
  readonly size: StampSize;
}) => (
  <span className={STAMP_FRAME[size]}>
    <span className={STAMP_INNER[size]}>
      <span className={STAMP_TYPE[size]}>{label}</span>
    </span>
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
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
        <div id={panelId} className="border-t border-edge px-3 py-2">
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
    <ul className="m-0 grid list-none gap-1 p-0">
      {shown}
      {extra > 0 ? (
        <li className="px-1 py-1 text-xs text-muted">{`View all ${items.length}`}</li>
      ) : null}
    </ul>
  );
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
      className="flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-md border-0 bg-transparent px-1 py-1.5 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
      <span className="shrink-0 text-xs font-medium text-accent">{action}</span>
    </button>
  </li>
);

const ChangeSetRow = ({
  changeSet,
  onJump,
}: {
  readonly changeSet: OpenChangeSet;
  readonly onJump: (changeSet: OpenChangeSet) => void;
}) => (
  <li>
    <button
      type="button"
      className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1 py-1.5 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onClick={() => onJump(changeSet)}
      data-review-approve-changeset={changeSet.id}
    >
      <span className="min-w-0 flex-1 text-sm text-ink">{changeSet.label}</span>
      <span className="shrink-0 text-xs font-medium text-accent">
        Jump to change
      </span>
    </button>
  </li>
);

const useApprovalMessage = (open: boolean): string => {
  const [message, setMessage] = useState(readStoredMessage);
  useEffect(() => {
    if (!open) return;
    setMessage(readStoredMessage());
    const refresh = () => setMessage(readStoredMessage());
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
    read();
    return () => {
      cancelled = true;
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
  message,
  onKeepReviewing,
  onApprove,
  onJumpToChange,
  onJumpToDecision,
  onJumpToRequest,
  submitting,
  blockReason,
}: {
  readonly open: boolean;
  readonly approval: ApprovalSummary | undefined;
  readonly items: DerivedOpenItems;
  readonly message: string;
  readonly onKeepReviewing: () => void;
  readonly onApprove: () => void;
  readonly onJumpToChange: (changeSet: OpenChangeSet) => void;
  readonly onJumpToDecision: (decisionId: string) => void;
  readonly onJumpToRequest: (requestId: string) => void;
  readonly submitting: boolean;
  readonly blockReason: string | undefined;
}) => {
  const firstBlocking = useRef<HTMLButtonElement | null>(null);
  const stale = approval?.status === "stale";
  const changeComplete = items.changeSets.open.length === 0;
  const decisionComplete = items.decisions.unanswered.length === 0;
  const footnote = approveFootnote(items);
  const unansweredAdvisory = items.decisions.unanswered.filter(
    (decision) => !decision.isCritical,
  );

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
          ? "The plan has changed since you approved it. Approving again sends your approval message to the agent so it can start the work."
          : "Approving sends your approval message to the agent so it can start the work."
      }
      cancelLabel="Keep reviewing"
      actionLabel={stale ? "Re-approve" : "Approve plan"}
      tone="neutral"
      actionVariant="default"
      width="wide"
      footerAlign="split"
      footnote={footnote}
      onCancel={onKeepReviewing}
      onAction={handleApprove}
    >
      <div className="grid gap-3" data-review-approve-dialog="">
        {stale ? (
          <p className="m-0 text-xs text-muted">
            Re-approval covers the plan as it reads now.
          </p>
        ) : null}
        <div className="grid gap-2">
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
              <p className="m-0 px-1 py-1 text-xs text-muted">
                Every change set is accepted.
              </p>
            ) : (
              <BoundedList
                items={items.changeSets.open.map((changeSet) => (
                  <ChangeSetRow
                    key={changeSet.id}
                    changeSet={changeSet}
                    onJump={onJumpToChange}
                  />
                ))}
              />
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
                <p className="m-0 px-1 py-1 text-xs text-muted">
                  This plan does not ask any decisions.
                </p>
              ) : (
                <ul className="m-0 grid list-none gap-1 p-0">
                  {items.decisions.recorded.map((decision) => (
                    <li
                      key={decision.inputId}
                      className="px-1 py-1 text-sm text-ink"
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
                {unansweredAdvisory.length > 0 ? (
                  <p className="m-0 mt-2 px-1 text-xs text-muted">
                    {`Approving now records these ${unansweredAdvisory.length} as unanswered.`}
                  </p>
                ) : null}
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
                  <li key={request.requestId}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1 py-1.5 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      onClick={() => onJumpToRequest(request.requestId)}
                    >
                      <span className="min-w-0 flex-1 text-sm text-ink">
                        {request.label}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-accent">
                        View the work
                      </span>
                    </button>
                  </li>
                ))}
              />
              <p className="m-0 mt-2 px-1 text-xs text-muted">
                {`Approving now cancels these ${items.requests.open.length}.`}
              </p>
            </Disclosure>
          )}
        </div>
        <div className="min-w-0 rounded-lg border border-edge bg-paper px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-xs font-semibold tracking-caps text-muted uppercase">
              Message to your agent
            </p>
            <button
              type="button"
              className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-2 text-xs font-medium text-accent hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={openApprovalMessageSettings}
              data-review-approve-edit-message=""
            >
              <span className="inline-flex size-3" aria-hidden="true">
                <Icon icon={PENCIL_ICON} />
              </span>
              Edit in Settings
            </button>
          </div>
          <p className="mt-2 mb-0 text-xs text-muted">
            The agent receives this message when you approve.
          </p>
          <p
            className="mt-2 mb-0 text-sm leading-normal text-ink"
            data-review-approve-message=""
          >
            {message}
          </p>
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

const ApprovalClock = ({ at }: { readonly at: string }) => {
  const parts = approvalClockParts(at);
  if (parts.unavailable) {
    return <p className="m-0 text-sm text-muted">{parts.time}</p>;
  }
  return (
    <div className="flex items-end gap-3">
      <div className="rounded-md border-2 border-accent px-2 py-1 text-center">
        <p className="m-0 text-2xs font-bold tracking-caps text-accent uppercase">
          {parts.month}
        </p>
        <p className="m-0 text-2xl font-bold tracking-tight text-accent">
          {parts.day}
        </p>
      </div>
      <div className="min-w-0">
        <p className="m-0 text-2xs font-semibold tracking-caps text-muted uppercase">
          Stamped at
        </p>
        <p className="mt-1 mb-0 text-lg font-semibold text-ink">{parts.time}</p>
      </div>
    </div>
  );
};

const ApprovalDetails = ({
  open,
  approval,
  canRevoke,
  unansweredDecisionIds,
  onClose,
  onRevoke,
}: {
  readonly open: boolean;
  readonly approval: ApprovalSummary;
  readonly canRevoke: boolean;
  readonly unansweredDecisionIds: ReadonlyArray<string>;
  readonly onClose: () => void;
  readonly onRevoke: () => void;
}) => {
  const [confirming, setConfirming] = useState(false);
  if (!open) return null;
  const answered = approval.openItemCounts.decisionsAnswered;
  const total = approval.openItemCounts.decisionsTotal;
  const unanswered = total - answered;
  const decisionCopy =
    total === 0
      ? undefined
      : unanswered === 0
        ? `All ${total} decisions were answered. Review them in the plan.`
        : unanswered === total
          ? `None of the ${total} decisions were answered. Jump to them in the plan.`
          : `${answered} of ${total} decisions were answered. Jump to the unanswered ones.`;
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        data-review-approval-details-backdrop=""
      />
      <div
        className="fixed top-24 right-3 left-3 z-50 rounded-lg border border-edge bg-raised p-3 text-ink shadow-floating wide:absolute wide:top-full wide:right-0 wide:left-auto wide:mt-1 wide:w-80"
        role="dialog"
        aria-label="Approval details"
        data-review-approval-details=""
      >
        <ApproveStampMark label="Approved" size="toolbar" />
        <div className="mt-3">
          <ApprovalClock at={approval.at} />
        </div>
        {approval.status === "stale" ? (
          <p className="mt-3 mb-0 text-xs text-[var(--callout-warning-c)]">
            The plan changed after this approval. Re-approve to stamp the plan
            as it reads now.
          </p>
        ) : null}
        <div className="mt-3 min-w-0 rounded-md border border-edge bg-paper px-2 py-2">
          <p className="m-0 text-2xs font-semibold tracking-caps text-muted uppercase">
            Sent to your agent
          </p>
          <p className="mt-1 mb-0 text-xs leading-normal text-muted">
            This message was sent to your agent so it can start the work.
          </p>
          <p className="mt-2 mb-0 text-sm leading-normal text-ink">
            {approval.message}
          </p>
          <button
            type="button"
            className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-0 text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={openApprovalMessageSettings}
            data-review-approve-settings-message=""
          >
            <span className="inline-flex size-3" aria-hidden="true">
              <Icon icon={SETTINGS_ICON} />
            </span>
            Change it in Settings
          </button>
        </div>
        {decisionCopy === undefined ? null : (
          <button
            type="button"
            className="mt-3 flex min-h-11 w-full cursor-pointer items-start rounded-md border-0 bg-transparent px-0 py-1 text-left text-xs font-medium leading-normal text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => {
              onClose();
              jumpToPlanDecisions(unansweredDecisionIds);
            }}
            data-review-approve-jump-decisions=""
          >
            {decisionCopy}
          </button>
        )}
        {canRevoke ? (
          <Button
            className="mt-3 w-full"
            variant="destructive"
            size="compact"
            onClick={() => setConfirming(true)}
            data-review-approve-revoke=""
          >
            Revoke approval
          </Button>
        ) : null}
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
    </>
  );
};

export const ApprovalStamp = ({
  approval,
  canRevoke,
  onRevoke,
}: {
  readonly approval: ApprovalSummary;
  readonly canRevoke: boolean;
  readonly onRevoke: () => void;
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stale = approval.status === "stale";
  return (
    <div
      className="relative mb-3 min-w-0"
      data-review-approval-stamp=""
      data-review-approval-status={approval.status}
    >
      <div className="rounded-md border border-edge bg-surface px-3 py-2">
        <ApproveStampMark label="Approved" size="page" />
        <div className="mt-3">
          <ApprovalClock at={approval.at} />
        </div>
        {stale ? (
          <p className="mt-2 mb-0 text-xs text-[var(--callout-warning-c)]">
            The plan changed after this approval. Re-approve to stamp the plan
            as it reads now.
          </p>
        ) : null}
        <button
          type="button"
          className="mt-2 inline-flex min-h-11 cursor-pointer items-center rounded-md border-0 bg-transparent px-0 text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => setDetailsOpen((current) => !current)}
        >
          Approval details
        </button>
      </div>
      <ApprovalDetails
        open={detailsOpen}
        approval={approval}
        canRevoke={canRevoke}
        unansweredDecisionIds={[]}
        onClose={() => setDetailsOpen(false)}
        onRevoke={() => {
          setDetailsOpen(false);
          onRevoke();
        }}
      />
    </div>
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
  const contract = useInputContract(identity);
  const dispositions = useChangeDispositions();
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
        accepted: dispositions.accepted,
        inputs: contract.inputs,
        requests: openRequestsFromExchange(agent.requests),
      }),
    [agent.requests, changeSets, contract.inputs, dispositions.accepted],
  );
  const primary = approveIsPrimary(items);
  const status = approval?.status;

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

  const unansweredDecisionIds = items.decisions.unanswered.map(
    (decision) => decision.inputId,
  );

  if (approval !== undefined && status === "approved") {
    return (
      <span className="relative">
        <button
          type="button"
          className={STAMP_BUTTON_CLASS}
          aria-label="Approval details"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((current) => !current)}
          data-review-approve-status="approved"
        >
          <ApproveStampMark label="Approved" size="toolbar" />
        </button>
        <ApprovalDetails
          open={detailsOpen}
          approval={approval}
          canRevoke={canWrite}
          unansweredDecisionIds={unansweredDecisionIds}
          onClose={() => setDetailsOpen(false)}
          onRevoke={() => {
            setDetailsOpen(false);
            void revoke();
          }}
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
        type="button"
        className={STAMP_BUTTON_CLASS}
        aria-label={status === "stale" ? "Re-approve" : "Approve plan"}
        onClick={() => setDialogOpen(true)}
        data-review-approve-trigger=""
        data-review-approve-emphasis={primary ? "primary" : "secondary"}
      >
        <ApproveStampMark
          label={status === "stale" ? "Re-approve" : "Approve"}
          size="toolbar"
        />
      </button>
      <ApproveDialog
        open={dialogOpen}
        approval={approval}
        items={items}
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
      />
    </>
  );
};

export const ApprovalStampPortal = ({
  identity,
  approval,
  canRevoke,
  onApprovalChange,
}: {
  readonly identity: RuntimeIdentity;
  readonly approval: ApprovalSummary | undefined;
  readonly canRevoke: boolean;
  readonly onApprovalChange: (next: ApprovalSummary | undefined) => void;
}) => {
  const [slots, setSlots] = useState<ReadonlyArray<HTMLElement>>([]);
  useEffect(() => {
    const found = Array.from(
      document.querySelectorAll<HTMLElement>("[data-review-approval-slot]"),
    );
    setSlots(found);
  }, [approval]);
  useEffect(() => {
    for (const slot of slots) {
      slot.hidden = approval === undefined;
    }
    return () => {
      for (const slot of slots) slot.hidden = true;
    };
  }, [approval, slots]);
  if (approval === undefined) return null;
  const revoke = () => {
    void requestJson({
      path: "/api/revoke-approval",
      identity,
      method: "POST",
      body: { approvalId: approval.approvalId },
    })
      .then(() => onApprovalChange(undefined))
      .catch(() => undefined);
  };
  return (
    <>
      {slots.map((slot, index) =>
        createPortal(
          <ApprovalStamp
            approval={approval}
            canRevoke={canRevoke}
            onRevoke={revoke}
          />,
          slot,
          `approval-stamp-${index}`,
        ),
      )}
    </>
  );
};
