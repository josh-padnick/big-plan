// Decision's three approved reading depths. Rows explain each option in
// place, matrix separates a full-title chooser rail from a keyed comparison,
// and brief keeps the comparison collapsed until the reader asks for it.

import type { ElementContent } from "hast";
import type { CompiledDecision, CompiledDecisionOption } from "./compile.js";
import { ComparisonMatrix } from "../_shared/comparison-matrix/comparison-matrix.js";
import { BadgePill } from "../_shared/badge-pill/badge-pill.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";

const RADIO_CLASSES =
  "decision-radio mt-0.5 size-5 shrink-0 appearance-none rounded-full border";

const criteriaOf = (model: CompiledDecision) =>
  model.discriminating.flatMap((row) => {
    const criterion = model.criteria[row];
    return criterion === undefined ? [] : [{ row, criterion }];
  });

const Radio = ({
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
  <input
    className={RADIO_CLASSES}
    type="radio"
    id={option.id}
    name={groupName}
    value={option.title}
    data-decision-choice=""
    data-option-index={index}
    {...(option.chosen ? { defaultChecked: true } : {})}
    {...(answerable ? {} : { disabled: true })}
  />
);

const Recommended = () => (
  <BadgePill label="Recommended" classNames={["badge-pill-quiet"]} />
);

// The same native disclosure powers pointer hover, keyboard focus, and tap.
// It remains readable without the viewer script; the shell upgrades it into
// the floating popover already shared with ComplexDecision.
const DefinitionDisclosure = ({
  label,
  detail,
  kind,
}: {
  readonly label: string;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly kind: "criterion" | "value";
}) => (
  <details
    className="decision-definition"
    data-info-popover=""
    data-decision-definition={kind}
  >
    <summary className="decision-definition-trigger">{label}</summary>
    <div
      className="decision-definition-body max-w-72 text-xs leading-5"
      data-info-popover-body=""
    >
      {hastContentToReact(detail)}
    </div>
  </details>
);

// The row form intentionally keeps definitions out of the reading path. It
// is the approved compact summary: a distinct option title followed by small
// bold criterion labels and plain values.
export const RowsLayout = ({
  model,
  answerable,
}: {
  readonly model: CompiledDecision;
  readonly answerable: boolean;
}) => {
  const criteria = criteriaOf(model);
  return (
    <ul
      className="decision-rows m-0 grid list-none gap-0 p-0"
      data-decision-rows=""
    >
      {model.options.map((option, index) => (
        <li
          className="decision-row grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-5 py-4"
          key={option.id}
          data-decision-option=""
          data-decision-column={index}
          {...(option.recommended ? { "data-option-recommended": "" } : {})}
          {...(option.chosen ? { "data-option-chosen": "" } : {})}
        >
          <Radio
            option={option}
            index={index}
            groupName={model.id}
            answerable={answerable}
          />
          <label
            className="decision-row-label min-w-0 cursor-pointer"
            htmlFor={option.id}
          >
            <span className="decision-row-head flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className="text-lg leading-7 font-semibold text-ink"
                data-option-title=""
                id={option.titleId}
              >
                {option.title}
              </span>
              {option.recommended ? <Recommended /> : null}
            </span>
            <span className="decision-row-lines mt-2 grid gap-1">
              {criteria.map(({ row, criterion }) => (
                <span className="decision-row-line" key={row}>
                  <span className="decision-row-dimension font-semibold text-ink">
                    {`${criterion.title}:`}
                  </span>
                  <span className="decision-verdict font-normal text-ink">
                    {option.considerations[row]?.verdict ?? "-"}
                  </span>
                </span>
              ))}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
};

const optionKey = (index: number): string =>
  String.fromCharCode("A".charCodeAt(0) + index);

const weightedTotal = ({
  model,
  option,
}: {
  readonly model: CompiledDecision;
  readonly option: CompiledDecisionOption;
}) => {
  const weights = model.criteria.map((criterion) => criterion.impact ?? 0);
  const scores = option.considerations.map(
    (consideration) => consideration?.score ?? 0,
  );
  const numerator = weights.reduce(
    (sum, weight, index) => sum + weight * (scores[index] ?? 0),
    0,
  );
  const denominator = weights.reduce((sum, weight) => sum + weight * 5, 0);
  const percent =
    denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
  return { weights, scores, numerator, denominator, percent };
};

// The full-scoring variation exposes the arithmetic instead of hiding it
// behind a rank. Authored 1–5 impacts and scores provide the readable default;
// the shell keeps these totals live when a reviewer changes any impact.
export const WeightedScorePanel = ({
  model,
}: {
  readonly model: CompiledDecision;
}) => (
  <section
    className="decision-scoring border-t border-edge bg-surface px-5 py-4"
    data-decision-scoring=""
  >
    <div className="decision-scoring-intro">
      <h4 className="m-0 text-base font-semibold text-ink">
        {"Impact weights"}
      </h4>
      <p className="mt-1 mb-0 text-sm text-muted">
        {
          "Set how much each criterion matters. Every composite updates as Σ(impact × option score) ÷ Σ(impact × 5)."
        }
      </p>
    </div>
    <div className="decision-weight-list mt-4 grid gap-3">
      {model.criteria.map((criterion, index) => (
        <label
          className="decision-weight-row grid min-w-0 items-center gap-x-3 gap-y-1"
          key={criterion.id}
        >
          <span className="min-w-0 text-sm font-medium text-ink">
            {criterion.title}
          </span>
          <span className="decision-weight-value text-right text-xs font-semibold text-muted tabular-nums">
            <output data-decision-weight-output="">{criterion.impact}</output>
            {" / 5"}
          </span>
          <input
            className="decision-weight-input"
            type="range"
            min="1"
            max="5"
            step="1"
            defaultValue={criterion.impact}
            aria-label={`${criterion.title} impact`}
            data-decision-weight=""
            data-criterion-index={index}
          />
        </label>
      ))}
    </div>
    <div className="decision-composite mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="m-0 text-base font-semibold text-ink">
          {"Composite scores"}
        </h4>
        <span className="text-xs text-muted">{"Transparent 1–5 scale"}</span>
      </div>
      <ol className="decision-composite-list mt-3 grid list-none gap-2 p-0">
        {model.options.map((option, optionIndex) => {
          const total = weightedTotal({ model, option });
          const formula = total.weights
            .map(
              (weight, criterionIndex) =>
                `${weight}×${total.scores[criterionIndex] ?? 0}`,
            )
            .join(" + ");
          return (
            <li
              className="decision-composite-option min-w-0 rounded-md border border-edge bg-paper px-3 py-2.5"
              key={option.id}
              data-decision-composite=""
              data-option-index={optionIndex}
              data-decision-column={optionIndex}
              data-score-values={total.scores.join(",")}
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="decision-key inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-xs font-bold">
                  {optionKey(optionIndex)}
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold text-ink">
                  {option.title}
                </span>
                <strong
                  className="text-base text-ink tabular-nums"
                  data-decision-percent=""
                >
                  {`${total.percent}%`}
                </strong>
              </div>
              <p className="mt-1.5 mb-0 break-words font-mono text-xs leading-5 text-muted">
                <span data-decision-formula="">{formula}</span>
                {" = "}
                <span data-decision-numerator="">{total.numerator}</span>
                {" / "}
                <span data-decision-denominator="">{total.denominator}</span>
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  </section>
);

// The chosen matrix: full option names live in the chooser rail, while stable
// letter keys leave the comparison grid enough room to scan. Definitions sit
// on the authored term or value itself instead of adding an icon vocabulary.
export const MatrixLayout = ({
  model,
  answerable,
}: {
  readonly model: CompiledDecision;
  readonly answerable: boolean;
}) => {
  const criteria = criteriaOf(model);
  return (
    <div className="decision-keyed">
      <ol className="decision-keyed-chooser m-0 grid list-none gap-0 p-0">
        {model.options.map((option, index) => (
          <li
            className="decision-keyed-option"
            key={option.id}
            data-decision-column={index}
            {...(option.recommended ? { "data-option-recommended": "" } : {})}
            {...(option.chosen ? { "data-option-chosen": "" } : {})}
          >
            <label
              className="decision-keyed-head flex cursor-pointer items-center gap-3 px-4 py-3"
              htmlFor={option.id}
            >
              <Radio
                option={option}
                index={index}
                groupName={model.id}
                answerable={answerable}
              />
              <span className="decision-key inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-xs font-bold">
                {optionKey(index)}
              </span>
              <span
                className="min-w-0 text-base leading-6 font-semibold text-ink"
                data-option-title=""
                id={option.titleId}
              >
                {option.title}
              </span>
              {option.recommended ? (
                <span className="ml-auto">
                  <Recommended />
                </span>
              ) : null}
            </label>
          </li>
        ))}
      </ol>
      <ComparisonMatrix className="decision-matrix decision-matrix-keyed">
        <thead>
          <tr className="decision-chooser-row">
            <th
              className="decision-criterion px-4 py-3 text-left text-sm leading-5 font-medium text-muted"
              scope="col"
            >
              {"Criterion"}
            </th>
            {model.options.map((option, index) => (
              <th
                className="decision-column px-4 py-3 text-center align-middle"
                key={option.id}
                scope="col"
                data-decision-column={index}
              >
                <span className="text-sm font-bold text-ink" aria-hidden="true">
                  {optionKey(index)}
                </span>
                <span className="sr-only">{option.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {criteria.map(({ row, criterion }) => (
            <tr className="comparison-matrix-row" key={criterion.id}>
              <th
                className="decision-criterion px-4 py-3 text-left text-sm leading-5 font-medium text-muted"
                scope="row"
              >
                <DefinitionDisclosure
                  label={criterion.title}
                  detail={criterion.detail}
                  kind="criterion"
                />
              </th>
              {model.options.map((option, index) => {
                const consideration = option.considerations[row];
                return (
                  <td
                    className="decision-cell px-4 py-3 text-center"
                    key={option.id}
                    data-decision-column={index}
                  >
                    {consideration === undefined ? (
                      "-"
                    ) : (
                      <DefinitionDisclosure
                        label={
                          model.scoring === "weighted" &&
                          consideration.score !== undefined
                            ? `${consideration.score}/5 · ${consideration.verdict}`
                            : consideration.verdict
                        }
                        detail={consideration.detail}
                        kind="value"
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </ComparisonMatrix>
    </div>
  );
};

// Brief's expanded comparison is deliberately plain: this approved low-depth
// form reveals the evidence in one action and does not add nested disclosures.
const ReadOnlyComparison = ({
  model,
}: {
  readonly model: CompiledDecision;
}) => {
  const criteria = criteriaOf(model);
  return (
    <ComparisonMatrix className="decision-matrix">
      <thead>
        <tr>
          <th className="decision-corner px-4 py-2.5 text-left" scope="col">
            <span className="sr-only">{"Criterion"}</span>
          </th>
          {model.options.map((option) => (
            <th
              className="decision-column px-4 py-2.5 text-left align-bottom text-base leading-6 font-semibold text-ink"
              key={option.id}
              scope="col"
            >
              {option.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {criteria.map(({ row, criterion }) => (
          <tr className="comparison-matrix-row" key={criterion.id}>
            <th
              className="decision-criterion px-4 py-2.5 text-left text-base leading-6 font-medium text-muted"
              scope="row"
            >
              {criterion.title}
            </th>
            {model.options.map((option) => (
              <td className="decision-cell px-4 py-2.5" key={option.id}>
                <span className="decision-verdict text-base leading-6 font-semibold text-ink">
                  {option.considerations[row]?.verdict ?? "-"}
                </span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </ComparisonMatrix>
  );
};

// The question, the choices, and the one sentence that frames the decision.
// The comparison starts closed because agreement should not require a grid.
export const BriefLayout = ({
  model,
  answerable,
}: {
  readonly model: CompiledDecision;
  readonly answerable: boolean;
}) => {
  const lead =
    model.options.find((option) => option.recommended) ?? model.options[0];
  return (
    <div className="decision-brief" data-decision-brief="">
      {lead?.summary === undefined ? null : (
        <p
          className="decision-brief-lead m-0 border-b border-edge bg-surface px-5 py-3.5 text-base leading-6 text-ink"
          data-decision-brief-lead=""
        >
          {lead.summary}
        </p>
      )}
      <ul className="decision-brief-list m-0 grid list-none gap-0 p-0">
        {model.options.map((option, index) => (
          <li
            className="decision-brief-option grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-5 py-3"
            key={option.id}
            data-decision-option=""
            data-decision-column={index}
            {...(option.recommended ? { "data-option-recommended": "" } : {})}
            {...(option.chosen ? { "data-option-chosen": "" } : {})}
          >
            <Radio
              option={option}
              index={index}
              groupName={model.id}
              answerable={answerable}
            />
            <label
              className="decision-row-label flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 cursor-pointer"
              htmlFor={option.id}
            >
              <span
                className="text-base font-semibold text-ink"
                data-option-title=""
                id={option.titleId}
              >
                {option.title}
              </span>
              {option.recommended ? <Recommended /> : null}
            </label>
          </li>
        ))}
      </ul>
      {model.discriminating.length === 0 ? null : (
        <details className="decision-brief-compare px-5">
          <summary className="decision-details-summary flex min-h-12 w-fit cursor-pointer items-center gap-1.5 rounded-sm text-sm font-semibold">
            <span className="decision-details-chevron inline-flex size-3.5 shrink-0">
              {lucideIconToReact({
                icon: CHEVRON_RIGHT_ICON,
                hidden: false,
              })}
            </span>
            <span>{"Compare all three"}</span>
          </summary>
          <div className="decision-brief-compare-body mb-4">
            <ReadOnlyComparison model={model} />
          </div>
        </details>
      )}
    </div>
  );
};
