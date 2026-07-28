// Implements `big-plan render <input.mdx> [output.html]`: the I/O boundary
// around the pure renderer, owning argument validation, file reads/writes,
// and the structured result runAxiCli() prints. Content decisions, including
// the document title, belong to the renderer.

import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import {
  MarkdownDiagnosticsError,
  renderDocument,
} from "../render/render-document.js";
import { createOutputPathGuard } from "./output-path-guard.js";

const USAGE = "Usage: big-plan render <input.mdx> [output.html]";

// Validates the command's option-free, two-position argument contract.
const validateArgs = (args: ReadonlyArray<string>): void => {
  const unknownOption = args.find((arg) => arg.startsWith("-") && arg !== "-");
  if (unknownOption !== undefined) {
    throw new AxiError(
      `Unknown option "${unknownOption}"`,
      "VALIDATION_ERROR",
      [USAGE],
    );
  }
  if (args.length > 2) {
    throw new AxiError("Too many arguments", "VALIDATION_ERROR", [USAGE]);
  }
};

// Defaults the output to sit next to the input: <input>.html.
const defaultOutputPath = (inputPath: string): string => {
  const extension = extname(inputPath);
  const withoutExtension =
    extension.length > 0 ? inputPath.slice(0, -extension.length) : inputPath;
  return `${withoutExtension}.html`;
};

// Reads the input MDX, renders the viewer HTML, writes it out, and
// returns the structured summary runAxiCli() serializes for the caller.
export const renderCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  validateArgs(args);
  const inputArg = args[0];
  if (inputArg === undefined) {
    throw new AxiError("Missing input MDX file", "VALIDATION_ERROR", [USAGE]);
  }

  const inputPath = resolve(inputArg);
  const outputPath = resolve(args[1] ?? defaultOutputPath(inputPath));
  const writeGuardedOutput = createOutputPathGuard({
    inputPath,
    outputPath,
    usage: USAGE,
  });

  let markdown: string;
  try {
    markdown = await readFile(inputPath, "utf8");
  } catch {
    throw new AxiError(
      `Cannot read input file: ${inputPath}`,
      "INPUT_NOT_FOUND",
      [USAGE],
    );
  }

  let renderedDocument;
  try {
    renderedDocument = renderDocument({
      markdown,
      fallbackTitle: basename(inputPath, extname(inputPath)),
    });
  } catch (error: unknown) {
    if (!(error instanceof MarkdownDiagnosticsError)) {
      throw error;
    }
    throw new AxiError(
      "Cannot render document with invalid MDX",
      "VALIDATION_ERROR",
      error.diagnostics.map(
        ({ line, column, message }) =>
          `${line ?? "?"}:${column ?? "?"} ${message}`,
      ),
    );
  }
  const { html, title, sections } = renderedDocument;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeGuardedOutput(html);

  return {
    rendered: outputPath,
    title,
    sections: sections.length,
    help: [`Open ${outputPath} in your browser to review the document`],
  };
};
