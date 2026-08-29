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

/** The request shape a change set is counted from. */
type ChangeSetRequest = {
  readonly requestId: string;
  readonly premiseSnapshot: string;
  readonly baselineSnapshot?: string;
  readonly targetLabel?: string;
  /** The browser's projection of a feedback request's comments. */
  readonly commentIds?: ReadonlyArray<string>;
  /** The comments a feedback request carries, as the store holds them. */
  readonly comments?: ReadonlyArray<{ readonly id: string }>;
  readonly commentId?: string;
  readonly threadId?: string;
};

/**
 * Which change set a request's revision belongs to.
 *
 * A thread's replies all commit into the set the thread owns, so the ids the
 * request carries are tried against the committed fold before the request
 * falls back to owning a set alone - which is what a chat turn or a revision
 * committed before the fold knew about it actually does.
 *
 * A feedback request names its comments one way in the store and another over
 * the wire, and both callers pass their own shape straight through, so both
 * are read here: missing the store's shape would leave a thread's opening
 * round owning a set of its own that no later reply could fold into.
 */
const changeSetIdFor = ({
  request,
  changeSetIds,
}: {
  readonly request: ChangeSetRequest;
  readonly changeSetIds: ReadonlySet<string>;
}): string =>
  [
    ...(request.commentIds ?? []),
    ...(request.comments ?? []).map((comment) => comment.id),
    ...(request.commentId === undefined ? [] : [request.commentId]),
    ...(request.threadId === undefined ? [] : [request.threadId]),
  ].find((id) => changeSetIds.has(id)) ?? request.requestId;

/**
 * Change sets as the approve dialog counts them: one per set that actually
 * moved the plan, spanning every revision committed into it.
 *
 * A thread that answered three times is one thing to review, not three, and
 * the two earlier rounds are not separately acceptable - they no longer
 * describe any before-and-after the plan still stands on. So the rounds fold:
 * the set starts where its first revision did and ends where its last one left
 * the plan.
 */
export const changeSetsFromExchange = ({
  requests,
  responses,
  placeIdsByRevision,
  committedChangeSetIds = new Set(),
}: {
  readonly requests: ReadonlyArray<ChangeSetRequest>;
  readonly responses: ReadonlyArray<{
    readonly requestId: string;
    readonly resultSnapshot: string;
  }>;
  readonly placeIdsByRevision: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly committedChangeSetIds?: ReadonlySet<string>;
}): ReadonlyArray<OpenChangeSet> => {
  const byId = new Map(requests.map((request) => [request.requestId, request]));
  const folded = new Map<
    string,
    { readonly from: string; to: string; readonly label: string }
  >();
  for (const response of responses) {
    const request = byId.get(response.requestId);
    if (request === undefined) continue;
    const from = request.baselineSnapshot ?? request.premiseSnapshot;
    if (from === response.resultSnapshot) continue;
    const id = changeSetIdFor({
      request,
      changeSetIds: committedChangeSetIds,
    });
    const started = folded.get(id);
    if (started === undefined) {
      folded.set(id, {
        from,
        to: response.resultSnapshot,
        label:
          request.targetLabel ??
          `Version ${response.resultSnapshot.slice(0, 7)}`,
      });
      continue;
    }
    started.to = response.resultSnapshot;
  }
  const sets: OpenChangeSet[] = [];
  for (const [id, { from, to, label }] of folded) {
    if (from === to) continue;
    const sectionId = sectionIdFromLabel(label);
    sets.push({
      id,
      label,
      from,
      to,
      placeIds: placeIdsByRevision.get(`${from}:${to}`) ?? [],
      ...(sectionId === undefined ? {} : { sectionId }),
    });
  }
  return sets;
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
  const body = request.body?.trim() ?? "";
  if (body !== "") {
    const firstLine = body.split("\n", 1)[0] ?? body;
    return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  }
  if (request.targetLabel !== undefined && request.targetLabel !== "") {
    return request.targetLabel;
  }
  return request.kind === "chat" ? "Plan-wide question" : "Pending request";
};

/** The one join the toolbar, the dialog, and the record all read. */
export const deriveOpenItems = ({
  changeSets,
  accepted,
  inputs,
  requests,
}: {
  readonly changeSets: ReadonlyArray<OpenChangeSet>;
  readonly accepted: ReadonlySet<string>;
  readonly inputs: ReadonlyArray<ReviewInput>;
  readonly requests: ReadonlyArray<OpenRequest>;
}): DerivedOpenItems => {
  const standing = changeSets.map((changeSet) =>
    changeSetStanding({
      from: changeSet.from,
      to: changeSet.to,
      placeIds: changeSet.placeIds,
      accepted,
    }),
  );
  const openChangeSets = changeSets.filter((changeSet, index) => {
    const setStanding = standing[index];
    if (setStanding === undefined) return true;
    // A set whose places have not loaded yet is still open: treating it as
    // closed would promote Approve before the reviewer has seen the work.
    if (changeSet.placeIds.length === 0) return true;
    return !setStanding.isAccepted;
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
