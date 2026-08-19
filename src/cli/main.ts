// Wires the big-plan CLI onto runAxiCli(), which owns dispatch, help,
// structured errors, and output serialization. Command behavior lives in the
// named command folders; this file stays thin glue.

import { readFile } from "node:fs/promises";
import { runAxiCli } from "axi-sdk-js";
import { agentCommand } from "./agent/command.js";
import { compileCommand } from "./compile/command.js";
import { guidanceCommand } from "./guidance/command.js";
import { renderCommand } from "./render/command.js";
import { skillCommand } from "./skill/command.js";
import { reviewCommand } from "./review/command.js";
import { serviceCommand } from "./service/command.js";
import { validateCommand } from "./validate/command.js";

// The README tagline verbatim, so the CLI and the docs never drift apart.
const DESCRIPTION =
  "Good AI output depends on a great plan. Big Plan makes reviewing agent plans a first-class experience.";

const TOP_LEVEL_HELP = `big-plan - ${DESCRIPTION}

Usage:
  big-plan guidance [component]               Read the plan-writing guidance
                                             (required before validate,
                                             render, or review), or one
                                             component's usage guidance
  big-plan skill [write <path>]               Print the agent skill shell, or
                                             write it to an explicit path
  big-plan render <input.mdx> [output.html]   Render an MDX plan to a
                                             single self-contained HTML file
                                             (defaults to <input>.html)
  big-plan compile <input.mdx> [output.json]  Compile an MDX plan to its
                                             validated plan model as JSON
                                             (defaults to <input>.model.json)
  big-plan validate <input.mdx>               Check structure, HTML delivery,
                                             and authoring lint without
                                             writing an output file
  big-plan review <input.mdx>                 Serve the plan on loopback for
                                             interactive review with anchored
                                             comments and real agent responses
  big-plan service <action>                   Inspect or control the local
                                             service that answers saved review
                                             links: status, start, stop, restart
  big-plan agent <input.mdx>                  Print the ready-to-paste prompt
                                             for a real coding-agent review
                                             session; agent next and agent
                                             respond drive its loop
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
      next_step: "big-plan guidance",
    }),
    commands: {
      guidance: (args) => guidanceCommand(args),
      skill: (args) => skillCommand(args),
      render: (args) => renderCommand(args),
      compile: (args) => compileCommand(args),
      validate: (args) => validateCommand(args),
      review: (args) => reviewCommand(args),
      service: (args) => serviceCommand(args),
      agent: (args) => agentCommand(args),
    },
  });
};
