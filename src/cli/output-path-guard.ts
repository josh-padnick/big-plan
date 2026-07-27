// Owns the shared CLI policy that derived output must never overwrite the
// authored input, including when two paths alias the same filesystem entry.
// The alias check and the write share one file descriptor: the output is
// opened without truncation, its identity is compared against the input on
// the open handle, and content is written through that same handle - so no
// concurrent path swap between check and write can redirect the write onto
// the input.

import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
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

const errorCode = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;

const identitiesMatch = ({
  first,
  second,
}: {
  readonly first: { readonly dev: bigint; readonly ino: bigint };
  readonly second: { readonly dev: bigint; readonly ino: bigint };
}): boolean => first.dev === second.dev && first.ino === second.ino;

// Compares path identities when permissions prevent opening the output.
const pathsAlias = async ({
  inputPath,
  outputPath,
}: Pick<
  OutputPathGuardOptions,
  "inputPath" | "outputPath"
>): Promise<boolean> => {
  const inputIdentity = await stat(inputPath, { bigint: true });
  try {
    const outputIdentity = await stat(outputPath, { bigint: true });
    return identitiesMatch({ first: inputIdentity, second: outputIdentity });
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
};

// Opens the writable inode used by the guard while preserving alias errors
// when permissions prohibit acquiring a handle.
const openOutput = async ({
  inputPath,
  outputPath,
  usage,
}: OutputPathGuardOptions): Promise<FileHandle> => {
  try {
    return await open(outputPath, constants.O_WRONLY | constants.O_CREAT);
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code !== "EACCES" && code !== "EPERM") {
      throw error;
    }

    let aliasesInput: boolean;
    try {
      aliasesInput = await pathsAlias({ inputPath, outputPath });
    } catch {
      throw error;
    }
    if (aliasesInput) {
      throw overwriteError(usage);
    }
    throw error;
  }
};

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
    const handle = await openOutput({ inputPath, outputPath, usage });
    try {
      const [inputIdentity, outputIdentity] = await Promise.all([
        stat(inputPath, { bigint: true }),
        handle.stat({ bigint: true }),
      ]);
      if (identitiesMatch({ first: inputIdentity, second: outputIdentity })) {
        throw overwriteError(usage);
      }
      await handle.truncate(0);
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
  };
};
