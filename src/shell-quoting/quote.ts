// The one owner of POSIX-shell argument quoting.
//
// Big Plan hands people commands to run - in terminal output, in agent
// guidance, and on the pages the local service serves - and every one of them
// carries a filesystem path a user chose. A path with a space in it is the
// ordinary case that breaks a copied command, so the quoting rule lives here
// rather than at each surface, where two copies would drift and only one of
// them would be fixed.

/** Quotes trusted text as one literal POSIX-shell argument. */
export const quoteShellArgument = (value: string): string =>
  `'${value.replaceAll("'", `'"'"'`)}'`;

// Word characters plus the punctuation a POSIX shell passes through untouched.
// Anything outside it - a space, a quote, a glob character - would be split or
// interpreted, so it earns quotes.
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/u;

/**
 * Quotes only when the shell would otherwise split or interpret the value.
 *
 * For a surface where the command is also something a person reads, quoting a
 * path that never needed it is noise; quoting one that did is the difference
 * between a command that runs and one that does not.
 */
export const quoteShellArgumentIfNeeded = (value: string): string =>
  SHELL_SAFE.test(value) ? value : quoteShellArgument(value);
