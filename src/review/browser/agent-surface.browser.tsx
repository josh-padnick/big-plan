// Owns the Agent tab's browser presentation. Runtime polling and navigation
// stay in the review controller.

import type {
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
  readonly presenceState: ReviewAgentProjection["state"];
  readonly connected: boolean;
  /** What held work says about the quiet. Never an attachment claim. */
  readonly heldWork: HeldWorkQuiet;
  readonly heartbeatAt: number;
  /** When the agent's own loop reported the session ending, if it did. */
  readonly endedAtMs?: number;
  readonly modelName?: string;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  readonly recoveryPrompt: string;
  readonly agentCommand: string;
  readonly plan: string;
  readonly runtimeSession: RuntimeSession | null;
  readonly attentionKey: number;
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
    role="tabpanel"
    aria-labelledby="review-tab-agent"
  >
    <AgentConnectionPanel
      activity={model.activity}
      presenceState={model.presenceState}
      connected={model.connected}
      heldWork={model.heldWork}
      heartbeatAt={model.heartbeatAt}
      endedAtMs={model.endedAtMs}
      modelName={model.modelName}
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
      attentionKey={model.attentionKey}
      onViewRequest={model.onViewRequest}
    />
  </div>
);
