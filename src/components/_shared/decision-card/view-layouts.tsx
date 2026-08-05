// Shared decision-card reading depths. Rows explain each option in place,
// matrix separates a full-title chooser rail from a keyed comparison, and
// brief presents a standalone low-depth question without comparison criteria.

import type { ElementContent } from "hast";
import type {
  CompiledDecisionCard,
  CompiledDecisionCardOption,
} from "../../_model/decision-card.js";
import { ComparisonMatrix } from "../comparison-matrix/comparison-matrix.js";
import { BadgePill } from "../badge-pill/badge-pill.js";
import { CHEVRON_RIGHT_ICON } from "../../../icons/lucide/chevron-right.js";
import { STAR_ICON } from "../../../icons/lucide/star.js";
import { hastContentToReact } from "../hast-content/hast-content.js";
import { lucideIconToReact } from "../lucide-icon/lucide-icon.js";

const RADIO_CLASSES =
  "decision-radio mt-0.5 size-5 shrink-0 appearance-none rounded-full border";

const criteriaOf = (model: CompiledDecisionCard) => {
  const rows = model.criteria.map((_, index) => index);
  return rows.flatMap((row) => {
    const criterion = model.criteria[row];
    return criterion === undefined ? [] : [{ row, criterion }];
  });
};

const Radio = ({
  option,
  index,
  groupName,
  answerable,
}: {
  readonly option: CompiledDecisionCardOption;
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
  <BadgePill
    label="Recommended"
    classNames={["border border-edge bg-surface text-ink"]}
  />
);

const Chosen = () => (
  <BadgePill label="Chosen" classNames={["decision-chosen-pill"]} />
);

// The same native disclosure powers pointer hover, keyboard focus, and tap.
// It remains readable without the viewer script; the shell upgrades it into
// the floating popover already shared with DecisionAnalysis.
const DefinitionDisclosure = ({
  label,
  detail,
  kind,
  liveScore,
}: {
  readonly label: string;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly kind: "criterion" | "value";
  readonly liveScore?: boolean;
}) => (
  <details
    className="decision-definition"
    data-info-popover=""
    data-decision-definition={kind}
  >
    <summary
      className="decision-definition-trigger"
      {...(liveScore ? { "data-decision-score-output": "" } : {})}
    >
      {label}
    </summary>
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
  readonly model: CompiledDecisionCard;
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
              {option.summary === undefined ? null : (
                <span className="text-sm text-muted">{option.summary}</span>
              )}
              {criteria.flatMap(({ row, criterion }) => {
                const consideration = option.considerations[row];
                return consideration === undefined
                  ? []
                  : [
                      <span className="decision-row-line" key={row}>
                        <span className="decision-row-dimension font-semibold text-ink">
                          {`${criterion.title}:`}
                        </span>
                        <span className="decision-verdict font-normal text-ink">
                          {consideration.verdict}
                        </span>
                      </span>,
                    ];
              })}
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
  readonly model: CompiledDecisionCard;
  readonly option: CompiledDecisionCardOption;
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

// Weighted analysis uses a compact priority-control grammar: weight squares
// belong directly below the criterion they qualify and expose the full 1–5
// scale.
const WeightControl = ({
  title,
  impact,
  criterionIndex,
}: {
  readonly title: string;
  readonly impact: number;
  readonly criterionIndex: number;
}) => (
  <div
    className="decision-weight-group mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"
    role="radiogroup"
    aria-label={`Impact of ${title}`}
    data-decision-weight-group=""
    data-criterion-index={criterionIndex}
    data-decision-weight-value={impact}
  >
    <span className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          className="decision-weight-step"
          type="button"
          role="radio"
          key={value}
          aria-label={`Set impact to ${value} of 5 for ${title}`}
          aria-checked={value === impact}
          tabIndex={value === impact ? 0 : -1}
          title={`Impact: ${value} of 5`}
          data-decision-weight=""
          data-weight-value={value}
          {...(value <= impact ? { "data-weight-filled": "" } : {})}
        />
      ))}
    </span>
    <output
      className="text-[0.6875rem] leading-4 font-semibold text-muted tabular-nums"
      data-decision-weight-output=""
    >
      {`${impact}/5`}
    </output>
  </div>
);

