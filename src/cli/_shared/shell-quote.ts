// Single-quote shell quoting for commands the CLI asks a human to paste.
// Emitted commands are pasted, never retyped, so every quoted value must be
// correct byte-for-byte in a real shell AND must survive structured-output
// serialization verbatim: values quoted here contain no double quotes, the
// one character that forces the TOON encoder to add display-only backslash
// escapes that break when pasted.

/** Quotes one value so POSIX shells and zsh read it back as a single word. */
export const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;
