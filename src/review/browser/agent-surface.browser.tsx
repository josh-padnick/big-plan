// Owns the agent sidebar's browser presentation. Runtime polling and navigation
// stay in the review controller.
//
// The surface carries no heading and no mark of its own: the toolbar control
// that opened it is still on screen, still named, and still showing the state.

import type {
  AgentHealth,
  CurrentAgentActivity,
  HeldWorkQuiet,
} from "../shared/agent-status.js";
import type {
  BrowserConnectionEvent,
  RuntimeSession,
} from "../shared/review-wire.js";
import { AgentConnectionPanel } from "./agent-connection.browser.js";
import type { ReviewAgentProjection } from "./review-poll-health.js";

export type AgentSurfaceModel = {
  readonly activity: CurrentAgentActivity;
  readonly status: AgentHealth;
  readonly presenceState: ReviewAgentProjection["state"];
  readonly modelEffort?: string;
  readonly modelClient?: string;
  readonly sessionUrl?: string;
  readonly sessionId?: string;
  /** What held work says about the quiet. Never an attachment claim. */
  readonly heldWork: HeldWorkQuiet;
  readonly modelName?: string;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  readonly recoveryPrompt: string;
  readonly runtimeSession: RuntimeSession | null;
  readonly onViewRequest: (requestId: string, kind: string) => void;
};

export const AgentSurface = ({
  model,
}: {
  readonly model: AgentSurfaceModel;
}) => (
  <div
    id="review-panel-agent"
    className="review-feedback-panel min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 grid content-start gap-3"
    tabIndex={-1}
  >
    <AgentConnectionPanel
      activity={model.activity}
      status={model.status}
      presenceState={model.presenceState}
      heldWork={model.heldWork}
      modelName={model.modelName}
      modelEffort={model.modelEffort}
      modelClient={model.modelClient}
      sessionUrl={model.sessionUrl}
      sessionId={model.sessionId}
      connectionLog={model.connectionLog}
      recoveryPrompt={model.recoveryPrompt}
      replacementUrl={
        model.runtimeSession?.authoritative === false
          ? (model.runtimeSession.latestReviewUrl ?? null)
          : null
      }
      isReadOnly={model.runtimeSession?.authoritative === false}
      onViewRequest={model.onViewRequest}
    />
  </div>
);
