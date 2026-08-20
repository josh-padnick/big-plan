// Owns the rail's per-agent cards and the question a second agent raises.
//
// One card per attached agent, because the reviewer's question is "who is
// answering me, and who else is here" and a single card cannot hold two
// answers. One card per agent is also a ceiling: the agent that holds the plan
// is drawn by the activity card above this section, so this section draws
// everyone else. Three cards for two agents is what the reviewer saw when both
// surfaces drew the primary (BIG-171).
//
// The card that matters most is the one for an agent that has just arrived: it
// states what happened, offers the three answers, and says what each one will
// do before the reviewer commits to any of them.

import type { ReactNode } from "react";
import { useState } from "react";
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
import { AlertDialog, Badge, Button, Tooltip } from "./ui.browser.js";

/** What the reviewer can answer about one agent. */
export type PrimacyAnswer = "primary" | "observer" | "disconnect";

export type AgentRosterProps = {
  readonly agents: ReadonlyArray<RosterAgent>;
  readonly nowMs: number;
  readonly isReadOnly: boolean;
  /**
   * The agent the activity card above is already drawing, when it is drawing
   * one. This section leaves that agent out rather than repeating it.
   */
  readonly carriedByActivity?: string;
  readonly onAnswer: (input: {
    readonly writerId: string;
    readonly answer: PrimacyAnswer;
    /** Whether the displaced agent's draft goes to the new primary. */
    readonly carryWorkInProgress?: boolean;
  }) => void;
};

/**
 * Names the role an agent holds, small and in the card's top corner.
 *
 * A badge rather than the section-heading face this used to wear. Set in caps
 * and letterspaced above the agent's name, "PRIMARY" read as a heading over a
 * region - as though everything below it were the primary section - which is
 * exactly the wrong reading in a list where the next card carries a different
 * role. A badge reads as a property of the thing it sits on, and the tint
 * separates the two roles for a reader who is scanning rather than reading.
 */
export const AgentRoleBadge = ({
  isPrimary,
}: {
  readonly isPrimary: boolean;
}) => (
  <Badge
    size="status"
    tone={isPrimary ? "statusAccent" : "statusNeutral"}
    data-review-agent-role={isPrimary ? "primary" : "observer"}
  >
    {isPrimary ? "Current primary" : "Current observer"}
  </Badge>
);

/**
 * The mark that answers "what does this button do" without spending a line.
 *
 * The consequence used to be printed under each control. That was readable,
 * and three of them stacked turned a card about two agents into a wall of
 * explanation with the controls lost inside it, so the reviewer asked for the
 * sentences to go behind marks. It stays a real button so the tooltip opens on
 * focus as well as on hover, and `Tooltip` names it through `aria-describedby`
 * - a keyboard reader still meets the sentence, in the same order.
 */
const ConsequenceHelp = ({
  text,
  outcome,
}: {
  readonly text: string;
  /**
   * The outcome this mark explains, named for a reader who cannot see which
   * row it sits in.
   *
   * It deliberately does not repeat the button's own label. Three marks called
   * "About Make it primary", "About Leave as observer" and so on give a screen
   * reader the same words twice in a row and leave a name that contains a
   * control's whole label - which is also how the first version of this made
   * every "Make it primary" query in the suite ambiguous.
   */
  readonly outcome: string;
}) => (
  <Tooltip label={text} placement="above" asChild>
    <button
      type="button"
      className="inline-flex size-5 flex-none cursor-help items-center justify-center rounded-full border-0 bg-transparent p-0 leading-none text-muted opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&>svg]:size-3.5"
      aria-label={`What happens when ${outcome}`}
    >
      <Icon icon={INFO_ICON} />
    </button>
  </Tooltip>
);

/**
 * One answer the reviewer can give, with the mark that explains it.
 *
 * The controls are a column rather than a row because they are three answers
 * to one question, and a row of three ranks them by reading order instead of
 * by weight. The button takes the whole measure so the stack has one edge, and
 * the marks line up in their own column beside it.
 */
