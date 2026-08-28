// Owns the plan-wide Chat tab's composition. The review controller supplies
// runtime state and request turns; this surface owns the empty, compose, and
// conversation presentation states.

import type { KeyboardEvent, ReactNode, RefObject } from "react";
import type { AgentStatus } from "../shared/agent-status.js";
import { AgentStatePill } from "./agent-message.browser.js";
import { ComposeImages } from "./compose-images.browser.js";
import {
  reviewWriteBlock,
  type ReviewWriteAvailability,
} from "./review-write-availability.js";
import { Badge, Button, Card } from "./ui.browser.js";

export type ChatSurfaceModel = {
  readonly hasRuntime: boolean;
  readonly identity: { readonly token: string } | null;
  /** Whether a question sent now could still reach the agent. */
  readonly writeAvailability: ReviewWriteAvailability;
  readonly status: AgentStatus;
  readonly body: string;
  readonly bodyLimit: number;
  readonly shortcutLabel: string;
  readonly isSending: boolean;
  readonly exchanges: ReactNode;
  readonly hasExchanges: boolean;
  /** The arrival entry for a push that landed while the reader was reading. */
  readonly arrivalEntry: ReactNode;
  readonly mode: "review" | "auto-accept";
  readonly modeSince?: string;
  readonly onSwitchToReview: () => void;
  readonly pushedThreads: ReactNode;
  readonly pushedThreadCount: number;
  readonly appliedThreads: ReactNode;
  readonly appliedThreadCount: number;
  readonly resolvedPushedThreads: ReactNode;
  readonly resolvedPushedThreadCount: number;
  /**
   * The Resolved disclosure, so the controller can reveal it at the moment a
   * reader asks to open a thread inside it. A push can land in a thread the
   * reviewer already resolved, and opening that thread while the disclosure
   * stays shut mounts a card nobody can see.
   */
  readonly resolvedThreadsRef: RefObject<HTMLDetailsElement | null>;
  readonly archivedExchanges: ReactNode;
  readonly archivedCount: number;
  readonly onBodyChange: (body: string) => void;
  readonly onSend: () => void;
  readonly onArchive: () => void;
};

export const ChatSurface = ({
  model,
}: {
  readonly model: ChatSurfaceModel;
}) => {
  // Asking is a write, so it is held back by the same answer every other
  // mutation path asks. The typed question stays in the box either way.
  const block = reviewWriteBlock(model.writeAvailability);
  const canSend =
    model.body.trim() !== "" && !model.isSending && block === undefined;
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (canSend && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      model.onSend();
    }
  };

  return (
    <div
      id="review-panel-chat"
      className="review-feedback-panel grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-x-hidden overflow-y-auto p-3"
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
            <ComposeImages
              identity={model.identity}
              writeAvailability={model.writeAvailability}
              id="review-agent-chat"
              label="Plan-wide chat"
              placeholder="Ask about the plan as a whole…"
              maxLength={model.bodyLimit}
              body={model.body}
              onBodyChange={model.onBodyChange}
              onKeyDown={handleKeyDown}
            />
            <div className="mt-2 flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                transition="nonColor"
                disabled={!canSend}
                data-tooltip={block?.cause ?? `Send · ${model.shortcutLabel}`}
                data-tooltip-delay="1s"
                onClick={model.onSend}
              >
                {model.isSending ? "Sending…" : "Send"}
              </Button>
              {block === undefined ? null : (
                <span className="text-2xs font-semibold text-danger">
                  {block.label}
                </span>
              )}
            </div>
          </div>
          {model.arrivalEntry}
          {model.mode === "auto-accept" ? (
            <section
              className="flex items-center gap-2 rounded-lg bg-surface p-3"
              aria-label="Review mode"
            >
              <Badge tone="statusAccent" size="status">
                Auto-accept · on since {model.modeSince ?? "just now"}
              </Badge>
              <Button
                variant="outline"
                size="micro"
                className="ml-auto"
                onClick={model.onSwitchToReview}
              >
                Switch back to review
              </Button>
            </section>
          ) : null}
          {model.pushedThreadCount === 0 ? null : (
            <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
              <h3 className="m-0 text-xs font-bold uppercase tracking-caps text-muted">
                Needs you ({model.pushedThreadCount})
              </h3>
              <ol className="m-0 grid min-w-0 grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
                {model.pushedThreads}
              </ol>
            </section>
          )}
          {model.appliedThreadCount === 0 ? null : (
            <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
              <h3 className="m-0 text-xs font-bold uppercase tracking-caps text-muted">
                Applied ({model.appliedThreadCount})
              </h3>
              <ol className="m-0 grid min-w-0 grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
                {model.appliedThreads}
              </ol>
            </section>
          )}
          {model.hasExchanges ? (
            <>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={model.onArchive}>
                  Archive
                </Button>
              </div>
              <ol className="m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-3 p-0">
                {model.exchanges}
              </ol>
            </>
          ) : model.pushedThreadCount +
              model.appliedThreadCount +
              model.resolvedPushedThreadCount ===
            0 ? (
            <p className="m-0 text-xs text-subtle">
              {model.archivedCount === 0
                ? "No plan-wide questions yet."
                : "No active plan-wide questions."}
            </p>
          ) : null}
          {model.archivedCount === 0 ? null : (
            <details className="group border-t border-edge pt-3">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-caps text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Archived ({model.archivedCount})
              </summary>
              <ol className="mt-3 mb-0 grid grid-cols-[minmax(0,1fr)] list-none gap-3 p-0">
                {model.archivedExchanges}
              </ol>
            </details>
          )}
          {model.resolvedPushedThreadCount === 0 ? null : (
            <details
              ref={model.resolvedThreadsRef}
              className="group border-t border-edge pt-3"
            >
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-caps text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Resolved ({model.resolvedPushedThreadCount})
              </summary>
              <ol className="mt-3 mb-0 grid min-w-0 grid-cols-[minmax(0,1fr)] list-none gap-2 p-0">
                {model.resolvedPushedThreads}
              </ol>
            </details>
          )}
        </>
      )}
    </div>
  );
};
