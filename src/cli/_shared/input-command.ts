// Owns shared CLI input policy: positional arguments, UTF-8 reads, fallback
// titles, and renderer diagnostic translation before command-specific work.

import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import { MarkdownDiagnosticsError } from "../../render/render-document.js";

type DerivationInput = {
  readonly markdown: string;
  readonly fallbackTitle: string;
  // Derivations that stamp a document identity need the authoritative source
  // path as well as its content.
  readonly inputPath: string;
};

/** Parses one required input plus a command-defined number of trailing args. */
export const parseInputCommandArguments = ({
  args,
  usage,
  maximumArguments,
}: {
  readonly args: ReadonlyArray<string>;
  readonly usage: string;
  readonly maximumArguments: number;
}): {
  readonly inputPath: string;
  readonly trailingArgs: ReadonlyArray<string>;
} => {
  for (const arg of args) {
    if (arg.startsWith("-")) {
      throw new AxiError(`Unknown option "${arg}"`, "VALIDATION_ERROR", [
        usage,
      ]);
    }
  }
  if (args.length > maximumArguments) {
    throw new AxiError(
      `Unexpected extra argument "${args[maximumArguments] ?? ""}"`,
      "VALIDATION_ERROR",
      [usage],
    );
  }
  const inputArg = args[0];
  if (inputArg === undefined) {
    throw new AxiError("Missing input MDX file", "VALIDATION_ERROR", [usage]);
  }
  return {
    inputPath: resolve(inputArg),
    trailingArgs: args.slice(1),
  };
};

const diagnosticDetails = (error: MarkdownDiagnosticsError): Array<string> =>
  error.diagnostics.map(
    ({ line, column, message }) => `${line ?? "?"}:${column ?? "?"} ${message}`,
  );

/** Reads and derives one plan while preserving the shared structured errors. */
export const deriveInputFile = async <Derived>({
  inputPath,
  usage,
  invalidDocumentMessage,
  derive,
}: {
  readonly inputPath: string;
  readonly usage: string;
  readonly invalidDocumentMessage: string;
  readonly derive: (input: DerivationInput) => Derived;
}): Promise<{ readonly markdown: string; readonly derived: Derived }> => {
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

  try {
    return {
      markdown,
      derived: derive({
        markdown,
        fallbackTitle: basename(inputPath, extname(inputPath)),
        inputPath,
      }),
    };
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
};
