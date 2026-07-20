// Implements `big-plan render <input.mdx> [output.html]`: the I/O boundary
// around the pure renderer, owning argument validation, file reads/writes,
// and the structured result runAxiCli() prints. Content decisions, including
// the document title, belong to the renderer.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import type { DocumentEnvelope } from "../render/render-document.js";
import {
  MarkdownDiagnosticsError,
  renderDocument,
} from "../render/render-document.js";

const USAGE =
  "Usage: big-plan render <input.mdx> [output.html] [--embed [--theme light|dark]]";

// Separates the render command's flags from its positional paths; the
// envelope's meaning lives in the renderer, so this stays shape validation.
const parseRenderArgs = (
  args: ReadonlyArray<string>,
): {
  readonly positionals: ReadonlyArray<string>;
  readonly envelope: DocumentEnvelope;
} => {
  const positionals: Array<string> = [];
  let embed = false;
  let theme: "light" | "dark" | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--embed") {
      embed = true;
      continue;
    }
    if (arg === "--theme" || arg.startsWith("--theme=")) {
      let value: string | undefined;
      if (arg === "--theme") {
        index += 1;
        value = args[index];
      } else {
        value = arg.slice("--theme=".length);
      }
      if (value !== "light" && value !== "dark") {
        throw new AxiError(
          `--theme must be "light" or "dark", got: ${value ?? "nothing"}`,
          "VALIDATION_ERROR",
          [USAGE],
        );
      }
      theme = value;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [USAGE]);
    }
    positionals.push(arg);
  }
  if (theme !== undefined && !embed) {
    throw new AxiError(
      "--theme requires --embed; the viewer keeps its own theme control",
      "VALIDATION_ERROR",
      [USAGE],
    );
  }
  const envelope: DocumentEnvelope = embed
    ? { mode: "embed", ...(theme === undefined ? {} : { theme }) }
    : { mode: "viewer" };
  return { positionals, envelope };
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
  const { positionals, envelope } = parseRenderArgs(args);
  const inputArg = positionals[0];
  if (inputArg === undefined) {
    throw new AxiError("Missing input MDX file", "VALIDATION_ERROR", [USAGE]);
  }

  const inputPath = resolve(inputArg);
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

  const outputPath = resolve(positionals[1] ?? defaultOutputPath(inputPath));
  let renderedDocument;
  try {
    renderedDocument = renderDocument({
      markdown,
      fallbackTitle: basename(inputPath, extname(inputPath)),
      envelope,
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
  await writeFile(outputPath, html, "utf8");

  return {
    rendered: outputPath,
    title,
    sections: sections.length,
    help: [`Open ${outputPath} in your browser to review the document`],
  };
};
