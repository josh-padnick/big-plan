// Implements `big-plan skill [write <path>]`: prints the versioned agent skill
// shell shipped with this package, or writes it to an explicit path when the
// operator opts in. Never writes unless `write` is requested.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AxiError } from "axi-sdk-js";
import { SKILL_MARKDOWN } from "./content.generated.js";

const USAGE = "Usage: big-plan skill [write <path>]";

const skillText = (): string => `${SKILL_MARKDOWN.trimEnd()}\n`;

/** Prints or installs the thin Big Plan agent skill shell. */
export const skillCommand = async (
  args: ReadonlyArray<string>,
): Promise<string | Record<string, unknown>> => {
  for (const arg of args) {
    if (arg.startsWith("-")) {
      throw new AxiError(`Unknown option "${arg}"`, "VALIDATION_ERROR", [
        USAGE,
      ]);
    }
  }

  if (args.length === 0) {
    return skillText();
  }

  const [action, pathArg, ...rest] = args;
  if (action !== "write") {
    throw new AxiError(
      `Unknown skill action "${action ?? ""}"`,
      "VALIDATION_ERROR",
      [
        'Supported actions: omit args to print, or "write" to install the skill file',
        USAGE,
      ],
    );
  }
  if (pathArg === undefined) {
    throw new AxiError("Missing skill output path", "VALIDATION_ERROR", [
      USAGE,
    ]);
  }
  if (rest.length > 0) {
    throw new AxiError(
      `Unexpected extra argument "${rest[0] ?? ""}"`,
      "VALIDATION_ERROR",
      [USAGE],
    );
  }

  const outputPath = resolve(pathArg);
  const content = skillText();
  await mkdir(dirname(outputPath), { recursive: true });
  // Explicit `write` is the only mutation path; callers choose the destination
  // and accept overwrite of that single file path.
  await writeFile(outputPath, content, "utf8");
  return {
    written: outputPath,
    help: [
      "Skill shell written. Fast-changing authoring rules still come from `big-plan guidance`, not this file.",
      "Re-run `big-plan skill write <path>` after a package upgrade only when the skill shell itself changed.",
    ],
  };
};
