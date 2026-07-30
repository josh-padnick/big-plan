// Renders a compiled Decision as stacked option cards: each option carries
// its considerations as scannable title-verdict lines, so a reviewer reads
// one option in full instead of cross-referencing a matrix.

import type {
  CompiledDecision,
  CompiledDecisionConsideration,
  CompiledDecisionOption,
} from "./compile.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";

const TONE_CLASSES = {
  good: "decision-verdict-good",
  bad: "decision-verdict-bad",
  mixed: "decision-verdict-mixed",
  neutral: "decision-verdict-neutral",
} as const;

const Consideration = ({
  consideration,
}: {
  readonly consideration: CompiledDecisionConsideration;
}) => (
  <li className="m-0 leading-relaxed">
    <span className="font-semibold text-ink">{consideration.title}:</span>{" "}
    <span className={`decision-verdict ${TONE_CLASSES[consideration.tone]}`}>
      {consideration.verdict}.
    </span>
    {consideration.detail.length === 0 ? null : (
      <span className="text-muted">
        {" "}
        {hastContentToReact(consideration.detail)}
      </span>
    )}
  </li>
);

const OptionCard = ({
  option,
}: {
  readonly option: CompiledDecisionOption;
}) => (
  <section
    data-decision-option
    {...(option.recommended ? { "data-option-recommended": "" } : {})}
    className="decision-option mb-4 rounded-lg border border-edge px-5 py-4 last:mb-0"
  >
    <header className="mb-1 flex flex-wrap items-center gap-x-3">
      <h4 className="m-0 text-lg font-semibold">{option.title}</h4>
      {option.recommended ? (
        <span className="decision-recommended-pill rounded-full px-2 py-0.5 text-xs font-semibold">
          Recommended
        </span>
      ) : null}
    </header>
    {option.summary === undefined ? null : (
      <p className="mb-0 text-muted">{option.summary}</p>
    )}
    <ul className="mt-3 mb-0 list-none space-y-2 border-t border-edge p-0 pt-3 text-[0.9375rem]">
      {option.considerations.map((consideration, index) => (
        <Consideration key={index} consideration={consideration} />
      ))}
    </ul>
    {option.detail.length === 0 ? null : (
      <div className="mt-3 text-[0.9375rem] text-muted [&>:last-child]:mb-0">
        {hastContentToReact(option.detail)}
      </div>
    )}
  </section>
);

export const Decision = ({ model }: { readonly model: CompiledDecision }) => (
  <aside
    data-decision
    data-decision-status={model.status}
    className="mb-6 rounded-lg border border-edge px-5 py-4"
  >
    <header className="mb-2 flex flex-wrap items-baseline gap-x-2">
      <p className="m-0 text-xs font-semibold tracking-[0.08em] uppercase text-muted">
        Decision
      </p>
      <span className="decision-status-pill rounded-full px-2 py-0.5 text-xs font-medium">
        {model.status}
      </span>
    </header>
    <h3 className="mt-0 mb-2 text-2xl font-bold">{model.question}</h3>
    {model.context.length === 0 ? null : (
      <div className="mb-4 text-muted [&>:last-child]:mb-0">
        {hastContentToReact(model.context)}
      </div>
    )}
    {model.options.map((option, index) => (
      <OptionCard key={index} option={option} />
    ))}
  </aside>
);