const AnswerRow = ({
  label,
  variant,
  help,
  outcome,
  onClick,
}: {
  readonly label: string;
  /*
  The quietest answer is `toned` rather than `outline`, because this card
  carries its own colour. A grey hairline and grey text on a tinted ground are
  the one thing the palette forbids, and they looked it: on the warning ground
  the tertiary read as disabled text rather than as the third answer. `toned`
  takes both steps from the ground's own ramp through `currentColor`.
  */
  readonly variant: "default" | "secondary" | "toned";
  readonly help: string;
  /** How the mark beside this control names the outcome it explains. */
  readonly outcome: string;
  readonly onClick: () => void;
}) => (
  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
    <Button variant={variant} size="sm" className="w-full" onClick={onClick}>
      {label}
    </Button>
    <ConsequenceHelp text={help} outcome={outcome} />
  </div>
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

/**
 * The card's top line: who this is, and what it currently is.
 *
 * The badge is pinned to the corner and the name takes the rest, so a long
 * model name wraps under itself rather than pushing the role off the card.
 */
const AgentCardHeader = ({
  agent,
  badge,
}: {
  readonly agent: RosterAgent;
  readonly badge: ReactNode;
}) => (
  <div className="flex min-w-0 items-start gap-2">
    <div className="min-w-0 flex-1">
      <AgentIdentity agent={agent} />
    </div>
    {badge}
  </div>
);

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
    className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-[var(--callout-warning-c)] bg-[var(--callout-warning-bg)] p-3"
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 pt-0.5">
        <AnswerRow
          label="Make it primary"
          variant="default"
          outcome="this agent becomes the primary"
          help={
            primary === undefined
              ? `${agentModelLabel(agent)} answers your comments from now on.`
              : `${agentModelLabel(agent)} answers your comments from now on, and ${agentModelLabel(primary)} becomes the observer.`
          }
          onClick={() =>
            onAnswer({ writerId: agent.writerId, answer: "primary" })
          }
        />
        <AnswerRow
          label="Leave as observer"
          variant="secondary"
          outcome="this agent stays an observer"
          help="It keeps reading this review and cannot answer you."
          onClick={() =>
            onAnswer({ writerId: agent.writerId, answer: "observer" })
          }
        />
        <AnswerRow
          label="Disconnect this agent"
          variant="toned"
          outcome="this agent is disconnected"
          help="It is dropped from this review and told at its next command."
          onClick={() =>
            onAnswer({ writerId: agent.writerId, answer: "disconnect" })
          }
        />
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
    className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 rounded-lg border border-edge bg-raised p-3"
    data-review-agent-card={isPrimary ? "primary" : "observer"}
  >
    <AgentCardHeader
      agent={agent}
      badge={<AgentRoleBadge isPrimary={isPrimary} />}
    />
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
            variant="secondary"
            size="sm"
            onClick={() =>
              onAnswer({ writerId: agent.writerId, answer: "primary" })
            }
          >
            Make it primary
          </Button>
        )}
        {/* Bordered, because on its own it is the only control on the card and
            a borderless one read as a line of text the reviewer could not tell
            was clickable. Its rank comes from the ground it does not have, not
            from the edge it does. */}
        <Button
          variant="outline"
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

/** What the rail has to draw about the agents attached to this review. */
export type AgentRosterReading = {
  /** Every attached agent, in the order the rail lists them. */
  readonly attached: ReadonlyArray<RosterAgent>;
  /** The agents this section draws a card for, in order. */
  readonly cards: ReadonlyArray<RosterAgent>;
  /** The agent the activity card is drawing instead, when it is drawing one. */
  readonly carried: string | undefined;
  readonly primary: RosterAgent | undefined;
  readonly requesting: RosterAgent | undefined;
  /**
   * Whether the reviewer is shown anything at all.
   *
   * Nothing, when one agent is attached and answering and nothing is being
   * asked: that is the quiet steady state, where the activity card already
   * says who is connected and a second card repeating it is the noise this
   * surface exists to avoid.
   *
   * The plan having nobody to answer it is the case that must never be quiet.
   * The reviewer's own decisions can leave it that way - disconnecting the
   * primary leaves the seat empty on purpose, and nothing succeeds into a seat
   * they emptied - so the cards that let them appoint somebody have to be on
   * screen for exactly as long as there is nobody. Hidden, a review with one
   * watching agent and no primary was a dead end: their comments queued, the
   * agent read them and could not answer, and the only way out was connecting
   * a new one.
   */
  readonly isShown: boolean;
};

