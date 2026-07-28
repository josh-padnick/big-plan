// Owns the shared CLI positional-argument policy: both commands take one
// input and at most one output, and anything option-shaped is rejected
// rather than silently treated as a path - a dash-prefixed token is always
// a mistake now that no command takes flags.

import { AxiError } from "axi-sdk-js";

/** Validates raw args into [input, output?], rejecting flags and excess. */
export const parsePositionalArguments = ({
  args,
  usage,
}: {
  readonly args: ReadonlyArray<string>;
  readonly usage: string;
}): { readonly inputArg?: string; readonly outputArg?: string } => {
  for (const arg of args) {
    if (arg.startsWith("-")) {
      throw new AxiError(`Unknown option "${arg}"`, "VALIDATION_ERROR", [
        usage,
      ]);
    }
  }
  if (args.length > 2) {
    throw new AxiError(
      `Unexpected extra argument "${args[2] ?? ""}"`,
      "VALIDATION_ERROR",
      [usage],
    );
  }
  return {
    ...(args[0] === undefined ? {} : { inputArg: args[0] }),
    ...(args[1] === undefined ? {} : { outputArg: args[1] }),
  };
};
