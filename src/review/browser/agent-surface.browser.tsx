// Owns the agent sidebar's browser presentation. Runtime polling and
// navigation stay in the review controller. The surface carries its own
// heading because it replaces the feedback sidebar's body rather than sitting
// inside its tablist.

import type {
  AgentHealth,
  CurrentAgentActivity,
} from "../shared/agent-status.js";
import type {
  BrowserConnectionEvent,
  RuntimeSession,
} from "../shared/review-wire.js";
import { AgentConnectionPanel } from "./agent-connection.browser.js";
import {
  AGENT_STATUS_LABEL,
  AgentStatusGlyph,
} from "./agent-status.browser.js";
import type { ReviewAgentProjection } from "./review-poll-health.js";

export type AgentSurfaceModel = {
  readonly activity: CurrentAgentActivity;
  readonly status: AgentHealth;
  readonly presenceState: ReviewAgentProjection["state"];
  readonly connected: boolean;
  readonly heartbeatAt: number;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  readonly recoveryPrompt: string;
  readonly agentCommand: string;
  readonly plan: string;
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
  >
    <h2
      id="review-agent-heading"
      className="m-0 flex min-w-0 items-center gap-1.5 text-sm font-bold text-ink [&>span>svg]:size-3.5"
      tabIndex={-1}
    >
      <AgentStatusGlyph indicator={model.status.indicator} />
      {AGENT_STATUS_LABEL}
    </h2>
    <AgentConnectionPanel
      activity={model.activity}
      status={model.status}
      presenceState={model.presenceState}
      connected={model.connected}
      heartbeatAt={model.heartbeatAt}
      connectionLog={model.connectionLog}
      recoveryPrompt={model.recoveryPrompt}
      agentCommand={
        model.agentCommand ||
        `node bin/big-plan.mjs agent '${model.plan || model.runtimeSession?.plan || "<plan.mdx>"}'`
      }
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
