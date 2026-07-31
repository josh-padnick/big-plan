// Owns the shared safe lifecycle for CLI commands that derive one file from
// authored MDX: arguments, paths, reads, diagnostics, guarded writes, results.

import { mkdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { createGuardedOutputWriter } from "./guarded-output-writer.js";
import {
  deriveInputFile,
  parseInputCommandArguments,
} from "./input-command.js";

type DerivationInput = {
  readonly markdown: string;
  readonly fallbackTitle: string;
  readonly inputPath: string;
};

const defaultOutputPath = ({
  inputPath,
  suffix,
}: {
  readonly inputPath: string;
  readonly suffix: string;
}): string => {
  const extension = extname(inputPath);
  const withoutExtension =
    extension.length > 0 ? inputPath.slice(0, -extension.length) : inputPath;
  return `${withoutExtension}${suffix}`;
};

/**
 * Runs one derived-output command without exposing filesystem sequencing to
 * the output-specific command.
 */
export const runDerivedOutputCommand = async <Derived>({
  args,
  usage,
  outputSuffix,
  invalidDocumentMessage,
  derive,
  verify,
  serialize,
  result,
}: {
  readonly args: ReadonlyArray<string>;
  readonly usage: string;
  readonly outputSuffix: string;
  readonly invalidDocumentMessage: string;
  readonly derive: (input: DerivationInput) => Derived;
  readonly verify?: (input: { readonly markdown: string }) => void;
  readonly serialize: (derived: Derived) => string;
  readonly result: (input: {
    readonly derived: Derived;
    readonly outputPath: string;
  }) => Record<string, unknown>;
}): Promise<Record<string, unknown>> => {
  const { inputPath, trailingArgs } = parseInputCommandArguments({
    args,
    usage,
    maximumArguments: 2,
  });
  const outputArg = trailingArgs[0];
  const outputPath = resolve(
    outputArg ?? defaultOutputPath({ inputPath, suffix: outputSuffix }),
  );
  const writeGuardedOutput = createGuardedOutputWriter({
    inputPath,
    outputPath,
    usage,
  });

  const { markdown, derived } = await deriveInputFile({
    inputPath,
    usage,
    invalidDocumentMessage,
    derive,
  });
  // Verification runs after structural derivation and before any write, so a
  // failing check leaves the filesystem untouched.
  verify?.({ markdown });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeGuardedOutput(serialize(derived));
  return result({ derived, outputPath });
};
