// Owns crash-safe mutable replacement and exclusive immutable file creation
// for the local review repository.

import { randomBytes } from "node:crypto";
import { chmod, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const FILE_MODE = 0o600;

export type AtomicFileOperations = {
  readonly open: typeof open;
  readonly rename: typeof rename;
  readonly chmod: typeof chmod;
  readonly unlink: typeof unlink;
};

const DEFAULT_OPERATIONS: AtomicFileOperations = {
  open,
  rename,
  chmod,
  unlink,
};

/** Writes, flushes, closes, and permissions one complete temporary file. */
const writeCompleteFile = async ({
  path,
  contents,
  flag,
  operations,
}: {
  readonly path: string;
  readonly contents: string;
  readonly flag: "wx";
  readonly operations: AtomicFileOperations;
}): Promise<FileHandle> => {
  const handle = await operations.open(path, flag, FILE_MODE);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.chmod(FILE_MODE);
    return handle;
  } catch (error: unknown) {
    await handle.close().catch(() => undefined);
    throw error;
  }
};

/** Atomically replaces one mutable file without exposing partial contents. */
export const replaceFileAtomically = async ({
  path,
  contents,
  operations = DEFAULT_OPERATIONS,
}: {
  readonly path: string;
  readonly contents: string;
  readonly operations?: AtomicFileOperations;
}): Promise<void> => {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle: FileHandle | undefined;
  try {
    handle = await writeCompleteFile({
      path: temporaryPath,
      contents,
      flag: "wx",
      operations,
    });
    await handle.close();
    handle = undefined;
    await operations.rename(temporaryPath, path);
    await operations.chmod(path, FILE_MODE);
  } catch (error: unknown) {
    await handle?.close().catch(() => undefined);
    await operations.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

/** Creates one immutable fact and refuses to replace an existing identity. */
export const createFileExclusively = async ({
  path,
  contents,
  operations = DEFAULT_OPERATIONS,
}: {
  readonly path: string;
  readonly contents: string;
  readonly operations?: AtomicFileOperations;
}): Promise<void> => {
  const handle = await writeCompleteFile({
    path,
    contents,
    flag: "wx",
    operations,
  });
  await handle.close();
};
