import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import { renderDocument } from "../render/render-document.js";

const USAGE = "Usage: grandplan render <input.md> [output.html]";

// The document h1 already comes from the markdown body; this title only
// names the browser tab, so the first h1 line (or the file name) is enough.
export const deriveTitle = ({
  markdown,
  inputPath,
}: {
  readonly markdown: string;
  readonly inputPath: string;
}): string => {
  const heading = markdown.match(/^#\s+(.+)$/m);
  const headingText = heading?.[1]?.trim();
  if (headingText !== undefined && headingText.length > 0) {
    return headingText;
  }
  return basename(inputPath, extname(inputPath));
};

const defaultOutputPath = (inputPath: string): string => {
  const extension = extname(inputPath);
  const withoutExtension =
    extension.length > 0
      ? inputPath.slice(0, -extension.length)
      : inputPath;
  return `${withoutExtension}.html`;
};

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
    throw new AxiError(`Cannot read input file: ${inputPath}`, "INPUT_NOT_FOUND", [
      USAGE,
    ]);
  }

  const outputPath = resolve(args[1] ?? defaultOutputPath(inputPath));
  const title = deriveTitle({ markdown, inputPath });
  const { html, sectionCount } = renderDocument({ markdown, title });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");

  return {
    rendered: outputPath,
    title,
    sections: sectionCount,
    help: [`Open ${outputPath} in your browser to review the document`],
  };
};
