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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { CIRCLE_QUESTION_MARK_ICON } from "../../icons/lucide/circle-question-mark.js";
import { OCTAGON_ALERT_ICON } from "../../icons/lucide/octagon-alert.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import {
  emptyReviewInputContract,
  reviewInputStanding,
  type ReviewInput,
  type ReviewInputContract,
  type ReviewInputStanding,
  type ReviewInputState,
} from "../shared/input-contract.js";
import { decodeReviewInputContract } from "../shared/review-wire.js";
import { Icon } from "./icon.browser.js";
import { liveDecisionFigure } from "./live-target.browser.js";
import { scrollToLiveElement } from "./thread-anchor.browser.js";
import {
  onAppliedReviewRecord,
  requestJson,
  runtimeIdentity,
  type RuntimeIdentity,
} from "./review-runtime-client.browser.js";
import { Badge, Button } from "./ui.browser.js";
import { useArticleVersion } from "./use-article-version.browser.js";

const INPUT_CONTRACT_PATH = "/api/input-contract";

/** Opens the Inputs tab and flashes the standing row. */
export const OPEN_INPUTS_EVENT = "bigplan:open-inputs";

const NEEDS_FLASH_MS = 1600;

let pendingNeedsFlash = false;

/** Asks the review chrome to show Inputs and highlight what is still owed. */
export const requestOpenInputs = (): void => {
  pendingNeedsFlash = true;
  document.dispatchEvent(new CustomEvent(OPEN_INPUTS_EVENT));
};

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
const watchReviewInputContract = (read: () => void): (() => void) => {
  read();
  return onAppliedReviewRecord(read);
};

/**
 * How the last read of the contract went.
 *
 * A read that failed is its own reading rather than a longer wait, because the
 * three say different things to the reviewer: still reading, nothing is asked
 * of you, and nobody could say. Collapsing the last into the first leaves the
 * panel claiming work is in progress when none is.
 */
export type ContractReadStanding = "reading" | "read" | "unavailable";

/** What the panel tells the reviewer, in the summary line and below it. */
export type InputsPanelReading = {
  readonly summary: string;
  readonly body: "inputs" | "nothing" | "unavailable" | "reading";
};

/**
 * Decides what the panel says, both at once.
 *
 * The two are decided together because they are one statement to the reviewer
 * and were twice found disagreeing: a summary reporting a conclusion over a
 * body still saying it was reading. Neither half may be chosen without the
 * other, so neither half is chosen where it is rendered.
 */
export const inputsPanelReading = ({
  standing,
  readStanding,
}: {
  readonly standing: ReviewInputStanding;
  readonly readStanding: ContractReadStanding;
}): InputsPanelReading => {
  if (standing.total > 0) {
    return {
      summary: `${standing.answered} of ${standing.total} answered`,
      body: "inputs",
    };
  }
  if (readStanding === "unavailable") {
    return { summary: "Not known", body: "unavailable" };
  }
  return readStanding === "read"
    ? { summary: "Nothing yet", body: "nothing" }
    : { summary: "Reading…", body: "reading" };
};

/**
 * Keeps the panel's copy of the contract equal to the runtime's.
 *
 * The contract is derived from a record that carries its own write count, so a
 * response counts as newer only when that count has not gone backwards. That is
 * the same guard the record gives its own reader.
 *
 * A read that fails once a contract is already shown leaves it shown: the
 * reviewer is better served by the list the runtime last gave than by losing it
 * to a failure that the next applied record will clear anyway.
 */
