// Owns Comments-tab lifecycle order, density, empty states, and bulk actions.
// Individual thread cards remain reusable across the rail and inline document
// surfaces; this module decides how much attention each lifecycle needs.

import type { ReactNode } from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { HOURGLASS_ICON } from "../../icons/lucide/hourglass.js";
import { SEARCH_ICON } from "../../icons/lucide/search.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import type { ReviewComment } from "../shared/comment.js";
import type { ThreadGroup } from "../shared/thread-projection.js";
import { Icon } from "./icon.browser.js";
import { Badge, Button } from "./ui.browser.js";

type LifecycleSectionProps = {
  readonly label: string;
  readonly count: number;
  readonly tone: "ready" | "working" | "queued" | "staged";
  readonly first: boolean;
  readonly children: ReactNode;
  readonly action?: ReactNode;
};

const LifecycleSection = ({
  label,
  count,
  tone,
  first,
  children,
  action,
}: LifecycleSectionProps) => (
  <section
    className={`min-w-0 ${first ? "" : "border-t border-edge pt-4"} ${tone === "working" ? "text-[var(--callout-note-c)]" : tone === "ready" ? "text-accent" : "text-muted"}`}
    data-review-thread-group={tone}
  >
    <h3 className="m-0 mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-caps">
      {tone === "working" ? (
        <span
          className="inline-block size-3 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : tone === "ready" ? (
        <Icon icon={CHECK_ICON} />
      ) : tone === "queued" ? (
        <Icon icon={HOURGLASS_ICON} />
      ) : null}
      {label}
      {action}
      <Badge tone="secondary" size="compact" className="ml-auto">
        {count}
      </Badge>
    </h3>
    {children}
  </section>
);

export type CommentsSurfaceModel = {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly sentCount: number;
  readonly hasRuntime: boolean;
  readonly groups: ReadonlyMap<ThreadGroup, ReadonlyArray<ReviewComment>>;
  readonly workingBatch?: {
    readonly count: number;
    readonly content: ReactNode;
  };
  readonly resolved: ReadonlyArray<ReviewComment>;
  readonly resolvedDrafts: ReadonlyArray<ReviewComment>;
  readonly canResolveAll: boolean;
  readonly renderDraft: (comment: ReviewComment, compact: boolean) => ReactNode;
  readonly renderResolvedDraft: (comment: ReviewComment) => ReactNode;
  readonly renderSent: (
    comment: ReviewComment,
    resolved: boolean,
    compact: boolean,
    queuePosition?: number,
  ) => ReactNode;
  readonly onResolveAll: () => void;
  readonly onDeleteAll: () => void;
};

