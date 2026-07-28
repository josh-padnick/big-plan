// Renders one weighty decision as a standalone comparison card: options,
// criteria, verdict disclosures, the decided outcome, and reversibility.
// Every id flows from the compiled model for stable anchors and hydration.

import type { ElementContent } from "hast";
import type { ReactNode } from "react";
import type {
  BigDecisionReversibilityRating,
  BigDecisionStatus,
  BigDecisionTone,
  CompiledBigDecision,
  CompiledBigDecisionCriterion,
  CompiledBigDecisionOption,
  CompiledBigDecisionReversibility,
  CompiledBigDecisionScore,
} from "../../model/compile-big-decision.js";
import { CHECK_ICON } from "../../render/icons/lucide/check.js";
import { CIRCLE_QUESTION_MARK_ICON } from "../../render/icons/lucide/circle-question-mark.js";
import { INFO_ICON } from "../../render/icons/lucide/info.js";
import { MAXIMIZE_2_ICON } from "../../render/icons/lucide/maximize-2.js";
import { MINIMIZE_2_ICON } from "../../render/icons/lucide/minimize-2.js";
import { MINUS_ICON } from "../../render/icons/lucide/minus.js";
import { TRIANGLE_ALERT_ICON } from "../../render/icons/lucide/triangle-alert.js";
import { UNDO_2_ICON } from "../../render/icons/lucide/undo-2.js";
import { X_ICON } from "../../render/icons/lucide/x.js";
import type { LucideIcon } from "../../render/icons/lucide-icon.js";
import { hastContentToReact } from "../hast-content.js";
import { lucideIconToReact } from "../lucide-icon.js";
import { BadgePill } from "../shared/badge-pill/badge-pill.js";
import {
  CardSection,
  SectionLabel,
} from "../shared/labeled-section/labeled-section.js";

const TONE_ICONS = {
  good: CHECK_ICON,
  bad: X_ICON,
  mixed: TRIANGLE_ALERT_ICON,
  neutral: MINUS_ICON,
} satisfies Record<BigDecisionTone, typeof CHECK_ICON>;

// Full screen stays reserved for the live review application; the in-column
// matrix scrolls horizontally, so the inert document loses nothing.
// Matches the file-tree control look so figure chrome reads as one family.
const ExpandButton = () => (
  <button
    type="button"
    className="big-decision-expand inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5"
    aria-label="View decision full screen"
    title="View decision full screen"
    hidden
    data-decision-expand=""
  >
    {lucideIconToReact({ icon: MAXIMIZE_2_ICON, hidden: false })}
    {lucideIconToReact({ icon: MINIMIZE_2_ICON, hidden: true })}
  </button>
);

const StatusPill = ({ status }: { readonly status: BigDecisionStatus }) => (
  <BadgePill
    label={status}
    classNames={["big-decision-status-pill", `big-decision-status-${status}`]}
    dataProperties={{ "data-decision-status": status }}
  />
);

// A native inline disclosure behind the info glyph: opening it expands the
// owning cell in place, which survives the matrix's scroll container where a
// floating popover would clip.
const InfoDisclosure = ({
  detail,
  icon = INFO_ICON,
}: {
  readonly detail: ReadonlyArray<ElementContent>;
  readonly icon?: LucideIcon;
}) =>
  detail.length === 0 ? null : (
    <details className="big-decision-info">
      <summary className="inline-flex cursor-pointer align-middle text-muted [&>svg]:size-3.5">
        {lucideIconToReact({ icon, hidden: false })}
        <span className="sr-only">{"More detail"}</span>
      </summary>
      <div className="big-decision-info-body max-w-60 text-xs font-normal text-muted [&>:last-child]:mb-0">
        {hastContentToReact(detail)}
      </div>
    </details>
  );

const OptionMarker = ({ chosen }: { readonly chosen: boolean }) => (
  <span
    className={[
      "big-decision-option-marker",
      ...(chosen ? ["big-decision-option-marker-chosen"] : []),
      "inline-flex",
      "size-5",
      "shrink-0",
      "items-center",
      "justify-center",
      "rounded-full",
      "border",
      "[&_svg]:size-3",
    ].join(" ")}
    data-option-control=""
    aria-hidden="true"
  >
    {chosen ? lucideIconToReact({ icon: CHECK_ICON, hidden: false }) : null}
  </span>
);