// Weighted values use the same compact, keyboard-operable five-step grammar
// as impacts, but star silhouettes make the different input roles obvious.
// The numeric value stays above the stars for fast column scanning.
const ScoreControl = ({
  optionTitle,
  criterionTitle,
  detail,
  score,
  optionIndex,
  criterionIndex,
}: {
  readonly optionTitle: string;
  readonly criterionTitle: string;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly score: number;
  readonly optionIndex: number;
  readonly criterionIndex: number;
}) => (
  <div
    className="decision-score-control inline-flex flex-col items-center"
    role="radiogroup"
    aria-label={`Score ${optionTitle} on ${criterionTitle}`}
    data-decision-score-group=""
    data-option-index={optionIndex}
    data-criterion-index={criterionIndex}
    data-decision-score-value={score}
  >
    <DefinitionDisclosure
      label={`${score}/5`}
      detail={detail}
      kind="value"
      liveScore={true}
    />
    <span className="decision-score-stars mt-1 inline-flex items-center">
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          className="decision-score-star"
          type="button"
          role="radio"
          key={value}
          aria-label={`Set ${optionTitle} to ${value} of 5 for ${criterionTitle}`}
          aria-checked={value === score}
          tabIndex={value === score ? 0 : -1}
          title={`${optionTitle}: ${value} of 5 for ${criterionTitle}`}
          data-decision-score=""
          data-score-value={value}
          {...(value <= score ? { "data-score-filled": "" } : {})}
        >
          {lucideIconToReact({ icon: STAR_ICON, hidden: false })}
        </button>
      ))}
    </span>
  </div>
);

