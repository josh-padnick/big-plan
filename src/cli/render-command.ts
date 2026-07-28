// Implements `big-plan render <input.mdx> [output.html] [--renderer
// vanilla|react]`: the I/O boundary around the pure renderer, owning argument
// validation, file reads/writes, and the structured result runAxiCli() prints.
// Content decisions, including the document title, belong to the renderer.

import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import type { RendererKind } from "../render/render-document.js";
import {
  MarkdownDiagnosticsError,
  renderDocument,
} from "../render/render-document.js";
import { createOutputPathGuard } from "./output-path-guard.js";

const USAGE =
  "Usage: big-plan render <input.mdx> [output.html] [--renderer vanilla|react]";

// Splits --renderer out of the positional arguments. The flag selects the
// in-progress React SSR target; every built-in component has a byte-parity
// React renderer, while the vanilla fallback remains until the default flips.
const parseRenderArgs = (
  args: ReadonlyArray<string>,
): {
  readonly positional: ReadonlyArray<string>;
  readonly renderer: RendererKind;
} => {
  const positional: Array<string> = [];
  let renderer: RendererKind = "vanilla";
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === undefined) {
      index += 1;
      continue;
    }
    if (arg === "--renderer" && args[index + 1] === undefined) {
      throw new AxiError("Missing value for --renderer", "VALIDATION_ERROR", [
        USAGE,
      ]);
    }
    const value =
      arg === "--renderer"
        ? args[index + 1]
        : arg.startsWith("--renderer=")
          ? arg.slice("--renderer=".length)
          : undefined;
    if (value === undefined) {
      positional.push(arg);
      index += 1;
      continue;
    }
    if (value !== "vanilla" && value !== "react") {
      throw new AxiError(
        `Unknown renderer "${value}" - expected vanilla or react`,
        "VALIDATION_ERROR",
        [USAGE],
      );
    }
    renderer = value;
    index += arg === "--renderer" ? 2 : 1;
  }
  return { positional, renderer };
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
  const { positional, renderer } = parseRenderArgs(args);
  const inputArg = positional[0];
  if (inputArg === undefined) {
    throw new AxiError("Missing input MDX file", "VALIDATION_ERROR", [USAGE]);
  }

  const inputPath = resolve(inputArg);
  const outputPath = resolve(positional[1] ?? defaultOutputPath(inputPath));
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
      renderer,
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
