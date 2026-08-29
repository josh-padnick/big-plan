// Owns the Was/Now switch every component diff presents, whether it takes the
// free default presentation or supplies a bespoke one.
//
// The radio lives inside the label it belongs to and fills it. That placement
// is the whole point of this file: a visually hidden radio parked at its own
// layout position is exposed to assistive technology and to automation as a
// 1x1 box sitting under whatever prose happens to occupy that spot, so the node
// the accessibility tree names is not the node a pointer can hit, and a real
// click on it flips nothing. Filling the label with a transparent radio makes
// the exposed node and the drawn control the same box, keeps the label's own
// 44 px touch floor, and puts the toggle in the keyboard order where the reader
// sees it. Nesting also means the sides can no longer be chosen by a sibling
// combinator from the radio, which is why styles.css scopes the checked state
// with :has() instead.

// The phone-sized touch target the repository requires of every control,
// relaxed once the viewport is wide enough for a pointer. The focus ring is
// drawn around the whole group by styles.css, because focus lands on the radio
// rather than on the label that draws the option.
const TOGGLE_OPTION_CLASSES =
  "relative z-10 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent px-4 py-1.5 text-xs font-semibold wide:min-h-8 wide:min-w-0";

// The radio is transparent rather than hidden: opacity keeps it hit-testable,
// which display, visibility, and a clipped 1x1 box all give up.
const TOGGLE_INPUT_CLASSES =
  "absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0 opacity-0 outline-none";

const ToggleOption = ({
  controlId,
  side,
  label,
  toneClassName,
  defaultChecked,
}: {
  readonly controlId: string;
  readonly side: "baseline" | "proposed";
  readonly label: string;
  readonly toneClassName: string;
  readonly defaultChecked?: boolean;
}) => (
  <label
    htmlFor={`${controlId}-${side}`}
    className={`${TOGGLE_OPTION_CLASSES} ${toneClassName}`}
    data-component-diff-label={side}
  >
    <input
      className={TOGGLE_INPUT_CLASSES}
      id={`${controlId}-${side}`}
      name={controlId}
      type="radio"
      data-component-diff-choice={side}
      defaultChecked={defaultChecked}
    />
    {/* The word never takes the pointer: the radio under it is the control,
        and it stays the element a hit test at this box answers with. */}
    <span className="pointer-events-none">{label}</span>
  </label>
);

/** Renders the Was/Now switch for a diff that has both sides to offer. */
export const ComponentDiffToggle = ({
  controlId,
}: {
  // The engine's per-instance key. Two components may share an authored id, so
  // the radio group's form identity comes from the engine rather than the model
  // the view was handed.
  readonly controlId: string;
}) => (
  <div
    className="relative inline-grid grid-cols-2 rounded-full border border-edge bg-surface p-0.5"
    role="group"
    aria-label="Choose Was or Now"
    data-component-diff-toggle=""
  >
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-[var(--diff-add-bg)] transition-[translate] duration-150 ease-out"
      data-component-diff-toggle-thumb=""
    />
    <ToggleOption
      controlId={controlId}
      side="baseline"
      label="Was"
      toneClassName="text-muted"
    />
    <ToggleOption
      controlId={controlId}
      side="proposed"
      label="Now"
      toneClassName="text-[var(--diff-add-c)]"
      defaultChecked
    />
  </div>
);
