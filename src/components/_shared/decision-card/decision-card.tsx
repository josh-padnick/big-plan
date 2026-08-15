// The shell shared by Decision, QuickDecision, and DecisionAnalysis.
// shape, the confirm step, and the answered record. The comparison itself
// lives in view-layouts.tsx, which is where the shapes under evaluation differ.
//
// Only the matrix keeps a rationale panel, and it now carries one line rather
// than restating every criterion the reader just read. The rows and brief
// shapes carry their reasoning inline, so a panel would be a third telling.
// Where a panel exists, every option's panel occupies the same grid cell, so
// the region is as tall as the longest one and choosing never moves the page.
//
// Selection is a native radio group, so choosing survives with the viewer
// script disabled.

import {
  isAnswerableDecisionCard,
  type CompiledDecisionCard,
  type CompiledDecisionCardOption,
  type DecisionCardStatus,
  type DecisionCardTone,
} from "../../_model/decision-card.js";
import { CHECK_ICON } from "../../../icons/lucide/check.js";
import { PLUS_ICON } from "../../../icons/lucide/plus.js";
import { TRIANGLE_ALERT_ICON } from "../../../icons/lucide/triangle-alert.js";
import { type MatrixToneParity } from "../comparison-matrix/comparison-matrix.js";
import { BriefLayout, MatrixLayout, RowsLayout } from "./view-layouts.js";
import { hastContentToReact } from "../hast-content/hast-content.js";
import { lucideIconToReact } from "../lucide-icon/lucide-icon.js";
import { BadgePill } from "../badge-pill/badge-pill.js";

// Decision's tones are the shared matrix vocabulary; the alias fails the
// build if the two ever diverge.
const _TONE_PARITY: MatrixToneParity<DecisionCardTone> = true;

const STATUS_LABELS = {
  open: "Open",
  decided: "Decided",
  deferred: "Deferred",
} satisfies Record<DecisionCardStatus, string>;

const STATUS_CLASSES = {
  open: "bg-surface text-muted",
  decided: "bg-[var(--decision-pro-bg)] text-[var(--decision-pro-c)]",
  deferred: "bg-surface text-muted",
} satisfies Record<DecisionCardStatus, string>;

// /* off-scale */ Phase A preserves the legacy compact controls, proposal
// geometry, state washes, and 22–24% focus halos exactly. Phase B may
// regularize them against the product scale.

const statusLabel = (model: CompiledDecisionCard): string =>
  model.status === "open" && model.interaction === "audit"
    ? "Proposed"
    : STATUS_LABELS[model.status];

// A settled record explains its outcome; an open question begins with the
// agent's recommendation without preselecting any radio.
const defaultPanelIndex = (model: CompiledDecisionCard): number => {
  const chosen = model.options.findIndex((option) => option.chosen);
  if (chosen !== -1) return chosen;
  const recommended = model.options.findIndex((option) => option.recommended);
  return recommended === -1 ? 0 : recommended;
};

// One option's reasoning in one line. Restating each criterion here was the
// third time the reader met the same three values, and the round-4 review
// counted that as weight carried for nothing.
const RationalePanel = ({
  option,
  index,
  isDefault,
}: {
  readonly option: CompiledDecisionCardOption;
  readonly index: number;
  readonly isDefault: boolean;
}) => (
  <div
    className="decision-rationale-panel"
    data-rationale-panel=""
    data-option-index={index}
    {...(isDefault ? { "data-rationale-default": "" } : {})}
  >
    <span className="text-base font-semibold text-ink">{option.title}</span>
    {option.summary === undefined ? null : (
      <span className="decision-option-summary text-base">{` - ${option.summary}`}</span>
    )}
  </div>
);

// The escape hatch, demoted to a quiet link so it never competes with the
// real options. Its radio still belongs to the group, so proposing clears
// whichever column was picked.
const ProposeLink = ({ model }: { readonly model: CompiledDecisionCard }) => {
  const inputId = `${model.id}-proposal-choice`;
  const textId = `${model.id}-proposal-text`;
  return (
    <div className="decision-propose" data-option-proposal="">
      <label className="decision-propose-link" htmlFor={inputId}>
        <input
          className="sr-only"
          type="radio"
          id={inputId}
          name={model.id}
          value="Suggest another option"
          data-decision-choice=""
          data-decision-proposal-choice=""
        />
        <span className="inline-flex size-4 shrink-0" aria-hidden="true">
          {lucideIconToReact({ icon: PLUS_ICON, hidden: false })}
        </span>
        <span>{"Suggest another option"}</span>
      </label>
      {/* Visibility is CSS keyed on the radio, not the hidden attribute, so
          activating the link reveals the field with the viewer script
          disabled. The shell enhances that reachable authored state with
          cancellation, confirmation, and answer recording. */}
      <div className="decision-proposal mt-3" data-decision-proposal="">
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
        <button
          className="decision-proposal-cancel data-[shown]:inline-flex mt-2"
          type="button"
          hidden
          data-decision-proposal-cancel=""
        >
          {"Cancel"}
        </button>
      </div>
    </div>
  );
};