export const CommentsSurface = ({
  model,
}: {
  readonly model: CommentsSurfaceModel;
}) => {
  const ready = [
    ...(model.groups.get("needs-input") ?? []),
    ...(model.groups.get("ready") ?? []),
  ];
  const working = model.groups.get("working") ?? [];
  const queued = model.groups.get("queued") ?? [];
  const sectionCount = [
    ready.length,
    model.workingBatch?.count ?? working.length,
    queued.length,
    model.drafts.length,
    model.resolved.length + model.resolvedDrafts.length,
  ].filter((count) => count > 0).length;
  let renderedSections = 0;
  const first = () => renderedSections++ === 0;

  return (
    <div
      id="review-panel-comments"
      className="review-feedback-panel min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3"
      role="tabpanel"
      aria-labelledby="review-tab-comments"
      tabIndex={0}
    >
      {model.query === "" &&
      model.sentCount === 0 &&
      model.drafts.length === 0 ? null : (
        <label className="mb-3 flex items-center gap-2 rounded-md border border-edge bg-surface px-2 py-1.5 text-muted focus-within:border-accent focus-within:text-ink">
          <Icon icon={SEARCH_ICON} />
          <span className="sr-only">Search comments</span>
          <input
            type="search"
            value={model.query}
            onChange={(event) => model.onQueryChange(event.target.value)}
            placeholder="Search comments"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-ink outline-none placeholder:text-muted"
          />
        </label>
      )}
      {model.query !== "" || model.drafts.length > 0 ? null : (
        <div className="pb-4 text-sm text-muted [&_p]:m-0 [&_p+p]:mt-2">
          {model.sentCount > 0 ? (
            <p>
              {model.sentCount} comment{model.sentCount === 1 ? "" : "s"} sent
              to the agent
            </p>
          ) : null}
          <p>
            {model.hasRuntime
              ? "Select text to comment, or use a slide selector to select it all."
              : "Reading offline: drafts stay in this browser until you start the local review runtime."}
          </p>
        </div>
      )}

      {sectionCount === 0 ? null : (
        <div className="grid min-w-0 gap-4">
          {ready.length === 0 ? null : (
            <LifecycleSection
              label="Ready for review"
              count={ready.length}
              tone="ready"
              first={first()}
              action={
                model.canResolveAll ? (
                  <button
                    type="button"
                    className="ml-2 cursor-pointer border-0 bg-transparent p-0 text-2xs font-medium normal-case tracking-normal text-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    onClick={model.onResolveAll}
                  >
                    Resolve all
                  </button>
                ) : undefined
              }
            >
              {ready.map((comment) => model.renderSent(comment, false, false))}
            </LifecycleSection>
          )}

          {(model.workingBatch?.count ?? working.length) === 0 ? null : (
            <LifecycleSection
              label="Working"
              count={model.workingBatch?.count ?? working.length}
              tone="working"
              first={first()}
            >
              {model.workingBatch?.content}
              {model.workingBatch === undefined ? (
                working.map((comment) =>
                  model.renderSent(comment, false, false),
                )
              ) : (
                <ol className="mt-2 grid list-none gap-2 p-0 [&>li>*]:m-0 [&>li>*]:w-full [&>li>*]:max-w-none">
                  {working.map((comment) => (
                    <li key={comment.id}>
                      {model.renderSent(comment, false, true)}
                    </li>
                  ))}
                </ol>
              )}
            </LifecycleSection>
          )}

          {queued.length === 0 ? null : (
            <LifecycleSection
              label="Queued"
              count={queued.length}
              tone="queued"
              first={first()}
            >
              <ol className="m-0 grid list-none gap-2 p-0 [&>li>*]:m-0 [&>li>*]:w-full [&>li>*]:max-w-none">
                {queued.map((comment, index) => (
                  <li key={comment.id}>
                    {model.renderSent(comment, false, true, index + 1)}
                  </li>
                ))}
              </ol>
            </LifecycleSection>
          )}

          {model.drafts.length === 0 ? null : (
            <LifecycleSection
              label="Staged"
              count={model.drafts.length}
              tone="staged"
              first={first()}
            >
              <ol className="m-0 grid list-none gap-2 p-0 [&>li>*]:m-0 [&>li>*]:w-full [&>li>*]:max-w-none">
                {model.drafts.map((comment) => (
                  <li key={comment.id}>{model.renderDraft(comment, true)}</li>
                ))}
              </ol>
            </LifecycleSection>
          )}

          {model.resolved.length === 0 &&
          model.resolvedDrafts.length === 0 ? null : (
            <details className={first() ? "" : "border-t border-edge pt-4"}>
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-caps text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Resolved ({model.resolved.length + model.resolvedDrafts.length})
              </summary>
              {model.resolvedDrafts.map((comment) =>
                model.renderResolvedDraft(comment),
              )}
              {model.resolved.map((comment) =>
                model.renderSent(comment, true, false),
              )}
            </details>
          )}
        </div>
      )}

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
      {model.query !== "" &&
      model.drafts.length === 0 &&
      model.sentCount === 0 ? (
        <p className="m-0 py-6 text-center text-xs text-muted">
          No comments match “{model.query}”.
        </p>
      ) : null}
    </div>
  );
};
