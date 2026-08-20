// Owns the agent sidebar's browser presentation. Runtime polling and navigation
// stay in the review controller.
//
// The surface carries no heading and no mark of its own: the toolbar control
// that opened it is still on screen, still named, and still showing the state.

import {
  agentActivityIsAttached,
  type AgentHealth,
  type CurrentAgentActivity,
} from "../shared/agent-status.js";
import type {
  BrowserConnectionEvent,
  RuntimeSession,
} from "../shared/review-wire.js";
import { AgentConnectionPanel } from "./agent-connection.browser.js";
import {
  AgentRoster,
  readAgentRosterFor,
  type AgentRosterProps,
} from "./agent-roster.browser.js";
import type { ReviewAgentProjection } from "./review-poll-health.js";

export type AgentSurfaceModel = {
  readonly activity: CurrentAgentActivity;
  readonly status: AgentHealth;
  readonly presenceState: ReviewAgentProjection["state"];
  readonly modelEffort?: string;
  readonly modelClient?: string;
  readonly sessionUrl?: string;
  readonly sessionId?: string;
  readonly modelName?: string;
  /** Which agent the presence record the status card is drawn from is about. */
  readonly presenceWriterId?: string;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  readonly recoveryPrompt: string;
  readonly runtimeSession: RuntimeSession | null;
  /** When the reviewer disconnected the attached agent, if they already have. */
  readonly disconnectRequestedAtMs?: number;
  /** Whether a disconnect the reviewer confirmed has not been answered yet. */
  readonly isDisconnectingAgent: boolean;
  readonly onViewRequest: (requestId: string, kind: string) => void;
  readonly onDisconnect: () => void;
  /** Every agent attached to this review, and how to answer about them. */
  readonly agents: AgentRosterProps["agents"];
  readonly nowMs: number;
  readonly onAnswerPrimacy: AgentRosterProps["onAnswer"];
};

export const AgentSurface = ({
  model,
}: {
  readonly model: AgentSurfaceModel;
}) => {
  const isReadOnly = model.runtimeSession?.authoritative === false;
  /*
  Which agent the status card at the top of the rail is drawing.

  It is a real question rather than an assumption, and it has to be asked in
  one place because two things downstream depend on the same answer: the badge
  the card wears, and the card the roster below then leaves out. The status
  card draws the review's presence record, the roster draws the roster, and
  they can name different agents for a poll after a hand-off - so the answer is
  "this writer, if the card is really showing it", and `undefined` otherwise.
  */
  const drawnByStatusCard =
    !isReadOnly &&
    model.presenceState !== "loading" &&
    model.presenceState !== "unobservable" &&
    agentActivityIsAttached(model.activity)
      ? model.presenceWriterId
      : undefined;
  const roster = readAgentRosterFor({
    agents: model.agents,
    nowMs: model.nowMs,
    ...(drawnByStatusCard === undefined
      ? {}
      : { carriedByActivity: drawnByStatusCard }),
  });
  return (
    <div
      id="review-panel-agent"
      className="review-feedback-panel grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-x-hidden overflow-y-auto p-3"
      tabIndex={-1}
    >
      <AgentConnectionPanel
        activity={model.activity}
        status={model.status}
        presenceState={model.presenceState}
        modelName={model.modelName}
        modelEffort={model.modelEffort}
        modelClient={model.modelClient}
        sessionUrl={model.sessionUrl}
        sessionId={model.sessionId}
        connectionLog={model.connectionLog}
        recoveryPrompt={model.recoveryPrompt}
        replacementUrl={
          isReadOnly && model.runtimeSession?.authoritative === false
            ? (model.runtimeSession.latestReviewUrl ?? null)
            : null
        }
        isReadOnly={isReadOnly}
        /* The role is named only when there is another agent to tell this one
           apart from, which is exactly when the roster below has a card to
           draw. One agent answering alone needs no badge to say so. */
        isActivityPrimary={roster.carried !== undefined && roster.isShown}
        hasAttachedAgent={roster.attached.length > 0}
        roster={
          roster.isShown ? (
            <AgentRoster
              agents={model.agents}
              nowMs={model.nowMs}
              isReadOnly={isReadOnly}
              {...(drawnByStatusCard === undefined
                ? {}
                : { carriedByActivity: drawnByStatusCard })}
              onAnswer={model.onAnswerPrimacy}
            />
          ) : undefined
        }
        {...(model.disconnectRequestedAtMs === undefined
          ? {}
          : { disconnectRequestedAtMs: model.disconnectRequestedAtMs })}
        isDisconnectingAgent={model.isDisconnectingAgent}
        onViewRequest={model.onViewRequest}
        onDisconnect={model.onDisconnect}
      />
    </div>
  );
};