// The arithmetic disclosure repeats the comparison's row/column shape. Each
// cell shows one contribution, and the footer reconciles those contributions
// with the same normalized total displayed in the primary matrix.
const ScoreCalculationMatrix = ({
  model,
}: {
  readonly model: CompiledDecisionCard;
}) => {
  const criteria = criteriaOf(model);
  const totals = model.options.map((option) =>
    weightedTotal({ model, option }),
  );
  return (
    <div className="decision-calculation-scroll mt-3">
      <table className="decision-calculation-matrix w-full border-collapse">
        <thead>
          <tr>
            <th scope="col">{"Criterion"}</th>
            <th scope="col">{"Impact"}</th>
            {model.options.map((option, optionIndex) => (
              <th scope="col" key={option.id}>
                <span aria-hidden="true">{optionKey(optionIndex)}</span>
                <span className="sr-only">{option.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {criteria.map(({ row, criterion }) => (
            <tr key={criterion.id}>
              <th scope="row">{criterion.title}</th>
              <td
                className="decision-calculation-impact"
                data-decision-calculation-weight=""
                data-criterion-index={row}
              >
                {criterion.impact}
              </td>
              {model.options.map((option, optionIndex) => {
                const score = option.considerations[row]?.score ?? 0;
                const impact = criterion.impact ?? 0;
                return (
                  <td
                    className="decision-calculation-contribution"
                    key={option.id}
                    data-decision-contribution=""
                    data-option-index={optionIndex}
                    data-criterion-index={row}
                  >
                    {`${impact} × ${score} = ${impact * score}`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{"Total"}</th>
            <td data-decision-max-total="">
              {`${totals[0]?.denominator ?? 0} max`}
            </td>
            {model.options.map((option, optionIndex) => {
              const total = totals[optionIndex];
              return (
                <td
                  className="decision-calculation-total"
                  key={option.id}
                  data-decision-composite=""
                  data-option-index={optionIndex}
                  data-score-values={total?.scores.join(",")}
                >
                  <span data-decision-numerator="">
                    {total?.numerator ?? 0}
                  </span>
                  {" / "}
                  <span data-decision-denominator="">
                    {total?.denominator ?? 0}
                  </span>
                  {" = "}
                  <strong data-decision-percent="">
                    {`${total?.percent ?? 0}%`}
                  </strong>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

// Totals sit at the foot of the same matrix they summarize. Exact arithmetic
// remains available, but only behind one secondary disclosure so the default
// comparison ends with the answer rather than a separate calculator panel.
const WeightedScoreFooter = ({
  model,
}: {
  readonly model: CompiledDecisionCard;
}) => (
  <tfoot>
    <tr className="comparison-matrix-row decision-score-row">
      <th
        className="decision-criterion px-4 py-3 text-left text-sm leading-5 font-semibold text-ink"
        scope="row"
      >
        {"Total score"}
      </th>
      {model.options.map((option, optionIndex) => {
        const total = weightedTotal({ model, option });
        return (
          <td
            className="decision-score-total px-4 py-3 text-center"
            key={option.id}
            data-decision-column={optionIndex}
            data-decision-composite=""
            data-option-index={optionIndex}
            data-score-values={total.scores.join(",")}
            {...(option.chosen ? { "data-option-chosen": "" } : {})}
          >
            <strong
              className="text-base text-ink tabular-nums"
              data-decision-percent=""
            >
              {`${total.percent}%`}
            </strong>
            <span className="sr-only">{` for ${option.title}`}</span>
          </td>
        );
      })}
    </tr>
    <tr className="decision-score-breakdown-row">
      <td className="px-4 py-3" colSpan={model.options.length + 1}>
        <details className="decision-score-breakdown">
          <summary className="decision-score-breakdown-link">
            <span data-score-breakdown-closed="">
              {"Show score calculation"}
            </span>
            <span data-score-breakdown-open="">{"Hide score calculation"}</span>
          </summary>
          <ScoreCalculationMatrix model={model} />
          <p className="mt-2.5 mb-0 text-xs text-muted">
            {
              "Each total is Σ(impact × option score) ÷ Σ(impact × 5), normalized to 100%."
            }
          </p>
        </details>
      </td>
    </tr>
  </tfoot>
);

// The chosen matrix: full option names live in the chooser rail, while stable
// letter keys leave the comparison grid enough room to scan. Definitions sit
// on the authored term or value itself instead of adding an icon vocabulary.
export const MatrixLayout = ({
  model,
  answerable,
}: {
  readonly model: CompiledDecisionCard;
  readonly answerable: boolean;
}) => {
  const criteria = criteriaOf(model);
  return (
    <div
      className="decision-keyed"
      {...(model.scoring === "weighted"
        ? { "data-decision-weighting": "" }
        : {})}
    >
      <ol className="decision-keyed-chooser m-0 grid list-none gap-0 p-0">
        {model.options.map((option, index) => (
          <li
            className="decision-keyed-option"
            key={option.id}
            {...(model.interaction === "audit" ? { id: option.id } : {})}
            data-decision-column={index}
            {...(option.recommended ? { "data-option-recommended": "" } : {})}
            {...(option.chosen ? { "data-option-chosen": "" } : {})}
          >
            <label
              className="decision-keyed-head flex cursor-pointer items-center gap-3 px-4 py-3"
              htmlFor={option.id}
            >
              {model.interaction === "choose" ? (
                <Radio
                  option={option}
                  index={index}
                  groupName={model.id}
                  answerable={answerable}
                />
              ) : null}
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
              {option.chosen || option.recommended ? (
                <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                  {option.chosen ? <Chosen /> : null}
                  {option.recommended ? <Recommended /> : null}
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
                {...(option.chosen ? { "data-option-chosen": "" } : {})}
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
                {model.scoring === "weighted" &&
                criterion.impact !== undefined ? (
                  <WeightControl
                    title={criterion.title}
                    impact={criterion.impact}
                    criterionIndex={row}
                  />
                ) : null}
              </th>
              {model.options.map((option, index) => {
                const consideration = option.considerations[row];
                return (
                  <td
                    className="decision-cell px-4 py-3 text-center"
                    key={option.id}
                    data-decision-column={index}
                    {...(option.chosen ? { "data-option-chosen": "" } : {})}
                  >
                    {consideration === undefined ? (
                      "-"
                    ) : model.scoring === "weighted" &&
                      consideration.score !== undefined ? (
                      <ScoreControl
                        optionTitle={option.title}
                        criterionTitle={criterion.title}
                        detail={consideration.detail}
                        score={consideration.score}
                        optionIndex={index}
                        criterionIndex={row}
                      />
                    ) : (
                      <DefinitionDisclosure
                        label={consideration.verdict}
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
        {model.scoring === "weighted" ? (
          <WeightedScoreFooter model={model} />
        ) : null}
      </ComparisonMatrix>
    </div>
  );
};

// A criteria-bearing internal brief model gets one plain fallback comparison.
// QuickDecision supplies no criteria, so its public surface never renders it.
const ReadOnlyComparison = ({
  model,
}: {
  readonly model: CompiledDecisionCard;
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
// QuickDecision's empty criteria set keeps the comparison branch absent.
export const BriefLayout = ({
  model,
  answerable,
}: {
  readonly model: CompiledDecisionCard;
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