// A read-only review cannot record anything, so the controls are inert and say
// why beside themselves. It appears twice because both states can be reached in
// a read-only session: an unanswered card that cannot be answered, and an
// answered one whose answer cannot be changed.
const ReadOnlyNote = ({ className = "" }: { readonly className?: string }) => (
  <p
    className={`decision-locked-note m-0 flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--callout-warning-c)] ${className}`}
    data-decision-locked-note=""
    hidden
  >
    <span className="inline-flex size-4 shrink-0" aria-hidden="true">
      {lucideIconToReact({ icon: TRIANGLE_ALERT_ICON, hidden: false })}
    </span>
    <span>{"This review is read-only, so no answer can be recorded."}</span>
  </p>
);

// A masked answer and an unanswered decision are the same empty card, so the
// reader who answered this one is told what happened to their answer instead of
// being left to notice the difference.
const SupersededNotice = () => (
  <p
    className="decision-superseded flex items-start gap-2 bg-[var(--callout-warning-bg)] px-6 py-3 text-sm font-medium text-[var(--callout-warning-c)]"
    data-decision-superseded=""
    role="status"
    hidden
  >
    <span className="mt-0.5 inline-flex size-4 shrink-0" aria-hidden="true">
      {lucideIconToReact({ icon: TRIANGLE_ALERT_ICON, hidden: false })}
    </span>
    <span>
      {
        "This decision changed after you answered it. Answer it again to record your choice."
      }
    </span>
  </p>
);

// The confirm row sits directly under the rationale panel rather than at the
// end of the document, so the action is never screens away from the choice.
// The whole card is about one screen now, which is why this is close rather
// than sticky: pinning it would add chrome without shortening the reach.
const AnswerControls = () => (
  <>
    <div
      className="decision-footer flex flex-wrap items-center justify-end gap-x-4 gap-y-2 px-6 py-4"
      data-decision-footer=""
    >
      <p
        className="decision-selection-summary m-0 mr-auto flex min-w-0 items-center gap-2 text-sm text-muted"
        data-decision-selection-summary=""
        aria-live="polite"
      >
        <span
          className="decision-selection-mark size-4 shrink-0 text-accent"
          aria-hidden="true"
        >
          {lucideIconToReact({ icon: CHECK_ICON, hidden: false })}
        </span>
        <span data-decision-selection-copy="">
          {"Select an option to continue."}
        </span>
      </p>
      {/* Leaving a decision unanswered on purpose is a different question from
          "which one?", so it is an action beside the options rather than an
          entry inside them. It appears only after an answer exists, because
          before that there is nothing to clear. */}
      <ReadOnlyNote />
      <button
        className="decision-clear"
        type="button"
        data-decision-clear=""
        hidden
      >
        {"Clear answer"}
      </button>
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
      className="decision-answer group gap-3 px-6 py-4 data-[decision-persistence-failed]:bg-[var(--callout-danger-bg)]!"
      data-decision-answer=""
      role="status"
      hidden
    >
      <span
        className="decision-answer-mark mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--decision-pro-c)] text-paper group-data-[decision-persistence-failed]:bg-danger group-data-[decision-persistence-failed]:text-danger-ink [&_svg]:size-3"
        aria-hidden="true"
      >
        <span className="inline-flex group-data-[decision-persistence-failed]:hidden">
          {lucideIconToReact({ icon: CHECK_ICON, hidden: false })}
        </span>
        <span className="hidden group-data-[decision-persistence-failed]:inline-flex">
          {lucideIconToReact({ icon: TRIANGLE_ALERT_ICON, hidden: false })}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-base font-semibold text-[var(--decision-pro-ink)] group-data-[decision-persistence-failed]:text-[var(--callout-danger-c)]">
          <span data-decision-answer-lead="">{"Answer recorded"}</span>
          <span className="sr-only" data-decision-answer-title="" />
        </p>
        <p
          className="m-0 mt-0.5 text-xs text-[var(--decision-pro-c)] group-data-[decision-persistence-failed]:text-[var(--callout-danger-c)]"
          data-decision-answer-caption=""
        >
          {"Noted for this reading session."}
        </p>
        {/* Under the caption rather than beside it: the strip already carries a
            mark, a record, and a control, and a fourth column squeezes all
            three at the reading width. */}
        <ReadOnlyNote className="mt-1" />
      </div>
      <button
        className="decision-change shrink-0"
        type="button"
        data-decision-change=""
      >
        {"Change"}
      </button>
    </div>
    <p
      className="m-0 bg-[var(--callout-danger-bg)] px-6 py-3 text-sm font-medium text-[var(--callout-danger-c)]"
      data-decision-persistence-status=""
      role="status"
      aria-live="polite"
      hidden
    >
      {"Not saved yet. Big Plan is retrying automatically."}
    </p>
  </>
);

