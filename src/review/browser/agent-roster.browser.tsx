// Owns the rail's per-agent cards and the question a second agent raises.
//
// One card per attached agent, because the reviewer's question is "who is
// answering me, and who else is here" and a single card cannot hold two
// answers. The card that matters most is the one for an agent that has just
// arrived: it states what happened, offers the three answers, and says what
// each one will do before the reviewer commits to any of them (BIG-171).

import { useState } from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { INFO_ICON } from "../../icons/lucide/info.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import {
  agentIsAttached,
  agentModelLabel,
  orderAttachedAgents,
  pendingPrimacyRequest,
  selectPrimaryAgent,
  type RosterAgent,
} from "../shared/agent-primacy.js";
import { agentClientDisplayName } from "../shared/agent-identity-catalog.js";
import { compactDurationLabel } from "../shared/time-label.js";
import { Icon } from "./icon.browser.js";
import { AlertDialog, Button } from "./ui.browser.js";

/** What the reviewer can answer about one agent. */
export type PrimacyAnswer = "primary" | "observer" | "disconnect";

export type AgentRosterProps = {
  readonly agents: ReadonlyArray<RosterAgent>;
  readonly nowMs: number;
  readonly isReadOnly: boolean;
  readonly onAnswer: (input: {
    readonly writerId: string;
    readonly answer: PrimacyAnswer;
    /** Whether the displaced agent's draft goes to the new primary. */
    readonly carryWorkInProgress?: boolean;
  }) => void;
};

/**
 * One line of consequence, tied to the control it describes.
 *
 * The reviewer asked for this directly: they should not have to click "Make it
 * primary" to discover what "Make it primary" does. The note sits under its
 * button rather than behind a tooltip so it is readable without a pointer, and
 * so a keyboard reader meets it in the same order.
 */
const ConsequenceNote = ({ text }: { readonly text: string }) => (
  <p className="m-0 flex gap-1.5 text-2xs text-muted [&>span>svg]:size-3">
    <span className="mt-px inline-flex shrink-0" aria-hidden="true">
      <Icon icon={INFO_ICON} />
    </span>
    <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
  </p>
);

/** The identity line every agent card carries. */
const AgentIdentity = ({ agent }: { readonly agent: RosterAgent }) => {
  const client = agent.model?.client;
  return (
    <p
      className="m-0 text-xs font-semibold text-ink [overflow-wrap:anywhere]"
      data-review-agent-writer={agent.writerId}
    >
      {agentModelLabel(agent)}
      {client === undefined ? null : (
        <span className="font-normal text-muted">
          {" · "}
          {agentClientDisplayName(client)}
        </span>
      )}
    </p>
  );
};

const AttachedSince = ({
  agent,
  nowMs,
}: {
  readonly agent: RosterAgent;
  readonly nowMs: number;
}) => {
  const since = compactDurationLabel({
    start: agent.attachedAtMs,
    end: Math.max(nowMs, agent.attachedAtMs),
  });
  return since === null ? null : (
    <p className="m-0 text-2xs text-muted">Attached {since} ago</p>
  );
};

/**
 * The card for an agent that has just arrived and is asking to take over.
 *
 * It is the only card with a heading that states an event rather than a state,
 * because it is the only one reporting something that just happened to the
 * reviewer rather than describing a standing arrangement.
 */
