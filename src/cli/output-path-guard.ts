// Owns the shared CLI policy that derived output must never overwrite the
// authored input, including when two paths alias the same filesystem entry.

import { realpath, stat } from "node:fs/promises";
import { AxiError } from "axi-sdk-js";

type OutputPathGuardOptions = {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly usage: string;
};

type FilesystemIdentity = {
  readonly device: bigint;
  readonly inode: bigint;
};

const overwriteError = (usage: string): AxiError =>
  new AxiError(
    "Output path would overwrite the input MDX file",
    "VALIDATION_ERROR",
    [usage],
  );

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

// Resolves a canonical path when the entry exists while allowing a new output
// path to proceed to creation.
const canonicalPathOf = async (path: string): Promise<string | undefined> => {
  try {
    return await realpath(path);
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
};

// Reads the stable device/inode pair needed to recognize hard links.
const identityOf = async (
  path: string,
): Promise<FilesystemIdentity | undefined> => {
  try {
    const metadata = await stat(path, { bigint: true });
    return { device: metadata.dev, inode: metadata.ino };
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
};

// Rejects a lexical collision immediately and returns the filesystem-level
// check that callers run immediately before creating derived output.
export const createOutputPathGuard = ({
  inputPath,
  outputPath,
  usage,
}: OutputPathGuardOptions): (() => Promise<void>) => {
  if (outputPath === inputPath) {
    throw overwriteError(usage);
  }

  return async (): Promise<void> => {
    const [canonicalInputPath, canonicalOutputPath] = await Promise.all([
      canonicalPathOf(inputPath),
      canonicalPathOf(outputPath),
    ]);
    if (
      canonicalInputPath !== undefined &&
      canonicalInputPath === canonicalOutputPath
    ) {
      throw overwriteError(usage);
    }

    const [inputIdentity, outputIdentity] = await Promise.all([
      identityOf(inputPath),
      identityOf(outputPath),
    ]);
    if (
      inputIdentity !== undefined &&
      outputIdentity !== undefined &&
      inputIdentity.device === outputIdentity.device &&
      inputIdentity.inode === outputIdentity.inode
    ) {
      throw overwriteError(usage);
    }
  };
};
