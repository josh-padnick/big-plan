// The Decision comparison shapes under evaluation. They render the same
// compiled decision and differ only in how much the reader must hold to
// answer, which is the axis they are being judged on.
//
// Every shape obeys two reductions the round-4 review asked for. A verdict is
// one signal - the word - because an icon and a colour saying the same thing
// are two more marks to process and nothing more to learn. And a criterion
// every option scores identically cannot inform a choice, so it never renders;
// the model marks which positions actually discriminate.

import type { CompiledDecision, CompiledDecisionOption } from "./compile.js";
import { ComparisonMatrix } from "../_shared/comparison-matrix/comparison-matrix.js";
import { BadgePill } from "../_shared/badge-pill/badge-pill.js";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";

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
              {criteria.map(({ row, title }) => (
                <span className="decision-row-line" key={row}>
                  <span className="decision-row-dimension font-semibold text-ink">
                    {`${title}:`}
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

// Round 5 / matrix 1: keep the familiar orientation and spend more horizontal
// space on it. The figure itself breaks beyond the reading measure; the table
// remains the same shared primitive and interaction model.
export const WideMatrixLayout = ({
  model,
  answerable,
}: {
  readonly model: CompiledDecision;
  readonly answerable: boolean;
}) => <MatrixLayout model={model} answerable={answerable} />;

// Round 5 / matrix 2: transpose the grid. Full option names now own the roomy
// row-header axis, while short criterion names span the columns.
export const TransposedMatrixLayout = ({
  model,
  answerable,
}: {
  readonly model: CompiledDecision;
  readonly answerable: boolean;
}) => {
  const criteria = criteriaOf(model);
  return (
    <ComparisonMatrix className="decision-matrix decision-matrix-transposed">
      <thead>
        <tr className="decision-chooser-row">
          <th
            className="decision-transposed-corner px-4 py-3 text-left text-sm font-medium text-muted"
            scope="col"
          >
            {"Option"}
          </th>
          {criteria.map(({ row, title }) => (
            <th
              className="decision-transposed-criterion px-4 py-3 text-left text-sm leading-5 font-medium text-muted"
              key={row}
              scope="col"
            >
              {title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {model.options.map((option, index) => (
          <tr className="comparison-matrix-row" key={option.id}>
            <th
              className="decision-transposed-option p-0 text-left"
              scope="row"
              data-decision-column={index}
              {...(option.recommended ? { "data-option-recommended": "" } : {})}
              {...(option.chosen ? { "data-option-chosen": "" } : {})}
            >
              <label
                className="decision-transposed-head flex cursor-pointer items-start gap-2 px-4 py-3"
                htmlFor={option.id}
              >
                <Radio
                  option={option}
                  index={index}
                  groupName={model.id}
                  answerable={answerable}
                />
                <span className="min-w-0">
                  <span
                    className="block text-base leading-6 font-semibold text-ink"
                    data-option-title=""
                    id={option.titleId}
                  >
                    {option.title}
                  </span>
                  {option.recommended ? (
                    <span className="mt-1.5 inline-flex">
                      <Recommended />
                    </span>
                  ) : null}
                </span>
              </label>
            </th>
            {criteria.map(({ row }) => (
              <td
                className="decision-transposed-cell px-4 py-3"
                key={row}
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

const optionKey = (index: number): string =>
  String.fromCharCode("A".charCodeAt(0) + index);

// Round 5 / matrix 3: separate choosing from comparing. A full-width option
// rail preserves every name; compact letter keys then keep the grid itself
// airy without inventing abbreviations for author-owned option titles.
export const KeyedMatrixLayout = ({
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
          {criteria.map(({ row, title }) => (
            <tr className="comparison-matrix-row" key={row}>
              <th
                className="decision-criterion px-4 py-3 text-left text-sm leading-5 font-medium text-muted"
                scope="row"
              >
                {title}
              </th>
              {model.options.map((option, index) => (
                <td
                  className="decision-cell px-4 py-3 text-center"
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
    </div>
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
    </div>
  );
};
