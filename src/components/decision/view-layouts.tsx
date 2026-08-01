// The three comparison shapes under evaluation. They render the same compiled
// decision and differ only in how much the reader must hold to answer, which
// is the axis they are being judged on.
//
// Every shape obeys two reductions the round-4 review asked for. A verdict is
// one signal - the word - because an icon and a colour saying the same thing
// are two more marks to process and nothing more to learn. And a criterion
// every option scores identically cannot inform a choice, so it never renders;
// the model marks which positions actually discriminate.

import type { CompiledDecision, CompiledDecisionOption } from "./compile.js";
import { ComparisonMatrix } from "../_shared/comparison-matrix/comparison-matrix.js";
import { BadgePill } from "../_shared/badge-pill/badge-pill.js";

const RADIO_CLASSES =
  "decision-radio mt-0.5 size-5 shrink-0 appearance-none rounded-full border";

const criteriaOf = (model: CompiledDecision) =>
  model.discriminating.map((row) => ({
    row,
    title: model.options[0]?.considerations[row]?.title ?? "",
  }));

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

// A: one option per row, each carrying one short line per dimension. Nothing
// is cross-referenced - a reader understands an option by reading its own
// block - at the cost of repeating the dimension labels once per option.
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
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className="text-base font-semibold text-ink"
                data-option-title=""
                id={option.titleId}
              >
                {option.title}
              </span>
              {option.recommended ? <Recommended /> : null}
            </span>
            <span className="decision-row-lines mt-1.5 grid gap-0.5">
              {criteria.map(({ row, title }) => (
                <span className="decision-row-line" key={row}>
                  <span className="decision-row-dimension text-muted">
                    {title}
                  </span>
                  <span className="decision-verdict font-semibold text-ink">
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

// B: the column matrix, which states each dimension once instead of once per
// option, with hard surface boundaries between asking, choosing, and
// comparing. Cheaper to read down a dimension, dearer to read one option.
export const MatrixLayout = ({
  model,
  answerable,
}: {
  readonly model: CompiledDecision;
  readonly answerable: boolean;
}) => {
  const criteria = criteriaOf(model);
  return (
    <ComparisonMatrix className="decision-matrix">
      <thead>
        <tr className="decision-chooser-row">
          <th className="decision-corner px-4 py-3.5 text-left" scope="col">
            <span className="sr-only">{"Criterion"}</span>
          </th>
          {model.options.map((option, index) => (
            <th
              className="decision-column p-0 align-bottom"
              key={option.id}
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
                  <Radio
                    option={option}
                    index={index}
                    groupName={model.id}
                    answerable={answerable}
                  />
                  <span
                    className="text-base leading-6 font-semibold text-ink"
                    data-option-title=""
                    id={option.titleId}
                  >
                    {option.title}
                  </span>
                </span>
                {option.recommended ? <Recommended /> : null}
              </label>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {criteria.map(({ row, title }) => (
          <tr className="comparison-matrix-row" key={row}>
            <th
              className="decision-criterion px-4 py-3 text-left text-base leading-6 font-medium text-muted"
              scope="row"
            >
              {title}
            </th>
            {model.options.map((option, index) => (
              <td
                className="decision-cell px-4 py-3"
                key={option.id}
                data-decision-column={index}
              >
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

// The comparison a reader opens rather than answers: same shape as the matrix,
// no controls, so it can sit inside another layout without emitting a second
// radio group with duplicate ids.
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
        {criteria.map(({ row, title }) => (
          <tr className="comparison-matrix-row" key={row}>
            <th
              className="decision-criterion px-4 py-2.5 text-left text-base leading-6 font-medium text-muted"
              scope="row"
            >
              {title}
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

// C: the question, the choices, and the one sentence that decides it. The
// comparison exists but starts closed, because a reader who agrees with the
// recommendation should not have to read a grid to say so.
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
          className="decision-brief-lead m-0 px-5 pb-3 text-base text-ink"
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
      <details className="decision-brief-compare px-5 pt-1 pb-4">
        <summary className="decision-details-summary w-fit cursor-pointer rounded-sm text-sm font-semibold">
          {"Compare all three"}
        </summary>
        <div className="decision-brief-compare-body mt-3">
          <ReadOnlyComparison model={model} />
        </div>
      </details>
    </div>
  );
};
