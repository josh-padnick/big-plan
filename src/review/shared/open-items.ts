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

/**
 * Change sets as the approve dialog counts them: one responded revision that
 * actually moved the plan, addressed by its request id.
 */
export const changeSetsFromExchange = ({
  requests,
  responses,
  placeIdsByRevision,
}: {
  readonly requests: ReadonlyArray<{
    readonly requestId: string;
    readonly premiseSnapshot: string;
    readonly baselineSnapshot?: string;
    readonly targetLabel?: string;
  }>;
  readonly responses: ReadonlyArray<{
    readonly requestId: string;
    readonly resultSnapshot: string;
  }>;
  readonly placeIdsByRevision: ReadonlyMap<string, ReadonlyArray<string>>;
}): ReadonlyArray<OpenChangeSet> => {
  const byId = new Map(requests.map((request) => [request.requestId, request]));
  const sets: OpenChangeSet[] = [];
  for (const response of responses) {
    const request = byId.get(response.requestId);
    if (request === undefined) continue;
    const from = request.baselineSnapshot ?? request.premiseSnapshot;
    if (from === response.resultSnapshot) continue;
    const key = `${from}:${response.resultSnapshot}`;
    const placeIds = placeIdsByRevision.get(key) ?? [];
    const label =
      request.targetLabel ?? `Version ${response.resultSnapshot.slice(0, 7)}`;
    const sectionId = sectionIdFromLabel(label);
    sets.push({
      id: response.requestId,
      label,
      from,
      to: response.resultSnapshot,
      placeIds,
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