/**
 * Reads the roster the way the rail draws it.
 *
 * Membership is applied here, and applied once. Reaping happens on a roster
 * write, so a review whose agents have all exited is never swept while the
 * reviewer sits reading; drawing the raw list put cards on screen for
 * processes that were gone - offering "Make it primary" on a dead agent, and
 * answering it - and once the last live primary aged out the dead one's card
 * silently relabelled itself an observer.
 */
export const readAgentRosterFor = ({
  agents,
  nowMs,
  carriedByActivity,
}: {
  readonly agents: ReadonlyArray<RosterAgent>;
  readonly nowMs: number;
  /** The agent the activity card is drawing, when it is drawing one. */
  readonly carriedByActivity?: string;
}): AgentRosterReading => {
  const primary = selectPrimaryAgent({ agents, nowMs });
  const requesting = pendingPrimacyRequest({ agents, nowMs });
  const attached = orderAttachedAgents(agents).filter((agent) =>
    agentIsAttached({ agent, nowMs }),
  );
  /*
  The activity card carries the primary, and only ever the primary.

  It is checked rather than assumed, because the two surfaces answer from
  different records: the card draws the review's presence heartbeat and this
  section draws the roster. When they name the same agent, one card is enough
  and drawing it twice is the duplication the reviewer objected to. When they
  do not - for the moment after a hand-off, before the incoming primary's first
  heartbeat lands - this section draws everybody, which is a card too many for
  one poll rather than a card that lies for as long as it is on screen.
  */
  const carried =
    carriedByActivity !== undefined && primary?.writerId === carriedByActivity
      ? carriedByActivity
      : undefined;
  const cards = attached.filter(
    (agent) =>
      agent.writerId !== carried && agent.writerId !== requesting?.writerId,
  );
  return {
    attached,
    cards,
    carried,
    primary,
    requesting,
    isShown:
      requesting !== undefined ||
      cards.length > 0 ||
      (attached.length > 0 && primary === undefined),
  };
};

/** The rail's agent roster. */
export const AgentRoster = ({
  agents,
  nowMs,
  isReadOnly,
  carriedByActivity,
  onAnswer,
}: AgentRosterProps) => {
  const { cards, primary, requesting, isShown } = readAgentRosterFor({
    agents,
    nowMs,
    ...(carriedByActivity === undefined ? {} : { carriedByActivity }),
  });
  if (!isShown) return null;
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2"
      data-review-agent-roster=""
    >
      {requesting === undefined ? null : (
        <PrimacyRequestCard
          agent={requesting}
          primary={primary}
          nowMs={nowMs}
          isReadOnly={isReadOnly}
          onAnswer={onAnswer}
        />
      )}
      {cards.map((agent) => (
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
 * toggle sits below them in a box of its own. Level with the bullets it read
 * as a fourth consequence with a stray checkbox in front of it, which is the
 * one thing it is not: the three above are what this answer does, and this is
 * the single part of it the reviewer still gets to choose.
 *
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        <p className="m-0 text-2xs font-semibold tracking-caps text-muted uppercase">
          What happens
        </p>
        <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-disc gap-1 pl-4 text-xs text-ink marker:text-muted">
          <li>
            {agentModelLabel(agent)} answers the open comment and every comment
            after it.
          </li>
          {primary === undefined ? null : (
            <li>{agentModelLabel(primary)} becomes the observer.</li>
          )}
          <li>No submitted comments are lost.</li>
        </ul>
      </div>
      {primary === undefined ? null : (
        /* Its own ground and its own edge, because it is a control rather than
           another statement of fact, and the reviewer has to be able to see
           that this one line is the part they decide. */
        <label className="flex items-start gap-2 rounded-md border border-edge bg-surface p-2 text-xs text-ink">
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
            <span className="mt-0.5 block text-2xs text-muted">
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
