// Owns the entry that tells a reader a push just landed.
//
// The push is the one change to the plan the reviewer did not ask for, and the
// swap that shows it is deliberately quiet: scroll, threads, and composer text
// all survive it precisely so the reader is not thrown. That leaves the reader
// looking at words they did not watch change. This entry closes that gap in
// the one place the conversation already lives, and it answers the three
// questions in the order they get asked: when, who, and what changed.
//
// It is transient by construction. It names one arrival, it is dismissible,
// and opening the thread it points at is a dismissal too, because a reader who
// is now reading the thread no longer needs to be told there is one.

import { BOT_ICON } from "../../icons/lucide/bot.js";
import { agentModelDisplayName } from "../shared/agent-identity-catalog.js";
import type { AttachedAgent } from "../shared/agent-primacy.js";
import type { PushArrival } from "../shared/push-arrival.js";
import { relativeSignalLabel } from "../shared/time-label.js";
import { AgentIdentityText } from "./agent-identity.browser.js";
import { Icon } from "./icon.browser.js";
import { Button, Card } from "./ui.browser.js";

/**
 * How the entry names the moment. "Just now" is the copy the arrival earns on
 * sight, and the shared relative label takes over the instant that stops being
 * true, so an entry left alone on a second monitor ages honestly instead of
 * insisting a half-hour-old change is fresh.
 */
export const pushArrivalTimeLabel = ({
  arrivedAt,
  nowMs,
}: {
  readonly arrivedAt: string;
  readonly nowMs: number;
}): string => {
  const at = Date.parse(arrivedAt);
  if (!Number.isFinite(at)) return "Pushed just now";
  const label = relativeSignalLabel({ now: nowMs, at });
  return label === "signal unavailable" ? "Pushed just now" : `Pushed ${label}`;
};

/** How the roster answers "which agent is this?", for one arrival. */
export type PushArrivalLabelResolver = (
  agent: Pick<AttachedAgent, "writerId" | "model">,
) => string;

/**
 * How the entry names the agent that pushed.
 *
 * Resolved through the roster's own resolver rather than from the model alone,
 * because two connectors running the same model are one name and two agents:
 * the roster spends a short writer id to tell them apart, and an entry that
 * did not would leave the reader unable to say which of the two just changed
 * their plan. A push with no recorded claim has no id to spend, so it falls
 * back to whatever it declared.
 */
export const pushArrivalAgentLabel = ({
  arrival,
  labelFor,
}: {
  readonly arrival: PushArrival;
  readonly labelFor: PushArrivalLabelResolver;
}): string => {
  if (arrival.claimedBy === undefined) {
    const name = arrival.model?.name;
    return name === undefined ? "Agent" : agentModelDisplayName(name);
  }
  return labelFor({
    writerId: arrival.claimedBy,
    ...(arrival.model === undefined ? {} : { model: arrival.model }),
  });
};

/**
 * How the entry summarises what the revision touched, or nothing at all.
 *
 * A push may open a thread about a block without revising the plan, which is
 * what `push --about` is for. There is no count to give for one of those, and
 * "0 blocks changed in the plan" is a sentence that describes nothing while
 * occupying the line the reader looks at to find out what happened - so the
 * line is dropped and the arrival is announced by who pushed and when.
 */
export const pushArrivalChangeLabel = (
  changeTargets: ReadonlyArray<string>,
): string | null =>
  changeTargets.length === 0
    ? null
    : changeTargets.length === 1
      ? "1 block changed in the plan."
      : `${changeTargets.length} blocks changed in the plan.`;

export const PushArrivalEntry = ({
  arrival,
  nowMs,
  labelFor,
  onOpenThread,
  onDismiss,
}: {
  readonly arrival: PushArrival;
  readonly nowMs: number;
  readonly labelFor: PushArrivalLabelResolver;
  readonly onOpenThread: () => void;
  readonly onDismiss: () => void;
}) => {
  const changeLabel = pushArrivalChangeLabel(arrival.changeTargets);
  return (
    <Card
      density="compact"
      elevation="none"
      className="border border-accent"
      data-review-push-arrival={arrival.requestId}
      /* Polite, never assertive: the reader is mid-sentence, and the entry is
         an offer rather than an interruption. */
      role="status"
    >
      {/* An eyebrow, so the three lines read as one ramp: what happened, who
          did it, and what it touched. The identity keeps the agent card's own
          presentation exactly, which is what stops one agent reading as two
          across the two surfaces. */}
      <p className="m-0 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-caps text-muted">
        <Icon icon={BOT_ICON} />
        {pushArrivalTimeLabel({ arrivedAt: arrival.arrivedAt, nowMs })}
      </p>
      <p className="mt-1.5 mb-0 text-xs font-semibold text-ink [overflow-wrap:anywhere]">
        <AgentIdentityText
          label={pushArrivalAgentLabel({ arrival, labelFor })}
          client={arrival.model?.client}
        />
      </p>
      {changeLabel === null ? null : (
        <p className="mt-1 mb-0 text-2xs text-muted">{changeLabel}</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onOpenThread}>
          Open thread
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Card>
  );
};
