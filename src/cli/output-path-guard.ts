// Owns the shared CLI policy that derived output must never overwrite the
// authored input, including when two paths alias the same filesystem entry.
// The alias check and the write share one file descriptor: the output is
// opened without truncation, its identity is compared against the input on
// the open handle, and content is written through that same handle - so no
// concurrent path swap between check and write can redirect the write onto
// the input.

import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { AxiError } from "axi-sdk-js";

type OutputPathGuardOptions = {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly usage: string;
};

const overwriteError = (usage: string): AxiError =>
  new AxiError(
    "Output path would overwrite the input MDX file",
    "VALIDATION_ERROR",
    [usage],
  );

// Rejects a lexical collision immediately and returns the writer that
// callers use in place of a bare writeFile once output content exists.
export const createOutputPathGuard = ({
  inputPath,
  outputPath,
  usage,
}: OutputPathGuardOptions): ((content: string) => Promise<void>) => {
  if (outputPath === inputPath) {
    throw overwriteError(usage);
  }

  return async (content: string): Promise<void> => {
    // No O_TRUNC: if the output path aliases the input, opening must not
    // destroy it before the identity comparison below can refuse.
    const handle = await open(outputPath, constants.O_RDWR | constants.O_CREAT);
    try {
      const [inputIdentity, outputIdentity] = await Promise.all([
        stat(inputPath, { bigint: true }),
        handle.stat({ bigint: true }),
      ]);
      if (
        inputIdentity.dev === outputIdentity.dev &&
        inputIdentity.ino === outputIdentity.ino
      ) {
        throw overwriteError(usage);
      }
      await handle.truncate(0);
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
  };
};
