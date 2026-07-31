// Renders a compiled Decision as a radio-card selector: one question, a stack
// of option cards whose comparison attributes align into columns, and the
// reasoning tucked behind a per-option disclosure. Selection is a native radio
// group, so choosing, arrow-key movement, and the selected look all work with
// the viewer script disabled; the script only adds the confirm step and the
// answered summary.

import type {
  CompiledDecision,
  CompiledDecisionConsideration,
  CompiledDecisionOption,
  DecisionStatus,
} from "./compile.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import { BadgePill } from "../_shared/badge-pill/badge-pill.js";
import { SectionLabel } from "../_shared/labeled-section/labeled-section.js";

const TONE_CLASSES = {
  good: "decision-verdict-good",
  bad: "decision-verdict-bad",
  mixed: "decision-verdict-mixed",
  neutral: "decision-verdict-neutral",
} as const;

const STATUS_LABELS = {
  open: "Open",
  decided: "Decided",
  deferred: "Deferred",
} satisfies Record<DecisionStatus, string>;

const RADIO_CLASSES =
  "decision-radio mt-0.5 size-4 shrink-0 appearance-none rounded-full border";

// The card's own surface and border colours live in the stylesheet, not in
// utilities: hover, selected, and settled are variants of them, and a utility
// would out-rank every variant rule.
const CARD_CLASSES =
  "decision-option relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-md border px-3.5 py-3";

// The reader is only invited to answer while the question is genuinely open;
// a settled or deferred decision renders as a record, not as a control.
const isAnswerable = (status: DecisionStatus): boolean => status === "open";

// One comparison attribute: a quiet name over a short verdict, so a reader
// scanning one attribute down the stack lands on the values, not the labels.
// Tone is a colour on top of an already-meaningful word, never instead of it.
const Attribute = ({
  consideration,
}: {
  readonly consideration: CompiledDecisionConsideration;
}) => (
  <div className="min-w-0">
    <dt className="text-[0.6875rem] leading-4 font-medium text-muted">
      {consideration.title}
    </dt>
    <dd
      className={`decision-verdict ${TONE_CLASSES[consideration.tone]} m-0 text-sm leading-5 font-semibold`}
      data-verdict-tone={consideration.tone}
    >
      {consideration.verdict}
    </dd>
  </div>
);

// Everything a reader does not need in order to choose: the reasoning behind
// each verdict, then whatever the option body adds. Collapsed by default so
// the option stack stays a screen of directly comparable values.
const OptionDetails = ({
  option,
}: {
  readonly option: CompiledDecisionOption;
}) => {
  const explained = option.considerations.filter(
    (consideration) => consideration.detail.length > 0,
  );
  if (explained.length === 0 && option.detail.length === 0) return null;
  return (
    <details
      className="decision-details relative col-start-2 mt-2.5"
      data-option-details=""
    >
      <summary className="decision-details-summary w-fit cursor-pointer rounded-sm text-xs font-semibold">
        {"View details"}
      </summary>
      <div className="mt-2 border-t border-edge pt-2.5 text-sm text-muted">
        {explained.map((consideration, index) => (
          <div key={index} className="mb-2.5 last:mb-0">
            <p className="m-0 text-xs font-semibold text-ink">
              {consideration.title}
            </p>
            <div className="[&>:last-child]:mb-0">
              {hastContentToReact(consideration.detail)}
            </div>
          </div>
        ))}
        {option.detail.length === 0 ? null : (
          <div className="[&>:last-child]:mb-0">
            {hastContentToReact(option.detail)}
          </div>
        )}
      </div>
    </details>
  );
};

// One radio card. The input is a real radio so the browser owns selection,
// focus, and arrow-key movement; the label's stretched hit area makes the
// whole card clickable while the disclosure stays reachable above it.
const OptionCard = ({
  option,
  groupName,
  answerable,
}: {
  readonly option: CompiledDecisionOption;
  readonly groupName: string;
  readonly answerable: boolean;
}) => (
  <li
    className={CARD_CLASSES}
    data-decision-option=""
    {...(option.recommended ? { "data-option-recommended": "" } : {})}
    {...(option.chosen ? { "data-option-chosen": "" } : {})}
  >
    <input
      className={RADIO_CLASSES}
      type="radio"
      id={option.id}
      name={groupName}
      value={option.title}
      data-decision-choice=""
      {...(option.chosen ? { defaultChecked: true } : {})}
      {...(answerable ? {} : { disabled: true })}
    />
    <label
      className="decision-option-label min-w-0 cursor-pointer"
      htmlFor={option.id}
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          id={option.titleId}
          className="text-sm font-semibold text-ink"
          data-option-title=""
        >
          {option.title}
        </span>
        {option.recommended ? (
          <BadgePill label="Recommended" classNames={["badge-pill-quiet"]} />
        ) : null}
      </span>
      {option.summary === undefined ? null : (
        <span
          className="mt-0.5 block text-sm text-muted"
          data-option-description=""
        >
          {option.summary}
        </span>
      )}
    </label>
    {option.considerations.length === 0 ? null : (
      <dl
        className="decision-attributes col-start-2 mt-2.5 mb-0 grid gap-x-4 gap-y-2"
        data-decision-attributes=""
      >
        {option.considerations.map((consideration, index) => (
          <Attribute key={index} consideration={consideration} />
        ))}
      </dl>
    )}
    <OptionDetails option={option} />
  </li>
);