// One option header card: the option identity a reader evaluates, whether it
// sits at the top of a matrix column or in the no-criteria stacked fallback.
const OptionHead = ({
  option,
  muted,
}: {
  readonly option: CompiledBigDecisionOption;
  readonly muted: boolean;
}) => (
  <div
    id={option.id}
    className={[
      "big-decision-option",
      ...(option.chosen ? ["big-decision-option-chosen"] : []),
      ...(muted ? ["big-decision-option-muted"] : []),
      "flex",
      "flex-1",
      "min-w-44",
      "items-start",
      "gap-2.5",
      "rounded-md",
      "border",
      "border-edge",
      "bg-surface",
      "px-3",
      "py-2.5",
      "text-left",
      "font-normal",
    ].join(" ")}
    data-option=""
    {...(option.recommended ? { "data-option-recommended": "" } : {})}
    {...(option.chosen ? { "data-option-chosen": "" } : {})}
  >
    <OptionMarker chosen={option.chosen} />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p
          id={option.titleId}
          className="m-0 text-sm font-semibold text-ink"
          data-option-title=""
        >
          {option.title}
        </p>
      </div>
      {option.summary === undefined ? null : (
        <p
          id={option.summaryId}
          className="mt-1 mb-0 text-sm text-muted"
          data-option-description=""
        >
          {option.summary}
        </p>
      )}
      {option.detail.length === 0 ? null : (
        <details
          className="big-decision-details mt-1.5"
          data-option-details={option.id}
        >
          <summary className="cursor-pointer text-xs font-semibold text-muted">
            {"Details"}
          </summary>
          <div
            id={option.detailId}
            className="mt-1.5 text-xs text-muted [&>:last-child]:mb-0"
            data-option-description=""
          >
            {hastContentToReact(option.detail)}
          </div>
        </details>
      )}
    </div>
  </div>
);

// Status pills decorate the option from above its box: Recommended is
// server-rendered, and the runtime Best match tag joins the same row. Matrix
// columns always reserve the row so cards top-align.
const OptionColumn = ({
  option,
  muted,
  reserveDecorators,
}: {
  readonly option: CompiledBigDecisionOption;
  readonly muted: boolean;
  readonly reserveDecorators: boolean;
}) => (
  <div className="flex h-full min-w-0 flex-col">
    {reserveDecorators || option.recommended ? (
      <div
        className="big-decision-option-decorators mb-1 flex min-h-[1.375rem] flex-wrap items-center gap-1.5"
        data-option-decorators=""
      >
        {option.recommended ? (
          <BadgePill
            label="Recommended"
            classNames={["big-decision-recommended-pill"]}
          />
        ) : null}
      </div>
    ) : null}
    <OptionHead option={option} muted={muted} />
  </div>
);

const ScoreCell = ({
  score,
}: {
  readonly score: CompiledBigDecisionScore | undefined;
}) => (
  <td
    className="align-top px-3 py-2.5"
    {...(score === undefined ? {} : { "data-score-tone": score.tone })}
  >
    {score === undefined ? (
      "-"
    ) : (
      <div
        className={`big-decision-tone-${score.tone} flex items-start gap-1.5 [&>svg]:mt-[calc((1lh-0.875rem)/2)] [&>svg]:size-3.5 [&>svg]:shrink-0`}
      >
        {lucideIconToReact({ icon: TONE_ICONS[score.tone], hidden: false })}
        <span className="sr-only">{`Tone: ${score.tone}.`}</span>
        <span className="min-w-0">
          {score.verdict}
          {score.detail.length === 0 ? null : " "}
          <InfoDisclosure detail={score.detail} />
        </span>
      </div>
    )}
  </td>
);

const CriterionHeader = ({
  criterion,
}: {
  readonly criterion: CompiledBigDecisionCriterion;
}) => (
  <th
    scope="row"
    id={criterion.id}
    className="big-decision-criterion min-w-36 align-top px-3 py-2.5 text-left text-sm font-medium text-ink"
  >
    {criterion.detail.length === 0 ? (
      criterion.title
    ) : (
      <details className="big-decision-info big-decision-criterion-help">
        <summary className="cursor-help">{criterion.title}</summary>
        <div className="big-decision-info-body max-w-60 text-xs font-normal text-muted [&>:last-child]:mb-0">
          {hastContentToReact(criterion.detail)}
        </div>
      </details>
    )}
  </th>
);

