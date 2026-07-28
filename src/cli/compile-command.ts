// Implements `big-plan compile <input.mdx> [output.json]`: the I/O boundary
// around the pure plan-model compiler, owning argument validation, file
// reads/writes, and the structured result runAxiCli() prints. The emitted
// JSON is the same validated model the renderer consumes, so structure can
// never drift from rendering.

import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import { parsePositionalArguments } from "./command-arguments.js";
import {
  MarkdownDiagnosticsError,
  compilePlanModel,
} from "../render/render-document.js";
import { createOutputPathGuard } from "./output-path-guard.js";

const USAGE = "Usage: big-plan compile <input.mdx> [output.json]";

// Defaults the output to sit next to the input: <input>.model.json.
const defaultOutputPath = (inputPath: string): string => {
  const extension = extname(inputPath);
  const withoutExtension =
    extension.length > 0 ? inputPath.slice(0, -extension.length) : inputPath;
  return `${withoutExtension}.model.json`;
};

// Reads the input MDX, compiles the validated plan model, writes it as JSON,
// and returns the structured summary runAxiCli() serializes for the caller.
export const compileCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  const { inputArg, outputArg } = parsePositionalArguments({
    args,
    usage: USAGE,
  });
  if (inputArg === undefined) {
    throw new AxiError("Missing input MDX file", "VALIDATION_ERROR", [USAGE]);
  }

  const inputPath = resolve(inputArg);
  const outputPath = resolve(outputArg ?? defaultOutputPath(inputPath));
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

  let model;
  try {
    model = compilePlanModel({
      markdown,
      fallbackTitle: basename(inputPath, extname(inputPath)),
    });
  } catch (error: unknown) {
    if (!(error instanceof MarkdownDiagnosticsError)) {
      throw error;
    }
    throw new AxiError(
      "Cannot compile document with invalid MDX",
      "VALIDATION_ERROR",
      error.diagnostics.map(
        ({ line, column, message }) =>
          `${line ?? "?"}:${column ?? "?"} ${message}`,
      ),
    );
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeGuardedOutput(`${JSON.stringify(model, null, 2)}\n`);

  return {
    compiled: outputPath,
    title: model.title,
    sections: model.sections.length,
    components: model.components.length,
    help: [
      `The JSON at ${outputPath} holds the validated plan model: title, section outline, and every component instance's compiled model in document order`,
    ],
  };
};
