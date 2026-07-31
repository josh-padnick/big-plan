// Renders a compiled Decision as a comparison matrix over one stable
// rationale panel: options are columns, criteria are rows, and the panel
// beneath explains whichever option the reader is looking at. Comparison
// comes first and explanation second, and choosing never moves the page -
// every rationale panel occupies the same grid cell, so the panel is as tall
// as the tallest one and swapping the visible panel shifts nothing.
//
// Selection is a native radio group, so choosing an option and the selected
// column header survive with the viewer script disabled; without the script
// every rationale panel simply stays stacked and readable.

import type {
  CompiledDecision,
  CompiledDecisionConsideration,
  CompiledDecisionOption,
  DecisionStatus,
  DecisionTone,
} from "./compile.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import {
  ComparisonMatrix,
  MATRIX_TONE_ICONS,
  matrixToneClass,
  type MatrixTone,
} from "../_shared/comparison-matrix/comparison-matrix.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import { BadgePill } from "../_shared/badge-pill/badge-pill.js";
import { SectionLabel } from "../_shared/labeled-section/labeled-section.js";

// Decision's tones are the shared matrix vocabulary; the alias fails the
// build if the two ever diverge.
const _TONE_PARITY: DecisionTone = "good" satisfies MatrixTone;

const TONE_WORDS = {
  good: "Favourable",
  bad: "Unfavourable",
  mixed: "Mixed",
  neutral: "Neutral",
} satisfies Record<DecisionTone, string>;

const STATUS_LABELS = {
  open: "Open",
  decided: "Decided",
  deferred: "Deferred",
} satisfies Record<DecisionStatus, string>;

// The reader is only invited to answer while the question is genuinely open;
// a settled or deferred decision renders as a record, not as a control.
const isAnswerable = (status: DecisionStatus): boolean => status === "open";

// The panel a reader meets before choosing anything. Explaining the agent's
// own pick is the most useful default, and it commits the reader to nothing -
// every radio stays unchecked until they choose.
const defaultPanelIndex = (model: CompiledDecision): number => {
  const recommended = model.options.findIndex((option) => option.recommended);
  return recommended === -1 ? 0 : recommended;
};

// One column header. The whole cell is the click target for its option, so
// choosing never means hitting a 16px circle.
const ColumnHeader = ({
  option,
  index,
  groupName,
  answerable,
}: {
  readonly option: CompiledDecisionOption;
  readonly index: number;
  readonly groupName: string;
  readonly answerable: boolean;
}) => (
  <th
    className="decision-column p-0 align-bottom"
    scope="col"
    data-decision-column={index}
    {...(option.recommended ? { "data-option-recommended": "" } : {})}
    {...(option.chosen ? { "data-option-chosen": "" } : {})}
  >
    <label
      className="decision-column-head flex h-full cursor-pointer flex-col items-start gap-2 px-4 py-3.5"
      htmlFor={option.id}
    >
      <span className="flex items-start gap-2">
        <input
          className="decision-radio mt-0.5 size-5 shrink-0 appearance-none rounded-full border"
          type="radio"
          id={option.id}
          name={groupName}
          value={option.title}
          data-decision-choice=""
          data-option-index={index}
          {...(option.chosen ? { defaultChecked: true } : {})}
          {...(answerable ? {} : { disabled: true })}
        />
        <span
          id={option.titleId}
          className="text-base leading-6 font-semibold text-ink"
          data-option-title=""
        >
          {option.title}
        </span>
      </span>
      {option.recommended ? (
        <BadgePill label="Recommended" classNames={["badge-pill-quiet"]} />
      ) : null}
    </label>
  </th>
);

const VerdictCell = ({
  consideration,
  index,
}: {
  readonly consideration: CompiledDecisionConsideration;
  readonly index: number;
}) => (
  <td
    className="decision-cell px-4 py-3"
    data-decision-column={index}
    data-verdict-tone={consideration.tone}
  >
    <span
      className={`decision-verdict ${matrixToneClass(consideration.tone)} flex items-start gap-2 text-base leading-6 font-semibold [&>svg]:mt-[calc((1.5rem-1rem)/2)] [&>svg]:size-4 [&>svg]:shrink-0`}
    >
      {lucideIconToReact({
        icon: MATRIX_TONE_ICONS[consideration.tone],
        hidden: false,
      })}
      <span className="min-w-0">{consideration.verdict}</span>
      <span className="sr-only">{` (${TONE_WORDS[consideration.tone]})`}</span>
    </span>
  </td>
);

