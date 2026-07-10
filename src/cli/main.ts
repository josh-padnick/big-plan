// Wires the grandplan CLI onto runAxiCli(), which owns dispatch, help,
// structured errors, and output serialization. Command behavior lives in the
// sibling *-command modules; this file stays thin glue.

import { readFile } from "node:fs/promises";
import { runAxiCli } from "axi-sdk-js";
import { renderCommand } from "./render-command.js";

// Mirrors the README tagline: good AI output depends on a great plan, and
// GrandPlan makes reviewing agent plans a first-class experience.
const DESCRIPTION =
  "Make reviewing agent plans a first-class experience: render markdown plans into calm, self-contained HTML review documents";

const TOP_LEVEL_HELP = `grandplan - ${DESCRIPTION}

Usage:
  grandplan render <input.md> [output.html]   Render a markdown plan to a
                                              single self-contained HTML file
                                              (defaults to <input>.html)
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

/** Runs the grandplan CLI: dispatches argv to commands via runAxiCli(). */
export const main = async (): Promise<void> => {
  const version = await readOwnVersion();
  await runAxiCli({
    description: DESCRIPTION,
    ...(version === undefined ? {} : { version }),
    topLevelHelp: TOP_LEVEL_HELP,
    home: () => ({
      grandplan: DESCRIPTION,
      next_step: "grandplan render <file.md>",
    }),
    commands: {
      render: (args) => renderCommand(args),
    },
  });
};
