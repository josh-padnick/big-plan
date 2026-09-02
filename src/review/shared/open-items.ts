// Owns the one derivation of what is still open at the approve moment:
// unaccepted change sets, unanswered decisions, and in-flight agent work.
//
// Counts and rows in, no fetching. Change-set standing and input standing
// already have owners; this module only joins them into the shape the dialog
// and the toolbar both read, so those two surfaces cannot disagree.

import { changeSetStanding, type ChangeSetStanding } from "./change-verdict.js";
import {
  reviewInputStanding,
  type ReviewInput,
  type ReviewInputState,
} from "./input-contract.js";
import { requestIsTerminal } from "./agent-request-state.js";

/** One change set the approve dialog can name and jump to. */
export type OpenChangeSet = {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly placeIds: ReadonlyArray<string>;
  readonly sectionId?: string;
};

/** One decision the approve dialog can name and jump to. */
export type OpenDecision = {
  readonly inputId: string;
  readonly label: string;
  readonly isCritical: boolean;
  readonly state: ReviewInputState;
  readonly detail: string;
};

/** One unanswered agent request approval will cancel. */
export type OpenRequest = {
  readonly requestId: string;
  readonly label: string;
  readonly sectionId?: string;
};

export type DerivedOpenItems = {
  readonly changeSets: {
    readonly total: number;
    readonly accepted: number;
    /** Sets whose places all carry a verdict, whichever way each one went. */
    readonly settled: number;
    readonly open: ReadonlyArray<OpenChangeSet>;
    readonly standing: ReadonlyArray<ChangeSetStanding>;
  };
  readonly decisions: {
    readonly total: number;
    readonly answered: number;
    readonly unanswered: ReadonlyArray<OpenDecision>;
    readonly blockingCritical: ReadonlyArray<OpenDecision>;
    readonly unansweredNonCritical: ReadonlyArray<OpenDecision>;
    readonly recorded: ReadonlyArray<OpenDecision>;
  };
  readonly requests: {
    readonly open: ReadonlyArray<OpenRequest>;
  };
};

const APPROVE_CHANGE_SET_CAVEAT = "Approval will auto-accept all change sets.";
const APPROVE_DECISION_CAVEAT =
  "Approval will report unanswered decisions as not answered.";

/** One change set as the committed revision log folds it. */
export type CommittedChangeSetFold = {
  readonly changeSetId: string;
  readonly baseSnapshot: string;
  readonly resultSnapshot: string;
};

/** The request shape a change set reads its human label from. */
type ChangeSetLabelSource = {
  readonly requestId: string;
  readonly targetLabel?: string;
  /** The browser's projection of a feedback request's comments. */
  readonly commentIds?: ReadonlyArray<string>;
  /** The comments a feedback request carries, as the store holds them. */
  readonly comments?: ReadonlyArray<{ readonly id: string }>;
  readonly commentId?: string;
  readonly threadId?: string;
};

/**
 * The ids one request can have contributed a revision under: its own, and
 * every comment or thread it targets. A feedback request names its comments
 * one way in the store and another over the wire, and both callers pass their
 * own shape straight through, so both are read here.
 */
const changeSetIdsOwnedBy = (
  request: ChangeSetLabelSource,
): ReadonlyArray<string> => [
  ...(request.commentIds ?? []),
  ...(request.comments ?? []).map((comment) => comment.id),
  ...(request.commentId === undefined ? [] : [request.commentId]),
  ...(request.threadId === undefined ? [] : [request.threadId]),
  request.requestId,
];

/**
 * The label each change set is named by, taken from the first request that
 * addressed it. The set's baseline is where its first committed revision put
 * it, so its name comes from the same round rather than from whichever later
 * reply happened to be read last.
 */
const changeSetLabels = (
  requests: ReadonlyArray<ChangeSetLabelSource>,
): ReadonlyMap<string, string> => {
  const labels = new Map<string, string>();
  for (const request of requests) {
    const label = request.targetLabel;
    if (label === undefined || label === "") continue;
    for (const id of changeSetIdsOwnedBy(request)) {
      if (!labels.has(id)) labels.set(id, label);
    }
  }
  return labels;
};

/**
 * Change sets as the approve dialog counts them, read from the aggregate the
 * committed revision log already owns.
 *
 * The fold is the authority on what a thread proposes: one set per thread,
 * starting where its first committed revision started and ending where its
 * latest one left the plan. Re-deriving that from agent responses instead was
 * an approximation in two ways that both fail quietly. The exchange is a
 * bounded window, so an older thread simply stopped being counted - approval
 * would then report every change set accepted while writing no acceptance for
 * the ones it could no longer see. And a fold assembled in response-read order
 * can pick a different baseline than the log's commit order did, which writes
 * acceptances at an address the reader's own diff never asks about, leaving
 * the change set open after the approval that closed it.
 *
 * Requests are read for labels alone; nothing about a set's identity or span
 * comes from them.
 */
export const changeSetsFromCommitted = ({
  committed,
  requests,
  placeIdsByRevision,
}: {
  readonly committed: ReadonlyArray<CommittedChangeSetFold>;
  readonly requests: ReadonlyArray<ChangeSetLabelSource>;
  readonly placeIdsByRevision: ReadonlyMap<string, ReadonlyArray<string>>;
}): ReadonlyArray<OpenChangeSet> => {
  const labels = changeSetLabels(requests);
  return committed.flatMap((changeSet): ReadonlyArray<OpenChangeSet> => {
    const from = changeSet.baseSnapshot;
    const to = changeSet.resultSnapshot;
    // A thread whose rounds cancelled back to where they started proposes
    // nothing, so there is no before-and-after left to accept.
    if (from === to) return [];
    const label =
      labels.get(changeSet.changeSetId) ?? `Version ${to.slice(0, 7)}`;
    const sectionId = sectionIdFromLabel(label);
    return [
      {
        id: changeSet.changeSetId,
        label,
        from,
        to,
        placeIds: placeIdsByRevision.get(`${from}:${to}`) ?? [],
        ...(sectionId === undefined ? {} : { sectionId }),
      },
    ];
  });
};