// The comparison itself: one look that answers "how do these differ" before
// the reader has read a sentence of reasoning.
const Matrix = ({
  model,
  answerable,
}: {
  readonly model: CompiledDecision;
  readonly answerable: boolean;
}) => {
  const criteria = model.options[0]?.considerations ?? [];
  return (
    <ComparisonMatrix className="decision-matrix">
      <thead>
        <tr>
          <th className="decision-corner px-4 py-3.5 text-left" scope="col">
            <span className="sr-only">{"Criterion"}</span>
          </th>
          {model.options.map((option, index) => (
            <ColumnHeader
              key={option.id}
              option={option}
              index={index}
              groupName={model.id}
              answerable={answerable}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {criteria.map((criterion, row) => (
          <tr key={row} className="comparison-matrix-row">
            <th
              className="decision-criterion px-4 py-3 text-left text-base leading-6 font-medium text-muted"
              scope="row"
            >
              {criterion.title}
            </th>
            {model.options.map((option, index) => {
              const consideration = option.considerations[row];
              return consideration === undefined ? (
                <td
                  key={option.id}
                  className="decision-cell px-4 py-3"
                  data-decision-column={index}
                >
                  {"-"}
                </td>
              ) : (
                <VerdictCell
                  key={option.id}
                  consideration={consideration}
                  index={index}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </ComparisonMatrix>
  );
};

// One option's reasoning, in criterion order, so it reads as an annotated
// walk back across that option's column.
const RationalePanel = ({
  option,
  index,
  isDefault,
}: {
  readonly option: CompiledDecisionOption;
  readonly index: number;
  readonly isDefault: boolean;
}) => {
  const explained = option.considerations.filter(
    (consideration) => consideration.detail.length > 0,
  );
  return (
    <div
      className="decision-rationale-panel"
      data-rationale-panel=""
      data-option-index={index}
      {...(isDefault ? { "data-rationale-default": "" } : {})}
    >
      <p className="m-0 text-base font-semibold text-ink">{option.title}</p>
      {option.summary === undefined ? null : (
        <p className="mt-1 mb-0 text-base text-muted">{option.summary}</p>
      )}
      {explained.length === 0 ? null : (
        <dl className="mt-2.5 mb-0 grid gap-2">
          {explained.map((consideration, row) => (
            <div key={row}>
              <dt className="text-sm font-semibold text-ink">
                {`${consideration.title}: ${consideration.verdict}`}
              </dt>
              <dd className="m-0 text-base text-muted [&>:last-child]:mb-0">
                {hastContentToReact(consideration.detail)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {option.detail.length === 0 ? null : (
        <div className="mt-2.5 text-sm text-muted [&>:last-child]:mb-0">
          {hastContentToReact(option.detail)}
        </div>
      )}
    </div>
  );
};

// The escape hatch, demoted to a quiet link so it never competes with the
// real options. Its radio still belongs to the group, so proposing clears
// whichever column was picked.
const ProposeLink = ({ model }: { readonly model: CompiledDecision }) => {
  const inputId = `${model.id}-proposal-choice`;
  const textId = `${model.id}-proposal-text`;
  return (
    <div className="decision-propose mt-4" data-option-proposal="">
      <label className="decision-propose-link" htmlFor={inputId}>
        <input
          className="sr-only"
          type="radio"
          id={inputId}
          name={model.id}
          value="Propose another approach"
          data-decision-choice=""
          data-decision-proposal-choice=""
        />
        <span>{"Propose another approach"}</span>
      </label>
      <div
        className="decision-proposal mt-2.5"
        data-decision-proposal=""
        hidden
      >
        <label className="sr-only" htmlFor={textId}>
          {"Proposed approach"}
        </label>
        <textarea
          className="decision-proposal-input block w-full"
          id={textId}
          rows={3}
          placeholder="Describe the behavior you want, and the constraint that rules the options out."
          data-decision-proposal-text=""
        />
        <p className="mt-1.5 mb-0 text-xs text-muted">
          {"The agent revises the plan to answer a proposal."}
        </p>
      </div>
    </div>
  );
};

// The confirm row sits directly under the rationale panel rather than at the
// end of the document, so the action is never screens away from the choice.
// The whole card is about one screen now, which is why this is close rather
// than sticky: pinning it would add chrome without shortening the reach.
const AnswerControls = () => (
  <>
    <div
      className="decision-footer flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-edge px-5 py-4"
      data-decision-footer=""
    >
      <p
        className="m-0 mr-auto text-sm text-muted"
        data-decision-selection-summary=""
      >
        {"Nothing selected yet."}
      </p>
      <button
        className="decision-confirm"
        type="button"
        data-decision-confirm=""
        disabled
      >
        {"Confirm choice"}
      </button>
    </div>
    <div
      className="decision-answer gap-3 border-t border-edge px-5 py-4"
      data-decision-answer=""
      role="status"
      hidden
    >
      <span
        className="decision-answer-mark mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full [&_svg]:size-3"
        aria-hidden="true"
      >
        {lucideIconToReact({ icon: CHECK_ICON, hidden: false })}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-base font-semibold text-ink">
          <span data-decision-answer-lead="">{"Answer recorded"}</span>
          <span className="sr-only" data-decision-answer-title="" />
        </p>
        <p className="m-0 mt-0.5 text-xs text-muted">
          {
            "Noted for this reading session. Sending answers back to the agent arrives with review commenting."
          }
        </p>
      </div>
      <button
        className="decision-change shrink-0"
        type="button"
        data-decision-change=""
      >
        {"Change"}
      </button>
    </div>
  </>
);

export const Decision = ({ model }: { readonly model: CompiledDecision }) => {
  const answerable = isAnswerable(model.status);
  const defaultIndex = defaultPanelIndex(model);
  return (
    <figure
      id={model.id}
      className="decision mb-5 min-w-0 overflow-hidden rounded-md border border-edge bg-paper"
      data-decision=""
      data-decision-status={model.status}
      {...(answerable ? { "data-decision-selector": "" } : {})}
    >
      <figcaption className="decision-zone-question bg-header px-5 py-4">
        {answerable ? null : (
          <BadgePill
            label={STATUS_LABELS[model.status]}
            classNames={[
              "decision-status-pill",
              `decision-status-${model.status}`,
            ]}
          />
        )}
        <p
          id={model.questionId}
          className="mt-2 mb-0 text-lg leading-7 font-semibold text-ink first:mt-0"
          data-decision-question=""
        >
          {model.question}
        </p>
      </figcaption>
      {model.context.length === 0 ? null : (
        <div className="decision-zone-question bg-header px-5 pb-4 text-base [&>:last-child]:mb-0">
          {hastContentToReact(model.context)}
        </div>
      )}
      <fieldset className="decision-fieldset m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">{model.question}</legend>
        <div className="decision-zone-matrix flex flex-wrap items-baseline justify-between gap-x-3 border-t border-edge px-5 pt-4 pb-2.5">
          <SectionLabel
            label={answerable ? "Choose one" : "Options"}
            dataProperties={{ "data-decision-choose-label": "" }}
          />
          {/* Stated only where it is true: a scrolling hint for the reader
              whose viewport actually clips the matrix, not a note about the
              layout aimed at everyone. */}
          <p className="decision-scroll-note m-0 text-xs text-muted">
            {"Scroll sideways to compare every option."}
          </p>
        </div>
        <div className="decision-zone-matrix border-b border-edge pb-2">
          <Matrix model={model} answerable={answerable} />
        </div>
        <div className="decision-zone-rationale px-5 pt-4 pb-5">
          <SectionLabel label="Why this option" />
          <div
            className="decision-rationale mt-2"
            data-decision-rationale=""
            data-default-index={defaultIndex}
          >
            {model.options.map((option, index) => (
              <RationalePanel
                key={option.id}
                option={option}
                index={index}
                isDefault={index === defaultIndex}
              />
            ))}
          </div>
          {answerable ? <ProposeLink model={model} /> : null}
        </div>
      </fieldset>
      {answerable ? <AnswerControls /> : null}
    </figure>
  );
};