// The comparison matrix: criteria as rows, options as columns, so competing
// cells sit side by side instead of a serial scroll apart.
const Matrix = ({ model }: { readonly model: CompiledBigDecision }) => (
  <div
    data-table-scroll-container=""
    className="relative mt-2.5 overflow-x-auto"
  >
    <table className="big-decision-matrix w-full border-collapse">
      <thead>
        <tr>
          <th scope="col" className="px-3 py-1.5 text-left">
            <span className="sr-only">{"Criterion"}</span>
          </th>
          {model.options.map((option) => (
            <th key={option.id} scope="col" className="px-1.5 py-1.5 align-top">
              <OptionColumn
                option={option}
                muted={model.status === "decided" && !option.chosen}
                reserveDecorators
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {model.criteria.map((criterion, index) => (
          <tr key={criterion.id} className="big-decision-matrix-row">
            <CriterionHeader criterion={criterion} />
            {model.options.map((option) => (
              <ScoreCell key={option.id} score={option.scores[index]} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// The stacked fallback when a decision declares no criteria: option identity
// cards without a comparison surface.
const OptionStack = ({ model }: { readonly model: CompiledBigDecision }) => (
  <div className="mt-2.5 grid gap-2.5">
    {model.options.map((option) => (
      <OptionColumn
        key={option.id}
        option={option}
        muted={model.status === "decided" && !option.chosen}
        reserveDecorators={false}
      />
    ))}
  </div>
);

const OutcomeStrip = ({
  option,
}: {
  readonly option: CompiledBigDecisionOption;
}) => (
  <div
    className="big-decision-outcome mx-4 mb-4 flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold [&_svg]:size-4 [&_svg]:shrink-0"
    data-decision-outcome=""
  >
    {lucideIconToReact({ icon: CHECK_ICON, hidden: false })}
    {`Chosen: ${option.title}`}
  </div>
);

const REVERSIBILITY_PHRASES = {
  easy: "Easy to reverse",
  "somewhat-hard": "Somewhat hard to reverse",
  hard: "Hard to reverse",
} satisfies Record<BigDecisionReversibilityRating, string>;

// One fixed explanation ships with the component so every decision teaches
// the field the same way; authored bodies carry the decision-specific why.
const REVERSIBILITY_EXPLAINER =
  "Reversibility is what it would cost to change this decision after implementation starts. Hard-to-reverse choices deserve the most scrutiny now; easy ones can be settled quickly and revisited once there is evidence.";

const explainerParagraph = (): ReadonlyArray<ElementContent> => [
  {
    type: "element",
    tagName: "p",
    properties: {},
    children: [{ type: "text", value: REVERSIBILITY_EXPLAINER }],
  },
];

// The cost of changing course later gets its own section under the options:
// a fixed rating vocabulary keeps decisions comparable, and the info
// disclosure explains why the field exists at all.
const ReversibilitySection = ({
  reversibility,
}: {
  readonly reversibility: CompiledBigDecisionReversibility;
}) => (
  <section
    className="border-t border-edge px-4 py-4"
    data-decision-reversibility=""
    data-reversibility-rating={reversibility.rating}
  >
    {/* leading-none collapses the summary's inherited line box to the icon
        and the 1px nudge optically centers it against the uppercase label,
        whose glyphs ride high in their own line box. */}
    <div className="flex items-center gap-1.5 [&_summary]:leading-none [&_summary]:-mt-[3px]">
      <SectionLabel label="Reversibility" />
      <InfoDisclosure
        detail={explainerParagraph()}
        icon={CIRCLE_QUESTION_MARK_ICON}
      />
    </div>
    <div
      className={`big-decision-reversibility-${reversibility.rating} mt-2.5 flex items-start gap-2 text-sm [&>svg]:mt-[calc((1lh-0.875rem)/2)] [&>svg]:size-3.5 [&>svg]:shrink-0`}
    >
      {lucideIconToReact({ icon: UNDO_2_ICON, hidden: false })}
      <span className="min-w-0">
        <span className="font-semibold text-ink">
          {REVERSIBILITY_PHRASES[reversibility.rating]}
        </span>
        {reversibility.detail.length === 0 ? null : (
          <div className="mt-1 text-muted [&>:last-child]:mb-0">
            {hastContentToReact(reversibility.detail)}
          </div>
        )}
      </span>
    </div>
  </section>
);

const DetailsDrawer = ({
  detail,
}: {
  readonly detail: ReadonlyArray<ElementContent>;
}): ReactNode => (
  <div className="px-4 pb-3.5">
    <details className="big-decision-details" data-decision-details="">
      <summary className="cursor-pointer text-xs font-semibold text-muted">
        {"Details"}
      </summary>
      <div className="mt-2 text-sm text-muted [&>:last-child]:mb-0">
        {hastContentToReact(detail)}
      </div>
    </details>
  </div>
);

export const BigDecision = ({
  model,
}: {
  readonly model: CompiledBigDecision;
}) => (
  <figure
    id={model.id}
    className="big-decision mb-5 min-w-0 overflow-hidden rounded-md border border-edge bg-paper"
    data-big-decision=""
    data-decision-state={model.status}
  >
    <figcaption className="flex items-start justify-between gap-3 bg-header px-4 py-3">
      <div className="min-w-0">
        {model.status === "open" ? null : <StatusPill status={model.status} />}
        <p
          className="mt-2 mb-0 first:mt-0 text-base font-semibold text-ink"
          data-decision-question=""
        >
          {model.question}
        </p>
      </div>
      <ExpandButton />
    </figcaption>
    {model.context.length === 0 ? null : (
      <div className="px-4 py-4 text-sm [&>:last-child]:mb-0">
        {hastContentToReact(model.context)}
      </div>
    )}
    {model.detail.length === 0 ? null : <DetailsDrawer detail={model.detail} />}
    {model.chosenOption === undefined ? null : (
      <OutcomeStrip option={model.chosenOption} />
    )}
    <CardSection dataProperties={{ "data-decision-options": "" }}>
      <SectionLabel label="Options" />
      {model.criteria.length > 0 ? (
        <Matrix model={model} />
      ) : (
        <OptionStack model={model} />
      )}
    </CardSection>
    {model.reversibility === undefined ? null : (
      <ReversibilitySection reversibility={model.reversibility} />
    )}
  </figure>
);
