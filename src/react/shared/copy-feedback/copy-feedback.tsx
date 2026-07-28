// The React port of the transient copy-feedback slot shared by figure
// headers; class-for-class with the vanilla shared piece, held identical by
// the parity tests until the vanilla renderer is deleted.

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
