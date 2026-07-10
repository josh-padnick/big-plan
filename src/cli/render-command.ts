// Implements `grandplan render <input.md> [output.html]`: the I/O boundary
// around the pure renderer, owning argument validation, file reads/writes,
// and the structured result runAxiCli() prints. Content decisions, including
// the document title, belong to the renderer.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import { renderDocument } from "../render/render-document.js";

const USAGE = "Usage: grandplan render <input.md> [output.html]";

// Defaults the output to sit next to the input: <input>.html.
const defaultOutputPath = (inputPath: string): string => {
  const extension = extname(inputPath);
  const withoutExtension =
    extension.length > 0 ? inputPath.slice(0, -extension.length) : inputPath;
  return `${withoutExtension}.html`;
};

// Reads the input markdown, renders the viewer HTML, writes it out, and
// returns the structured summary runAxiCli() serializes for the caller.
export const renderCommand = async (
  args: ReadonlyArray<string>,
): Promise<Record<string, unknown>> => {
  const inputArg = args[0];
  if (inputArg === undefined) {
    throw new AxiError("Missing input markdown file", "VALIDATION_ERROR", [
      USAGE,
    ]);
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

  const outputPath = resolve(args[1] ?? defaultOutputPath(inputPath));
  const { html, title, sections } = renderDocument({
    markdown,
    fallbackTitle: basename(inputPath, extname(inputPath)),
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");

  return {
    rendered: outputPath,
    title,
    sections: sections.length,
    help: [`Open ${outputPath} in your browser to review the document`],
  };
};
