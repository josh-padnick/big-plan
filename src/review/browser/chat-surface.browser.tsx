// Owns the plan-wide Chat tab's composition. The review controller supplies
// runtime state and request turns; this surface owns the empty, compose, and
// conversation presentation states.

import type { KeyboardEvent, ReactNode } from "react";
import type { AgentStatus } from "../shared/agent-status.js";
import { AgentStatePill } from "./agent-message.browser.js";
import { Button, Card, Textarea } from "./ui.browser.js";

export type ChatSurfaceModel = {
  readonly hasRuntime: boolean;
  readonly status: AgentStatus;
  readonly body: string;
  readonly bodyLimit: number;
  readonly shortcutLabel: string;
  readonly isSending: boolean;
  readonly exchanges: ReactNode;
  readonly hasExchanges: boolean;
  readonly onBodyChange: (body: string) => void;
  readonly onSend: () => void;
};

export const ChatSurface = ({
  model,
}: {
  readonly model: ChatSurfaceModel;
}) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      model.onSend();
    }
  };

  return (
    <div
      id="review-panel-chat"
      className="review-feedback-panel min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 grid content-start gap-3"
      role="tabpanel"
      aria-labelledby="review-tab-chat"
    >
      {!model.hasRuntime ? (
        <Card className="border border-edge bg-surface p-3 shadow-none">
          <p className="m-0 text-sm font-semibold text-ink">
            Plan-wide chat needs the local runtime
          </p>
          <p className="mt-1 mb-0 text-xs text-muted">
            Open this file with `big-plan review &lt;plan.mdx&gt;`. Browser
            drafts remain safe here.
          </p>
        </Card>
      ) : (
        <>
          <div className="-m-3 mb-0 border-b border-edge bg-well p-3">
            <div className="flex items-center gap-2">
              <label
                className="text-sm font-bold uppercase tracking-caps text-muted"
                htmlFor="review-agent-chat"
              >
                Plan-wide chat
              </label>
              <AgentStatePill status={model.status} />
            </div>
            <Textarea
              id="review-agent-chat"
              className="mt-2 min-h-20! bg-input!"
              value={model.body}
              maxLength={model.bodyLimit}
              placeholder="Ask about the plan as a whole…"
              onChange={(event) => model.onBodyChange(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="mt-2 flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={model.body.trim() === "" || model.isSending}
                data-tooltip={`Send · ${model.shortcutLabel}`}
                data-tooltip-delay="1s"
                onClick={model.onSend}
              >
                {model.isSending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
          {model.hasExchanges ? (
            <ol className="m-0 grid list-none gap-3 p-0">{model.exchanges}</ol>
          ) : (
            <p className="m-0 text-xs text-subtle">
              No plan-wide questions yet.
            </p>
          )}
        </>
      )}
    </div>
  );
};