const PrimacyRequestCard = ({
  agent,
  primary,
  nowMs,
  isReadOnly,
  onAnswer,
}: {
  readonly agent: RosterAgent;
  readonly primary: RosterAgent | undefined;
  readonly nowMs: number;
  readonly isReadOnly: boolean;
  readonly onAnswer: AgentRosterProps["onAnswer"];
}) => (
  <article
    className="grid min-w-0 gap-2 rounded-lg border border-[var(--callout-warning-c)] bg-[var(--callout-warning-bg)] p-3"
    data-review-agent-card="request"
  >
    <h3 className="m-0 flex min-w-0 items-center gap-1.5 text-sm text-ink [&>span>svg]:size-3.5">
      <span
        className="inline-flex shrink-0 text-[var(--callout-warning-c)]"
        aria-hidden="true"
      >
        <Icon icon={TRIANGLE_ALERT_ICON} />
      </span>
      A second agent wants to answer you
    </h3>
    <AgentIdentity agent={agent} />
    <AttachedSince agent={agent} nowMs={nowMs} />
    {isReadOnly ? (
      <p className="m-0 text-xs text-muted">
        This session is read-only, so it cannot answer for the plan.
      </p>
    ) : (
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Button
            variant="default"
            size="sm"
            className="w-fit"
            onClick={() =>
              onAnswer({ writerId: agent.writerId, answer: "primary" })
            }
          >
            Make it primary
          </Button>
          <ConsequenceNote
            text={
              primary === undefined
                ? `${agentModelLabel(agent)} answers your comments from now on.`
                : `${agentModelLabel(agent)} answers your comments from now on, and ${agentModelLabel(primary)} becomes the observer.`
            }
          />
        </div>
        <div className="grid gap-1">
          <Button
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() =>
              onAnswer({ writerId: agent.writerId, answer: "observer" })
            }
          >
            Leave it as observer
          </Button>
          <ConsequenceNote text="It keeps reading this review and cannot answer you." />
        </div>
        <div className="grid gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() =>
              onAnswer({ writerId: agent.writerId, answer: "disconnect" })
            }
          >
            Disconnect this agent
          </Button>
          <ConsequenceNote text="It is dropped from this review and told at its next command." />
        </div>
      </div>
    )}
  </article>
);

/** A settled card: this agent owns the plan, or reads it. */
const AgentCard = ({
  agent,
  isPrimary,
  nowMs,
  isReadOnly,
  onAnswer,
}: {
  readonly agent: RosterAgent;
  readonly isPrimary: boolean;
  readonly nowMs: number;
  readonly isReadOnly: boolean;
  readonly onAnswer: AgentRosterProps["onAnswer"];
}) => (
  <article
    className="grid min-w-0 gap-1.5 rounded-lg border border-edge bg-raised p-3"
    data-review-agent-card={isPrimary ? "primary" : "observer"}
  >
    <p className="m-0 flex items-center gap-1.5 text-2xs font-semibold tracking-caps text-muted uppercase [&>span>svg]:size-3">
      {isPrimary ? (
        <span
          className="inline-flex shrink-0 text-agent-live"
          aria-hidden="true"
        >
          <Icon icon={CHECK_ICON} />
        </span>
      ) : null}
      {isPrimary ? "Primary" : "Observer"}
    </p>
    <AgentIdentity agent={agent} />
    {isPrimary ? (
      <AttachedSince agent={agent} nowMs={nowMs} />
    ) : (
      <p className="m-0 text-2xs text-muted">
        Reads this review but cannot answer you until it becomes the primary.
      </p>
    )}
    {isReadOnly ? null : (
      <div className="flex flex-wrap gap-2 pt-0.5">
        {isPrimary ? null : (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onAnswer({ writerId: agent.writerId, answer: "primary" })
            }
          >
            Make it primary
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onAnswer({ writerId: agent.writerId, answer: "disconnect" })
          }
        >
          Disconnect
        </Button>
      </div>
    )}
  </article>
);

/**
 * The rail's agent roster.
 *
 * Renders nothing at all when one agent is attached and nothing is being asked.
 * That is the quiet steady state the reviewer asked for: the existing activity
 * card already says who is connected and what they are doing, so a second card
 * repeating it would be the noise this surface exists to avoid. The roster
 * appears exactly when there is more than one agent to tell apart.
 */
