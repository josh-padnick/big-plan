// Wires the big-plan CLI onto runAxiCli(), which owns dispatch, help,
// structured errors, and output serialization. Command behavior lives in the
// named command folders; this file stays thin glue.

import { readFile } from "node:fs/promises";
import { runAxiCli } from "axi-sdk-js";
import { compileCommand } from "./compile/command.js";
import { renderCommand } from "./render/command.js";

// The README tagline verbatim, so the CLI and the docs never drift apart.
const DESCRIPTION =
  "Good AI output depends on a great plan. Big Plan makes reviewing agent plans a first-class experience.";

const TOP_LEVEL_HELP = `big-plan - ${DESCRIPTION}

Usage:
  big-plan render <input.mdx> [output.html]   Render an MDX plan to a
                                             single self-contained HTML file
                                             (defaults to <input>.html)
  big-plan compile <input.mdx> [output.json]  Compile an MDX plan to its
                                             validated plan model as JSON
                                             (defaults to <input>.model.json)
`;

// Reads this package's own version for --version output, tolerating a missing
// or malformed package.json rather than crashing the CLI.
const readOwnVersion = async (): Promise<string | undefined> => {
  // dist/cli/main.js -> repo root package.json
  const packageJsonUrl = new URL("../../package.json", import.meta.url);
  try {
    const parsed: unknown = JSON.parse(await readFile(packageJsonUrl, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "string"
    ) {
      return parsed.version;
    }
  } catch {
    // Fall through: --version reports "not configured" rather than crashing.
  }
  return undefined;
};

/** Runs the big-plan CLI: dispatches argv to commands via runAxiCli(). */
export const main = async (): Promise<void> => {
  const version = await readOwnVersion();
  await runAxiCli({
    description: DESCRIPTION,
    ...(version === undefined ? {} : { version }),
    topLevelHelp: TOP_LEVEL_HELP,
    home: () => ({
      "big-plan": DESCRIPTION,
      next_step: "big-plan render <file.mdx>",
    }),
    commands: {
      render: (args) => renderCommand(args),
      compile: (args) => compileCommand(args),
    },
  });
};
