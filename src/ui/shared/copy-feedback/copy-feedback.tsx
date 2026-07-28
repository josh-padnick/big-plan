// Owns the hidden copy-feedback slot reserved for live review figure headers.

/** Renders one hidden feedback slot keyed by its component data attribute. */
export const CopyFeedback = ({
  dataAttribute,
}: {
  readonly dataAttribute: string;
}) => (
  // The trailing margin keeps the message clear of the actions button beside
  // it, on top of the header controls' own tight gap.
  <span
    className="code-copy-message static mr-1.5 flex h-6 items-center text-[0.6875rem] leading-tight font-medium whitespace-nowrap text-muted"
    aria-hidden="true"
    {...{ [dataAttribute]: "" }}
    hidden
  >
    Copied!
  </span>
);
