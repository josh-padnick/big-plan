// Owns Comments-tab lifecycle order, density, empty states, and bulk actions.
// Individual thread cards remain reusable across the sidebar and inline
// document surfaces; this module decides how much attention each lifecycle
// needs.

import type { ReactNode } from "react";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { HOURGLASS_ICON } from "../../icons/lucide/hourglass.js";
import { SEARCH_ICON } from "../../icons/lucide/search.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import type { AgentStatus, AgentStatusStage } from "../shared/agent-status.js";
import type { ReviewComment } from "../shared/comment.js";
import type { ThreadGroup } from "../shared/thread-projection.js";
import { Icon } from "./icon.browser.js";
import { Badge, Button, WorkingMark } from "./ui.browser.js";

/** The stages that say an agent has this batch in hand. */
const PICKED_UP_STAGES: ReadonlySet<AgentStatusStage> = new Set([
  "working",
  "stalled",
]);

/**
 * The treatment a feedback batch's header wears.
 *
 * Only the batch's own status decides, because the header speaks for that batch
 * alone. The sidebar's working group answers a different question - whether
 * anything on this plan is being worked - so consulting it dressed a batch
 * nobody had picked up in the spinner whenever an earlier batch was running,
 * putting the working treatment beside the batch's own queued label (BIG-158).
 *
 * A batch nothing has picked up is queued, and a danger reading drops out of
 * the picked-up treatment. A warning reading is the ordinary long turn this
 * product expects - demoting that would swap the spinner for an hourglass on
 * every quiet stretch and back on every progress note, relabelling started work
 * as waiting in line through a treatment instead of a string (BIG-147).
 */
export const batchSectionTone = ({
  status,
}: {
  readonly status: AgentStatus;
}): "working" | "queued" =>
  status.tone === "danger" || !PICKED_UP_STAGES.has(status.stage)
    ? "queued"
    : "working";

type LifecycleSectionProps = {
  readonly label: string;
  readonly count: number;
  readonly tone: "ready" | "working" | "queued" | "staged";
  readonly first: boolean;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  /** The batch this section speaks for, when it heads one. */
  readonly batchId?: string;
  /**
   * Whether the section holds its threads on its own ground. Batch groups stack
   * directly on one another, so a rule between them would leave every header
   * looking equally close to the threads above and below it; a filled, inset
   * panel says which threads a header owns. A lone section keeps the quieter
   * rule, which is the sidebar's resting look.
   */
  readonly contained?: boolean;
};

const LifecycleSection = ({
  label,
  count,
  tone,
  first,
  children,
  action,
  batchId,
  contained = false,
}: LifecycleSectionProps) => (
  <section
    className={`min-w-0 ${contained ? "rounded-lg bg-surface p-3" : first ? "" : "border-t border-edge pt-4"} ${tone === "working" ? "text-[var(--callout-note-c)]" : tone === "ready" ? "text-accent" : "text-muted"}`}
    data-review-thread-group={tone}
    {...(batchId === undefined ? {} : { "data-review-batch": batchId })}
  >
    <h3 className="m-0 mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-caps">
      {tone === "working" ? (
        <WorkingMark
          // The heading's working treatment, addressable without naming a
          // presentation class. It is decoration to a reader, so it carries no
          // role or name a journey could assert instead.
          data-review-working-indicator=""
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

/** One feedback batch, headed by what that batch alone is doing. */
export type CommentsSurfaceBatch = {
  /** Gives one batch's group a stable address for scoping and testing. */
  readonly requestId: string;
  /**
   * How many of this batch's comments the sidebar is showing, which is not
   * always the length of the list below. Grouped batches head exactly the
   * threads counted here. A lone batch instead heads the sidebar's working
   * group, which holds its threads once an agent picks the batch up and
   * nothing while the batch is still waiting in the queued group.
   */
  readonly count: number;
  readonly content: ReactNode;
  // A batch the agent has not picked up yet is still waiting, so the section
  // it heads says so rather than claiming work is underway.
  readonly label: string;
  readonly tone: "working" | "queued";
  /** The threads this batch's header owns. */
  readonly comments: ReadonlyArray<ReviewComment>;
};

export type CommentsSurfaceModel = {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly sentCount: number;
  readonly hasRuntime: boolean;
  // Notes still batched inside a component (a commented diagram element, for
  // example) that the reviewer must hand to this review from the component.
  readonly hasComponentBatchNotes: boolean;
  readonly groups: ReadonlyMap<ThreadGroup, ReadonlyArray<ReviewComment>>;
  readonly batches: ReadonlyArray<CommentsSurfaceBatch>;
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
  // A thread a batch header owns is shown there and nowhere else, so no
  // lifecycle section repeats it under a header that speaks for other work.
  const headed = new Set(
    model.batches.flatMap((batch) =>
      batch.comments.map((comment) => comment.id),
    ),
  );
  const unheaded = (group: ThreadGroup): ReadonlyArray<ReviewComment> =>
    (model.groups.get(group) ?? []).filter(
      (comment) => !headed.has(comment.id),
    );
  const working = unheaded("working");
  const queued = unheaded("queued");
  // Only stacked batches need containment; one batch has nothing to be told
  // apart from, so the sidebar keeps the layout it has always had.
  const grouped = model.batches.length > 1;
  const sectionCount = [
    ready.length,
    ...model.batches.map((batch) => batch.count),
    working.length,
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
        <label className="mb-4 flex items-center gap-2 rounded-md border border-edge-strong bg-well px-2 py-1.5 text-muted inset-shadow-well focus-within:border-accent focus-within:text-ink">
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
      {model.hasComponentBatchNotes ? (
        <p
          className="m-0 mb-4 rounded-md bg-surface p-2 text-xs text-muted"
          data-review-component-batch-note=""
        >
          Comments on a diagram wait in that diagram&apos;s batch. Add them to
          this review from the diagram&apos;s toolbar.
        </p>
      ) : null}
      {sectionCount === 0 ? null : (
        <div className="grid min-w-0 gap-4 border-t border-edge pt-4">
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

          {model.batches.map((batch) => (
            <LifecycleSection
              key={batch.requestId}
              label={batch.label}
              count={batch.count}
              tone={batch.tone}
              first={first()}
              batchId={batch.requestId}
              contained={grouped}
            >
              {batch.content}
              <ol className="mt-2 grid list-none gap-2 p-0 [&>li>*]:m-0 [&>li>*]:w-full [&>li>*]:max-w-none">
                {batch.comments.map((comment) => (
                  <li key={comment.id}>
                    {model.renderSent(comment, false, true)}
                  </li>
                ))}
              </ol>
            </LifecycleSection>
          ))}

          {working.length === 0 ? null : (
            <LifecycleSection
              label="Working"
              count={working.length}
              tone="working"
              first={first()}
            >
              {working.map((comment) =>
                model.renderSent(comment, false, false),
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
            <details
              className={`min-w-0 ${first() ? "" : "border-t border-edge pt-4"}`}
            >
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