const useReviewInputContract = (): {
  readonly contract: ReviewInputContract;
  readonly standing: ContractReadStanding;
  readonly readAgain: () => void;
} => {
  const articleVersion = useArticleVersion();
  const [identity] = useState<RuntimeIdentity | null>(runtimeIdentity);
  const [contract, setContract] = useState<ReviewInputContract>(
    emptyReviewInputContract,
  );
  const [standing, setStanding] = useState<ContractReadStanding>("reading");
  const applied = useRef(-1);
  const reader = useRef<() => void>(() => undefined);

  const apply = useCallback((value: unknown): void => {
    const next = decodeReviewInputContract(value);
    if (next === undefined) {
      setStanding((current) => (current === "read" ? current : "unavailable"));
      return;
    }
    if (next.revision < applied.current) return;
    applied.current = next.revision;
    setContract(next);
    setStanding("read");
  }, []);

  useEffect(() => {
    if (identity === null) return;
    let cancelled = false;
    const read = (): void => {
      void requestJson({ path: INPUT_CONTRACT_PATH, identity })
        .then((value) => {
          if (!cancelled) apply(value);
        })
        .catch(() => {
          if (!cancelled) {
            setStanding((current) =>
              current === "read" ? current : "unavailable",
            );
          }
        });
    };
    reader.current = read;
    const stopWatching = watchReviewInputContract(read);
    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [apply, articleVersion, identity]);

  const readAgain = useCallback((): void => {
    setStanding((current) => (current === "read" ? current : "reading"));
    reader.current();
  }, []);

  return { contract, standing, readAgain };
};

// A decision the reader can be sent to is worth sending them to, so the whole
// row is the way there.
const showDecision = (decisionId: string): void => {
  const decision = liveDecisionFigure(decisionId);
  if ("missing" in decision) return;
  scrollToLiveElement(decision.found, "center");
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

/**
 * Says that nobody could answer what the review is waiting for, and offers the
 * reviewer the one thing that can change that.
 *
 * The retry matters more here than on most surfaces: without it the panel's
 * only other way back is applying an answered decision, which is the very
 * thing this panel exists to help the reviewer find.
 *
 * BIG-157's error taxonomy will formalize how a failed review read presents
 * itself; this is the minimal honest state until it does, not the final shape.
 */
const ContractUnavailable = ({
  onReadAgain,
}: {
  readonly onReadAgain: () => void;
}) => (
  <div
    className="min-w-0 rounded-md border border-edge bg-surface p-3 text-xs text-muted"
    data-review-input-unavailable=""
  >
    <p className="m-0 flex items-center gap-1.5 font-medium [&_svg]:size-4 [&_svg]:shrink-0">
      <Icon icon={OCTAGON_ALERT_ICON} />
      {"Could not read what this review needs"}
    </p>
    <p className="m-0 mt-1 text-2xs leading-normal text-subtle">
      {
        "The review runtime did not answer. Nothing you recorded is lost; this list is derived, so it comes back as soon as the runtime does."
      }
    </p>
    <Button
      className="mt-2"
      variant="outline"
      size="compact"
      onClick={onReadAgain}
    >
      <span className="inline-flex size-3" aria-hidden="true">
        <Icon icon={ROTATE_CCW_ICON} />
      </span>
      {"Try again"}
    </Button>
  </div>
);

/** Renders the review's input contract as the reviewer's outstanding work. */
export const InputsSurface = () => {
  const {
    contract,
    standing: readStanding,
    readAgain,
  } = useReviewInputContract();
  const standing = useMemo(
    () => reviewInputStanding(contract.inputs),
    [contract.inputs],
  );
  const reading = useMemo(
    () => inputsPanelReading({ standing, readStanding }),
    [standing, readStanding],
  );
  const needsRef = useRef<HTMLElement>(null);
  const [needsFlash, setNeedsFlash] = useState(false);

  const startNeedsFlash = useCallback(() => {
    pendingNeedsFlash = false;
    setNeedsFlash(true);
    needsRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  useLayoutEffect(() => {
    if (pendingNeedsFlash) startNeedsFlash();
    document.addEventListener(OPEN_INPUTS_EVENT, startNeedsFlash);
    return () =>
      document.removeEventListener(OPEN_INPUTS_EVENT, startNeedsFlash);
  }, [startNeedsFlash]);

  useEffect(() => {
    if (!needsFlash) return;
    const timer = window.setTimeout(() => setNeedsFlash(false), NEEDS_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [needsFlash]);

  return (
    <div
      id="review-panel-inputs"
      className="review-feedback-panel grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-x-hidden overflow-y-auto p-3"
      role="tabpanel"
      aria-labelledby="review-tab-inputs"
    >
      <section
        ref={needsRef}
        className={`min-w-0 rounded-lg p-3 transition-colors motion-reduce:transition-none ${needsFlash ? "bg-accent-wash outline-2 outline-offset-2 outline-accent" : "bg-surface"}`}
        data-review-input-needs=""
        {...(needsFlash ? { "data-review-input-needs-flash": "" } : {})}
      >
        <h3 className="m-0 text-xs font-bold tracking-caps text-muted uppercase">
          {"What this review needs"}
        </h3>
        <p
          className="m-0 mt-1.5 text-sm text-ink"
          data-review-input-standing=""
        >
          {reading.summary}
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
      {reading.body === "inputs" ? (
        <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
          {contract.inputs.map((input) => (
            <InputRow key={input.inputId} input={input} />
          ))}
        </ul>
      ) : reading.body === "unavailable" ? (
        <ContractUnavailable onReadAgain={readAgain} />
      ) : (
        <p className="m-0 text-sm text-muted">
          {reading.body === "nothing"
            ? "This plan asks nothing of you yet. Decisions the plan raises appear here as the review goes on."
            : "Reading what this review expects…"}
        </p>
      )}
    </div>
  );
};
