// Owns the Inputs tab: what this review is still waiting for, and where each
// of those things stands.
//
// The list is the runtime's answer, not this panel's. Every state shown here -
// answered, not answered, stale, critical - is derived server-side from the
// plan the runtime compiled and the record the reviewer's answers go into, so
// a second browser reading the same review reads the same contract and a
// reload cannot invent a different one.
//
// The panel refetches on exactly the moments this page applied a newer copy of
// the record the contract is derived from, and on a replaced article. A clock
// of its own would make it more current than the decision cards that same
// record drives, and two surfaces disagreeing about one review is the failure
// the contract exists to remove.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CIRCLE_QUESTION_MARK_ICON } from "../../icons/lucide/circle-question-mark.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import {
  emptyReviewInputContract,
  reviewInputStanding,
  type ReviewInput,
  type ReviewInputContract,
  type ReviewInputState,
} from "../shared/input-contract.js";
import { decodeReviewInputContract } from "../shared/review-wire.js";
import { Icon } from "./icon.browser.js";
import { displayedStandIn, liveDecisionFigure } from "./live-target.browser.js";
import {
  onAppliedReviewRecord,
  requestJson,
  runtimeIdentity,
  type RuntimeIdentity,
} from "./review-runtime-client.browser.js";
import { Badge } from "./ui.browser.js";
import { useArticleVersion } from "./use-article-version.browser.js";

const INPUT_CONTRACT_PATH = "/api/input-contract";

const STATE_LABELS: Readonly<Record<ReviewInputState, string>> = {
  answered: "Answered",
  unanswered: "Not answered",
  stale: "Stale",
};

// Colour never carries a state on its own here: each reading ships a word and
// a glyph, so a reader who cannot separate the tints still reads the contract.
const STATE_TONES = {
  answered: "statusAccent",
  unanswered: "statusNeutral",
  stale: "statusWarning",
} as const satisfies Readonly<Record<ReviewInputState, string>>;

const STATE_ICONS: Readonly<Record<ReviewInputState, typeof CHECK_ICON>> = {
  answered: CHECK_ICON,
  unanswered: CIRCLE_QUESTION_MARK_ICON,
  stale: TRIANGLE_ALERT_ICON,
};

/**
 * Reads the contract now, and again every time this page applies a newer copy
 * of the record it is derived from. Returns how to stop.
 *
 * This is the whole of the panel's currency policy, and it is a function
 * rather than an effect body because the failure it prevents is silent: a
 * panel that stopped hearing those moments keeps showing a review the decision
 * cards have already moved past, and nothing throws.
 */
export const watchReviewInputContract = (read: () => void): (() => void) => {
  read();
  return onAppliedReviewRecord(read);
};

/**
 * Keeps the panel's copy of the contract equal to the runtime's.
 *
 * The contract is derived from a record that carries its own write count, so a
 * response counts as newer only when that count has not gone backwards. That is
 * the same guard the record gives its own reader.
 */
const useReviewInputContract = (): {
  readonly contract: ReviewInputContract;
  readonly hasLoaded: boolean;
} => {
  const articleVersion = useArticleVersion();
  const [identity] = useState<RuntimeIdentity | null>(runtimeIdentity);
  const [contract, setContract] = useState<ReviewInputContract>(
    emptyReviewInputContract,
  );
  const [hasLoaded, setHasLoaded] = useState(false);
  const applied = useRef(-1);

  const apply = useCallback((value: unknown): void => {
    const next = decodeReviewInputContract(value);
    if (next.revision < applied.current) return;
    applied.current = next.revision;
    setContract(next);
    setHasLoaded(true);
  }, []);

  useEffect(() => {
    if (identity === null) return;
    let cancelled = false;
    const read = (): void => {
      void requestJson({ path: INPUT_CONTRACT_PATH, identity })
        .then((value) => {
          if (!cancelled) apply(value);
        })
        .catch(() => undefined);
    };
    const stopWatching = watchReviewInputContract(read);
    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [apply, articleVersion, identity]);

  return { contract, hasLoaded };
};

// A decision the reader can be sent to is worth sending them to, so the whole
// row is the way there.
const showDecision = (decisionId: string): void => {
  const decision = liveDecisionFigure(decisionId);
  if ("missing" in decision) return;
  (displayedStandIn(decision.found) ?? decision.found).scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
};

const InputRow = ({ input }: { readonly input: ReviewInput }) => (
  <li
    className="min-w-0 rounded-lg bg-surface"
    data-review-input={input.inputId}
    data-review-input-state={input.state}
    {...(input.isCritical ? { "data-review-input-critical": "" } : {})}
  >
    <button
      type="button"
      className="block w-full cursor-pointer rounded-lg border border-transparent bg-transparent p-3 text-left transition hover:bg-raised hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
      onClick={() => showDecision(input.inputId)}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge size="status" tone={STATE_TONES[input.state]}>
          <span className="mr-1 inline-flex size-3" aria-hidden="true">
            <Icon icon={STATE_ICONS[input.state]} />
          </span>
          {STATE_LABELS[input.state]}
        </Badge>
        {input.isCritical ? (
          <Badge size="status" tone="statusWarningOutline">
            {"Critical"}
          </Badge>
        ) : null}
      </span>
      <span className="mt-1.5 block text-sm font-medium text-ink">
        {input.label}
      </span>
      <span className="mt-0.5 block text-xs text-muted">{input.detail}</span>
    </button>
  </li>
);

/** Renders the review's input contract as the reviewer's outstanding work. */
export const InputsSurface = () => {
  const { contract, hasLoaded } = useReviewInputContract();
  const standing = useMemo(
    () => reviewInputStanding(contract.inputs),
    [contract.inputs],
  );
  return (
    <div
      id="review-panel-inputs"
      className="review-feedback-panel min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 grid content-start gap-3"
      role="tabpanel"
      aria-labelledby="review-tab-inputs"
    >
      <section className="min-w-0 rounded-lg bg-surface p-3">
        <h3 className="m-0 text-xs font-bold tracking-caps text-muted uppercase">
          {"What this review needs"}
        </h3>
        <p
          className="m-0 mt-1.5 text-sm text-ink"
          data-review-input-standing=""
        >
          {standing.total === 0
            ? "Nothing yet"
            : `${standing.answered} of ${standing.total} answered`}
        </p>
        {standing.criticalOpen > 0 ? (
          <p className="m-0 mt-1 text-xs font-medium text-[var(--callout-warning-c)]">
            {standing.criticalOpen === 1
              ? "1 critical input is still open"
              : `${standing.criticalOpen} critical inputs are still open`}
          </p>
        ) : null}
        {standing.stale > 0 ? (
          <p className="m-0 mt-1 text-xs text-muted">
            {standing.stale === 1
              ? "1 answer stopped applying after the plan changed"
              : `${standing.stale} answers stopped applying after the plan changed`}
          </p>
        ) : null}
      </section>
      {contract.inputs.length === 0 ? (
        <p className="m-0 text-sm text-muted">
          {hasLoaded
            ? "This plan asks nothing of you yet. Decisions the plan raises appear here as the review goes on."
            : "Reading what this review expects…"}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {contract.inputs.map((input) => (
            <InputRow key={input.inputId} input={input} />
          ))}
        </ul>
      )}
    </div>
  );
};