export const AgentRoster = ({
  agents,
  nowMs,
  isReadOnly,
  onAnswer,
}: AgentRosterProps) => {
  const primary = selectPrimaryAgent({ agents, nowMs });
  const requesting = pendingPrimacyRequest({ agents, nowMs });
  /*
  The same membership test every selector beside this one already applies.

  Reaping happens on a roster write, so a review whose agents have all exited
  is never swept while the reviewer sits reading. Drawing the raw list put
  cards on screen for processes that were gone - offering "Make it primary" on
  a dead agent, and answering it - and once the last live primary aged out the
  dead one's card silently relabelled itself an observer.
  */
  const ordered = orderAttachedAgents(agents).filter((agent) =>
    agentIsAttached({ agent, nowMs }),
  );
  if (ordered.length < 2 && requesting === undefined) return null;
  return (
    <section className="grid min-w-0 gap-2" data-review-agent-roster="">
      {requesting === undefined ? null : (
        <PrimacyRequestCard
          agent={requesting}
          primary={primary}
          nowMs={nowMs}
          isReadOnly={isReadOnly}
          onAnswer={onAnswer}
        />
      )}
      {ordered
        .filter((agent) => agent.writerId !== requesting?.writerId)
        .map((agent) => (
          <AgentCard
            key={agent.writerId}
            agent={agent}
            isPrimary={agent.writerId === primary?.writerId}
            nowMs={nowMs}
            isReadOnly={isReadOnly}
            onAnswer={onAnswer}
          />
        ))}
    </section>
  );
};

/**
 * The confirmation the reviewer sees before primacy actually moves.
 *
 * Built on the shared `AlertDialog` rather than hand-rolled markup, which is
 * what makes it genuinely modal: focus moves in and is restored on close, Tab
 * is contained, and Escape dismisses. A dialog that only claims `aria-modal`
 * lets a keyboard reader tab straight out of it and gives them no way out
 * without a pointer.
 *
 * The consequences are the dialog's evidence slot, and the work-in-progress
 * toggle sits with them because it is a fact about what the answer will do.
 * It defaults off: a half-formed draft from another model can mislead as
 * easily as it helps, so carrying it over is a choice the reviewer makes, and
 * the copy says it arrives as reference rather than as something that
 * publishes itself.
 */
export const PrimacyHandoffDialog = ({
  agent,
  primary,
  onConfirm,
  onCancel,
}: {
  readonly agent: RosterAgent;
  readonly primary: RosterAgent | undefined;
  readonly onConfirm: (input: {
    readonly carryWorkInProgress: boolean;
  }) => void;
  readonly onCancel: () => void;
}) => {
  const [carryWorkInProgress, setCarryWorkInProgress] = useState(false);
  return (
    <AlertDialog
      open
      tone="neutral"
      title={`Make ${agentModelLabel(agent)} the primary?`}
      description={
        primary === undefined
          ? `${agentModelLabel(agent)} answers your comments from now on.`
          : `${agentModelLabel(primary)} is answering you right now.`
      }
      actionLabel="Make primary"
      onAction={() => onConfirm({ carryWorkInProgress })}
      onCancel={onCancel}
    >
      <p className="m-0 text-2xs font-semibold tracking-caps text-muted uppercase">
        What happens
      </p>
      <ul className="m-0 grid list-disc gap-1 pl-4 text-xs text-ink marker:text-muted">
        <li>
          {agentModelLabel(agent)} answers the open comment and every comment
          after it.
        </li>
        {primary === undefined ? null : (
          <li>{agentModelLabel(primary)} becomes the observer.</li>
        )}
        <li>No submitted comments are lost.</li>
      </ul>
      {primary === undefined ? null : (
        <label className="flex items-start gap-2 text-xs text-ink">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={carryWorkInProgress}
            onChange={(event) =>
              setCarryWorkInProgress(event.currentTarget.checked)
            }
          />
          <span className="min-w-0">
            Give {agentModelLabel(agent)} the work in progress
            <span className="block text-2xs text-muted">
              It arrives as reference to read, never as something that publishes
              itself. Left off, the draft stays with {agentModelLabel(primary)}{" "}
              and never reaches the plan.
            </span>
          </span>
        </label>
      )}
    </AlertDialog>
  );
};
