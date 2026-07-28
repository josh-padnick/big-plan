// Owns the uppercase tinted pill shared by protocol and decision cards.

const PILL_CLASSES =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] leading-4 font-bold uppercase";

/** Renders one uppercase pill carrying the caller's palette classes. */
export const BadgePill = ({
  label,
  classNames = [],
  dataProperties = {},
}: {
  readonly label: string;
  readonly classNames?: ReadonlyArray<string>;
  readonly dataProperties?: Readonly<Record<string, string>>;
}) => (
  <span
    className={[...PILL_CLASSES.split(" "), ...classNames].join(" ")}
    {...dataProperties}
  >
    {label}
  </span>
);
