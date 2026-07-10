import { readFile } from "node:fs/promises";
import { runAxiCli } from "axi-sdk-js";
import { renderCommand } from "./render-command.js";

const DESCRIPTION =
  "Render AI-agent-authored plans into calm, self-contained HTML review documents";

const TOP_LEVEL_HELP = `grandplan - ${DESCRIPTION}

Usage:
  grandplan render <input.md> [output.html]   Render a GFM markdown plan to a
                                              single self-contained HTML file
                                              (defaults to <input>.html)
`;

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
