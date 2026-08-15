// Owns bounded reads from one opened regular file and optional identity
// verification against a path that was accepted before the file was opened.

import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";

export type RegularFileIdentity = {
  readonly device: bigint;
  readonly inode: bigint;
};

/** Identifies one bounded regular file before another lookup opens it. */
export const regularFileIdentity = async ({
  path,
  maxBytes,
}: {
  readonly path: string;
  readonly maxBytes: number;
}): Promise<RegularFileIdentity | undefined> => {
  const metadata = await stat(path, { bigint: true });
  if (!metadata.isFile() || metadata.size > BigInt(maxBytes)) return undefined;
  return { device: metadata.dev, inode: metadata.ino };
};

/** Reads no more than the accepted size from one opened regular file. */
export const readBoundedRegularFile = async ({
  path,
  maxBytes,
  expectedIdentity,
}: {
  readonly path: string;
  readonly maxBytes: number;
  readonly expectedIdentity: RegularFileIdentity | null;
}): Promise<Uint8Array | undefined> => {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    const metadata = await file.stat({ bigint: true });
    if (
      !metadata.isFile() ||
      metadata.size > BigInt(maxBytes) ||
      (expectedIdentity !== null &&
        (metadata.dev !== expectedIdentity.device ||
          metadata.ino !== expectedIdentity.inode))
    ) {
      return undefined;
    }
    const size = Number(metadata.size);
    const buffer = new Uint8Array(size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return length === size ? buffer.subarray(0, length) : undefined;
  } finally {
    await file.close();
  }
};
