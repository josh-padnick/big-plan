// Renders the compact numbered question list a plan poses to its reviewer,
// with decorative option markers awaiting the live review application.
// Every id comes from the compiled model for stable anchors and hydration.

import type {
  CompiledSmallDecision,
  CompiledSmallDecisionOption,
  CompiledSmallDecisionSet,
} from "./compile.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { BadgePill } from "../_shared/badge-pill/badge-pill.js";

// One option row: title and optional Recommended tag on the first line, the
// short detail in muted prose directly beneath, no card chrome. The marker is
// decorative: the future live layer turns it into a control, but the static
// reader answers through comments or chat.
const OptionRow = ({
  option,
}: {
  readonly option: CompiledSmallDecisionOption;
}) => (
  <li
    id={option.id}
    className="flex min-w-0 items-start gap-2.5"
    data-option=""
    {...(option.recommended ? { "data-option-recommended": "" } : {})}
  >
    <span
      className="small-decision-option-marker mt-0.5 inline-flex size-4 shrink-0 rounded-full border"
      data-option-control=""
      aria-hidden="true"
    />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          id={option.titleId}
          className="text-sm font-semibold text-ink"
          data-option-title=""
        >
          {option.title}
        </span>
        {option.recommended ? (
          <BadgePill
            label="Recommended"
            classNames={["small-decision-recommended-pill"]}
          />
        ) : null}
      </div>
      {option.detail.length === 0 ? null : (
        <div
          id={option.detailId}
          className="mt-0.5 text-sm text-muted [&>:last-child]:mb-0"
          data-option-description=""
        >
          {hastContentToReact(option.detail)}
        </div>
      )}
    </div>
  </li>
);

// One numbered question block: the number anchors scanning down the list the
// way plans previously numbered their open questions in prose.
const DecisionBlock = ({
  decision,
  index,
}: {
  readonly decision: CompiledSmallDecision;
  readonly index: number;
}) => (
  <li id={decision.id} className="px-4 py-3.5" data-small-decision="">
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="small-decision-number shrink-0 text-sm font-semibold tabular-nums">
        {`${index + 1}.`}
      </span>
      <p
        className="m-0 text-sm font-semibold text-ink"
        data-decision-question=""
      >
        {decision.question}
      </p>
    </div>
    {decision.context.length === 0 ? null : (
      <div className="mt-1.5 pl-6 text-sm text-muted [&>:last-child]:mb-0">
        {hastContentToReact(decision.context)}
      </div>
    )}
    <ul
      className="mt-2.5 mb-0 grid list-none gap-2 p-0 pl-6"
      data-decision-options=""
    >
      {decision.options.map((option) => (
        <OptionRow key={option.id} option={option} />
      ))}
    </ul>
  </li>
);

export const SmallDecisionSet = ({
  model,
}: {
  readonly model: CompiledSmallDecisionSet;
}) => (
  <figure
    id={model.id}
    className="small-decision-set mb-5 min-w-0 overflow-hidden rounded-md border border-edge bg-paper"
    data-small-decision-set=""
  >
    <figcaption className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge bg-header px-4 py-3">
      {model.title === undefined ? null : (
        <span className="font-semibold text-ink">{model.title}</span>
      )}
      <span className="small-decision-set-summary text-xs font-semibold text-muted">
        {`${model.decisions.length} question${
          model.decisions.length === 1 ? "" : "s"
        }`}
      </span>
    </figcaption>
    {model.intro.length === 0 ? null : (
      <div className="border-b border-edge px-4 py-3.5 text-sm [&>:last-child]:mb-0">
        {hastContentToReact(model.intro)}
      </div>
    )}
    <ol className="small-decision-list m-0 list-none p-0">
      {model.decisions.map((decision, index) => (
        <DecisionBlock key={decision.id} decision={decision} index={index} />
      ))}
    </ol>
  </figure>
);
