/** Quotes trusted text as one literal POSIX-shell argument. */
export const quoteShellArgument = (value: string): string =>
  `'${value.replaceAll("'", `'"'"'`)}'`;