const Comparison = ({
  model,
  answerable,
}: {
  readonly model: CompiledDecisionCard;
  readonly answerable: boolean;
}) => {
  if (model.layout === "rows") {
    return <RowsLayout model={model} answerable={answerable} />;
  }
  if (model.layout === "brief") {
    return <BriefLayout model={model} answerable={answerable} />;
  }
  return <MatrixLayout model={model} answerable={answerable} />;
};

const isMatrixLayout = (model: CompiledDecisionCard): boolean =>
  model.layout === "matrix";

const Reversibility = ({ model }: { readonly model: CompiledDecisionCard }) => {
  const reversibility = model.reversibility;
  if (reversibility === undefined) return null;
  return (
    <div className="decision-reversibility bg-paper px-6 py-4">
      <p className="m-0 text-xs font-semibold tracking-caps text-muted uppercase">
        {`Reversibility · ${reversibility.rating.replace("-", " ")}`}
      </p>
      <div className="mt-1 text-sm text-ink [&>:last-child]:mb-0">
        {hastContentToReact(reversibility.detail)}
      </div>
    </div>
  );
};

const Details = ({ model }: { readonly model: CompiledDecisionCard }) =>
  model.detail.length === 0 ? null : (
    <details className="decision-long-details bg-paper px-6">
      <summary className="decision-details-summary flex min-h-12 w-fit cursor-pointer items-center text-sm font-semibold">
        {"More detail"}
      </summary>
      <div className="pb-4 text-sm text-ink [&>:last-child]:mb-0">
        {hastContentToReact(model.detail)}
      </div>
    </details>
  );

export const DecisionCard = ({
  model,
}: {
  readonly model: CompiledDecisionCard;
}) => {
  const answerable = isAnswerableDecisionCard(model);
  const defaultIndex = defaultPanelIndex(model);
  return (
    <figure
      id={model.id}
      className="decision mb-6 min-w-0 overflow-hidden rounded-xl border border-edge bg-paper shadow-raised"
      data-decision=""
      data-decision-status={model.status}
      data-decision-layout={model.layout}
      data-decision-scoring={model.scoring}
      data-decision-interaction={model.interaction}
      {...(answerable ? { "data-decision-selector": "" } : {})}
    >
      <figcaption className="decision-zone-question bg-header px-6 py-4">
        {model.layout === "rows" ? (
          <p className="decision-eyebrow m-0 text-xs font-semibold tracking-caps text-subtle uppercase">
            {"Decision"}
          </p>
        ) : null}
        {answerable ? null : (
          <BadgePill
            label={statusLabel(model)}
            classNames={[
              "decision-status-pill",
              `decision-status-${model.status}`,
              STATUS_CLASSES[model.status],
            ]}
          />
        )}
        <p
          id={model.questionId}
          className={`mt-2 mb-0 font-semibold text-ink first:mt-0 ${
            model.layout === "rows"
              ? "text-2xl leading-tight"
              : "text-lg leading-7"
          }`}
          data-decision-question=""
        >
          {model.question}
        </p>
      </figcaption>
      {model.context.length === 0 ? null : (
        <div className="decision-zone-question bg-header px-6 pb-4 text-base [&>:last-child]:mb-0">
          {hastContentToReact(model.context)}
        </div>
      )}
      {answerable ? <SupersededNotice /> : null}
      <fieldset className="decision-fieldset m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">{model.question}</legend>
        <div
          className="decision-zone-compare bg-paper"
          data-decision-compare=""
        >
          <Comparison model={model} answerable={answerable} />
        </div>
        {/* Only the matrix earns a rationale region: its cells are values, so
            the reader still needs a sentence naming what they mean. The other
            shapes already carry their reasoning in line. */}
        {isMatrixLayout(model) ? (
          <div
            className="decision-zone-rationale bg-surface px-6 py-4"
            data-decision-explain=""
          >
            <div
              className="decision-rationale"
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
          </div>
        ) : null}
        {answerable ? (
          <div
            className={
              model.layout === "rows"
                ? "decision-zone-propose bg-paper px-6 pb-4"
                : "decision-zone-propose bg-surface px-6 py-3"
            }
          >
            <ProposeLink model={model} />
          </div>
        ) : null}
      </fieldset>
      <Reversibility model={model} />
      <Details model={model} />
      {answerable ? <AnswerControls /> : null}
    </figure>
  );
};