/** In-flight and queued requests, in the order the mailbox holds them. */
export const openRequestsFromExchange = (
  requests: ReadonlyArray<{
    readonly requestId: string;
    readonly body?: string;
    readonly kind: string;
    readonly targetLabel?: string;
    readonly answeredAt?: string;
    readonly canceledAt?: string;
  }>,
): ReadonlyArray<OpenRequest> =>
  requests
    .filter((request) => !requestIsTerminal(request))
    .map((request) => {
      const sectionId =
        request.targetLabel === undefined
          ? undefined
          : sectionIdFromLabel(request.targetLabel);
      return {
        requestId: request.requestId,
        label: requestLabel(request),
        ...(sectionId === undefined ? {} : { sectionId }),
      };
    });

const requestLabel = (request: {
  readonly body?: string;
  readonly kind: string;
  readonly targetLabel?: string;
}): string => {
  // The approval always carries a covering message, and quoting it here named
  // the reviewer's own words where every other row names the work.
  if (request.kind === "approval") return "Plan approval";
  const body = request.body?.trim() ?? "";
  if (body !== "") {
    const firstLine = body.split("\n", 1)[0] ?? body;
    return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  }
  if (request.targetLabel !== undefined && request.targetLabel !== "") {
    return request.targetLabel;
  }
  if (request.kind === "chat") return "Plan-wide question";
  return "Pending request";
};

/** The one join the toolbar, the dialog, and the record all read. */
export const deriveOpenItems = ({
  changeSets,
  accepted,
  rejected,
  inputs,
  requests,
}: {
  readonly changeSets: ReadonlyArray<OpenChangeSet>;
  readonly accepted: ReadonlySet<string>;
  readonly rejected: ReadonlySet<string>;
  readonly inputs: ReadonlyArray<ReviewInput>;
  readonly requests: ReadonlyArray<OpenRequest>;
}): DerivedOpenItems => {
  const standing = changeSets.map((changeSet) =>
    changeSetStanding({
      from: changeSet.from,
      to: changeSet.to,
      placeIds: changeSet.placeIds,
      accepted,
      rejected,
    }),
  );
  const openChangeSets = changeSets.filter((changeSet, index) => {
    const setStanding = standing[index];
    if (setStanding === undefined) return true;
    // A set whose places have not loaded yet is still open: treating it as
    // closed would promote Approve before the reviewer has seen the work.
    if (changeSet.placeIds.length === 0) return true;
    // A rejected change is decided, not outstanding: the reviewer answered it
    // and the plan already carries that answer, so a set holding one still
    // closes. Only a place nobody has decided keeps a set open.
    return !setStanding.isSettled;
  });
  const inputStanding = reviewInputStanding(inputs);
  const unanswered = inputs.filter((input) => input.state !== "answered");
  const recorded = inputs.filter((input) => input.state === "answered");
  const blockingCritical = unanswered.filter((input) => input.isCritical);
  // Critical unanswered decisions block approval, so an in-force approved
  // state can only still contain this leftover set.
  const unansweredNonCritical = unanswered.filter((input) => !input.isCritical);
  return {
    changeSets: {
      total: changeSets.length,
      accepted: standing.filter((set) => set.isAccepted).length,
      settled: standing.filter((set) => set.isSettled).length,
      open: openChangeSets,
      standing,
    },
    decisions: {
      total: inputStanding.total,
      answered: inputStanding.answered,
      unanswered,
      blockingCritical,
      unansweredNonCritical,
      recorded,
    },
    requests: { open: requests },
  };
};

/**
 * The change-set disclosure's caveat. Present only while a set is still open,
 * so a fully accepted list is not followed by a promise to auto-accept.
 */
export const approveChangeSetCaveat = (
  items: DerivedOpenItems,
): string | undefined =>
  items.changeSets.open.length > 0 ? APPROVE_CHANGE_SET_CAVEAT : undefined;

/**
 * The decisions disclosure's caveat. Present only while an answer is still
 * owed, so a settled list is not followed by a report about unanswered ones.
 */
export const approveDecisionCaveat = (
  items: DerivedOpenItems,
): string | undefined =>
  items.decisions.unanswered.length > 0 ? APPROVE_DECISION_CAVEAT : undefined;

/**
 * Leading slide number in a label such as "1.1 · Status quo" or "2 / Goals".
 * Absent when the label does not start with a kicker.
 */
export const sectionIdFromLabel = (label: string): string | undefined => {
  const match = label.trim().match(/^(\d+(?:\.\d+)*)(?=\s|[·/]|$)/u);
  return match?.[1];
};

/** The title with a leading section kicker removed, so the row can show both. */
export const titleAfterSectionId = (
  label: string,
  sectionId: string | undefined,
): string => {
  if (sectionId === undefined) return label;
  const escaped = sectionId.replaceAll(".", "\\.");
  const stripped = label
    .trim()
    .replace(new RegExp(`^${escaped}\\s*[·/]\\s*`, "u"), "");
  return stripped === "" ? label : stripped;
};

/** True when Approve should be the bar's accent, not a quiet secondary. */
export const approveIsPrimary = (items: DerivedOpenItems): boolean =>
  items.changeSets.open.length === 0 && items.decisions.unanswered.length === 0;
