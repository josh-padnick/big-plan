// Owns the shared safe lifecycle for CLI commands that derive one file from
// authored MDX: arguments, paths, reads, diagnostics, guarded writes, results.

import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import { MarkdownDiagnosticsError } from "../render/render-document.js";
import { parsePositionalArguments } from "./command-arguments.js";
import { createOutputPathGuard } from "./output-path-guard.js";

type DerivationInput = {
  readonly markdown: string;
  readonly fallbackTitle: string;
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

const diagnosticDetails = (error: MarkdownDiagnosticsError): Array<string> =>
  error.diagnostics.map(
    ({ line, column, message }) => `${line ?? "?"}:${column ?? "?"} ${message}`,
  );

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
  serialize,
  result,
}: {
  readonly args: ReadonlyArray<string>;
  readonly usage: string;
  readonly outputSuffix: string;
  readonly invalidDocumentMessage: string;
  readonly derive: (input: DerivationInput) => Derived;
  readonly serialize: (derived: Derived) => string;
  readonly result: (input: {
    readonly derived: Derived;
    readonly outputPath: string;
  }) => Record<string, unknown>;
}): Promise<Record<string, unknown>> => {
  const { inputArg, outputArg } = parsePositionalArguments({ args, usage });
  if (inputArg === undefined) {
    throw new AxiError("Missing input MDX file", "VALIDATION_ERROR", [usage]);
  }

  const inputPath = resolve(inputArg);
  const outputPath = resolve(
    outputArg ?? defaultOutputPath({ inputPath, suffix: outputSuffix }),
  );
  const writeGuardedOutput = createOutputPathGuard({
    inputPath,
    outputPath,
    usage,
  });

  let markdown: string;
  try {
    markdown = await readFile(inputPath, "utf8");
  } catch {
    throw new AxiError(
      `Cannot read input file: ${inputPath}`,
      "INPUT_NOT_FOUND",
      [usage],
    );
  }

  let derived: Derived;
  try {
    derived = derive({
      markdown,
      fallbackTitle: basename(inputPath, extname(inputPath)),
    });
  } catch (error: unknown) {
    if (!(error instanceof MarkdownDiagnosticsError)) {
      throw error;
    }
    throw new AxiError(
      invalidDocumentMessage,
      "VALIDATION_ERROR",
      diagnosticDetails(error),
    );
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeGuardedOutput(serialize(derived));
  return result({ derived, outputPath });
};
