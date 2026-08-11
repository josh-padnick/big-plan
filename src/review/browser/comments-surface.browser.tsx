// Owns Comments-tab grouping, empty states, and bulk actions. Individual
// thread cards remain reusable across the rail and inline document surfaces.

import type { ReactNode } from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { HOURGLASS_ICON } from "../../icons/lucide/hourglass.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import type { ReviewComment } from "../shared/comment.js";
import type { ThreadGroup } from "../shared/thread-projection.js";
import { Icon } from "./icon.browser.js";
import { Badge, Button } from "./ui.browser.js";

const GROUPS = [
  { key: "needs-input", label: "Respond", glyph: TRIANGLE_ALERT_ICON },
  { key: "ready", label: "Ready for review", glyph: CHECK_ICON },
  { key: "working", label: "Now working", glyph: null },
  { key: "queued", label: "Queued", glyph: HOURGLASS_ICON },
] as const;

export type CommentsSurfaceModel = {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly sentCount: number;
  readonly hasRuntime: boolean;
  readonly groups: ReadonlyMap<ThreadGroup, ReadonlyArray<ReviewComment>>;
  readonly resolved: ReadonlyArray<ReviewComment>;
  readonly canResolveAll: boolean;
  readonly renderDraft: (comment: ReviewComment) => ReactNode;
  readonly renderSent: (comment: ReviewComment, resolved: boolean) => ReactNode;
  readonly onResolveAll: () => void;
  readonly onDeleteAll: () => void;
};

export const CommentsSurface = ({
  model,
}: {
  readonly model: CommentsSurfaceModel;
}) => (
  <div
    id="review-panel-comments"
    className="review-feedback-panel min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3"
    role="tabpanel"
    aria-labelledby="review-tab-comments"
    tabIndex={0}
  >
    {model.drafts.length === 0 ? (
      <div className="border-b border-edge pb-4 text-sm text-muted [&_p]:m-0 [&_p+p]:mt-2">
        {model.sentCount > 0 ? (
          <p>
            {model.sentCount} comment{model.sentCount === 1 ? "" : "s"} sent to
            the agent
          </p>
        ) : null}
        <p>
          {model.hasRuntime
            ? "Select text to comment, or use a slide selector to select it all."
            : "Reading offline: drafts stay in this browser until you start the local review runtime."}
        </p>
      </div>
    ) : (
      <section>
        <div className="mb-2 flex items-center gap-2">
          <p className="m-0 text-xs font-bold uppercase tracking-caps text-subtle">
            Staged
          </p>
          <Badge tone="secondary" size="compact" className="ml-auto">
            {model.drafts.length}
          </Badge>
        </div>
        <ol className="m-0 grid list-none gap-2 p-0 [&>li>*]:m-0 [&>li>*]:w-full [&>li>*]:max-w-none">
          {model.drafts.map((comment) => (
            <li key={comment.id}>{model.renderDraft(comment)}</li>
          ))}
        </ol>
      </section>
    )}

    {model.sentCount > 0 ? (
      <div>
        <div className="mt-4 flex justify-end">
          {model.canResolveAll ? (
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-xs text-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={model.onResolveAll}
            >
              Resolve all
            </button>
          ) : null}
        </div>
        {GROUPS.map(({ key, label, glyph }) => {
          const comments = model.groups.get(key) ?? [];
          if (comments.length === 0) return null;
          return (
            <section
              key={key}
              className={`mt-4 border-t border-edge pt-4 ${key === "working" ? "text-[var(--callout-note-c)]" : key === "needs-input" ? "text-[var(--callout-warning-c)]" : key === "ready" ? "text-accent" : "text-muted"}`}
              data-review-thread-group={key}
            >
              <h3 className="m-0 mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-caps">
                {key === "working" ? (
                  <span
                    className="inline-block size-3 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : glyph === null ? null : (
                  <Icon icon={glyph} />
                )}
                {label}
                <Badge tone="secondary" size="compact" className="ml-auto">
                  {comments.length}
                </Badge>
              </h3>
              {comments.map((comment) => model.renderSent(comment, false))}
            </section>
          );
        })}
        {model.resolved.length === 0 ? null : (
          <details className="mt-4 border-t border-edge pt-4">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-caps text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              Resolved ({model.resolved.length})
            </summary>
            {model.resolved.map((comment) => model.renderSent(comment, true))}
          </details>
        )}
      </div>
    ) : null}

    {model.drafts.length > 0 ? (
      <div className="mt-3 flex justify-end">
        <Button
          variant="outline"
          size="compact"
          className="border-danger text-danger hover:border-danger hover:text-danger"
          onClick={model.onDeleteAll}
        >
          <Icon icon={TRASH_2_ICON} />
          Delete all comments
        </Button>
      </div>
    ) : null}
  </div>
);