// The escape hatch every open decision gets for free, so a reviewer is never
// trapped inside the options the agent happened to think of. It is a peer
// radio, and its textarea appears only once it is picked.
const ProposalCard = ({ model }: { readonly model: CompiledDecision }) => {
  const inputId = `${model.id}-proposal-choice`;
  const textId = `${model.id}-proposal-text`;
  return (
    <li
      className={`${CARD_CLASSES} decision-option-proposal border-dashed`}
      data-decision-option=""
      data-option-proposal=""
    >
      <input
        className={RADIO_CLASSES}
        type="radio"
        id={inputId}
        name={model.id}
        value="Propose another approach"
        data-decision-choice=""
        data-decision-proposal-choice=""
      />
      <label
        className="decision-option-label min-w-0 cursor-pointer"
        htmlFor={inputId}
      >
        <span className="text-sm font-semibold text-ink">
          {"Propose another approach"}
        </span>
        <span className="mt-0.5 block text-sm text-muted">
          {"None of these fit. Describe what you want instead."}
        </span>
      </label>
      <div
        className="decision-proposal relative col-start-2 mt-2.5"
        data-decision-proposal=""
      >
        <label className="sr-only" htmlFor={textId}>
          {"Proposed approach"}
        </label>
        <textarea
          className="decision-proposal-input block w-full"
          id={textId}
          rows={3}
          placeholder="Describe the approach you want, and the constraint that rules the others out."
          data-decision-proposal-text=""
        />
        <p className="mt-1.5 mb-0 text-xs text-muted">
          {"The agent revises the plan to answer a proposal."}
        </p>
      </div>
    </li>
  );
};

// The confirm step, and the strip that replaces it once the reader has
// answered. Both ship inert: the button starts disabled and the strip starts
// hidden until the viewer script wires them, so a scriptless document never
// offers an action it cannot perform. Answering hides the options the reader
// turned down rather than the whole comparison, so the block compresses to
// the answer while the answer itself stays readable.
const AnswerControls = () => (
  <>
    <div
      className="decision-footer flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-edge px-4 py-3"
      data-decision-footer=""
    >
      <p className="m-0 mr-auto text-xs text-muted">
        {"Your answer stays in this document until you send the review back."}
      </p>
      <button
        className="decision-confirm"
        type="button"
        data-decision-confirm=""
        disabled
      >
        {"Confirm decision"}
      </button>
    </div>
    <div
      className="decision-answer gap-2.5 border-t border-edge px-4 py-3"
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
        <p className="m-0 text-sm font-semibold text-ink">
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
  return (
    <figure
      id={model.id}
      className="decision mb-5 min-w-0 overflow-hidden rounded-md border border-edge bg-paper"
      data-decision=""
      data-decision-status={model.status}
      {...(answerable ? { "data-decision-selector": "" } : {})}
    >
      <figcaption className="bg-header px-4 py-3">
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
          className="mt-2 mb-0 text-base font-semibold text-ink first:mt-0"
          data-decision-question=""
        >
          {model.question}
        </p>
      </figcaption>
      {model.context.length === 0 ? null : (
        <div className="border-b border-edge px-4 py-3.5 text-sm [&>:last-child]:mb-0">
          {hastContentToReact(model.context)}
        </div>
      )}
      <fieldset className="decision-fieldset m-0 min-w-0 border-0 px-4 pt-3.5 pb-4">
        <legend className="sr-only">{model.question}</legend>
        <SectionLabel
          label={answerable ? "Choose one" : "Options"}
          dataProperties={{ "data-decision-choose-label": "" }}
        />
        <ul className="m-0 grid list-none gap-2 p-0 pt-2.5">
          {model.options.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              groupName={model.id}
              answerable={answerable}
            />
          ))}
          {answerable ? <ProposalCard model={model} /> : null}
        </ul>
      </fieldset>
      {answerable ? <AnswerControls /> : null}
    </figure>
  );
};
