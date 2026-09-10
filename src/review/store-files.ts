// Owns owner-only file publication and tolerant record reads for review state.
// These primitives never write the authoritative plan source.

import { randomBytes } from "node:crypto";
import {
  chmod,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const FILE_MODE = 0o600;
const PUBLISHED_JSON_FILE = /^[a-f0-9]{16}\.json$/;

/** Reads untrusted stored JSON, treating absent or invalid records as no state. */
export const readStoreJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    // A missing, truncated, or hand-edited file means no state, never a crash.
    return undefined;
  }
};

/** Lists only published opaque JSON records, excluding temporary files. */
export const publishedJsonFileNames = async (
  directory: string,
): Promise<ReadonlyArray<string>> =>
  (await readdir(directory).catch(() => []))
    .filter((name) => PUBLISHED_JSON_FILE.test(name))
    .sort();

/** Replaces one file's whole contents without ever showing a partial one. */
export const writeFileAtomically = async ({
  path,
  contents,
}: {
  readonly path: string;
  readonly contents: string;
}): Promise<void> => {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporaryPath, contents, { flag: "wx", mode: FILE_MODE });
    await chmod(temporaryPath, FILE_MODE);
    await rename(temporaryPath, path);
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

/**
 * Replaces one JSON record through the same atomic publication as text files.
 */
export const writeStoreJson = async ({
  path,
  value,
}: {
  readonly path: string;
  readonly value: unknown;
}): Promise<void> =>
  writeFileAtomically({
    path,
    contents: `${JSON.stringify(value, null, 2)}\n`,
  });
