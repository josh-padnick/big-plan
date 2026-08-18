// Owns the guidance gate shared by the authoring commands: running `big-plan
// guidance` records that the current guidance version was read for a working
// directory, and validate, render, and review refuse to run until it has been.
// Environments with no writable state location degrade to a warning, so a
// sandboxed agent is reminded rather than locked out.
// The gate owns the policy (per-directory markers, TTL, version matching,
// degraded warnings); where markers live is a storage adapter, so tests can
// exercise the policy against in-memory state.

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { candidateStateDirectories } from "../../review/state-directory.js";
import { GUIDANCE_VERSION } from "../guidance/content.generated.js";

// A fresh session the next day should reread the guidance; iteration loops
// within a working day should not be interrupted.
const ACKNOWLEDGMENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Where acknowledgment markers live. The gate names a candidate directory for
 * every operation, so an adapter can offer several locations and the gate can
 * fall back across them without knowing what a location is.
 */
export type GuidanceStateStorage = {
  /** Candidate state directories in preference order. */
  readonly candidateDirectories: () => ReadonlyArray<string>;
  /** Reads one marker, or undefined when it is missing or unreadable. */
  readonly readMarker: (input: {
    readonly directory: string;
    readonly name: string;
  }) => Promise<string | undefined>;
  /** Writes one marker, reporting whether the directory accepted it. */
  readonly writeMarker: (input: {
    readonly directory: string;
    readonly name: string;
    readonly content: string;
  }) => Promise<boolean>;
  /** Confirms the directory accepts writes without leaving state behind. */
  readonly probeWritable: (input: {
    readonly directory: string;
  }) => Promise<boolean>;
};

/** Creates the production storage adapter over the local filesystem. */
export const createFileSystemGuidanceStorage = (): GuidanceStateStorage => ({
  candidateDirectories: candidateStateDirectories,
  readMarker: async ({ directory, name }) => {
    try {
      return await readFile(join(directory, name), "utf8");
    } catch {
      // Missing or unreadable in this location; the gate tries the next one.
      return undefined;
    }
  },
  writeMarker: async ({ directory, name, content }) => {
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, name), content, "utf8");
      return true;
    } catch {
      // This location rejects writes; the gate tries the next candidate.
      return false;
    }
  },
  // Confirms a candidate directory accepts writes without leaving a fake
  // acknowledgment behind.
  probeWritable: async ({ directory }) => {
    const probePath = join(directory, `.probe-${process.pid}`);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(probePath, "", "utf8");
      await rm(probePath, { force: true });
      return true;
    } catch {
      return false;
    }
  },
});

/** Creates an in-memory storage adapter so tests can exercise gate policy. */
export const createInMemoryGuidanceStorage = ({
  writable = true,
}: {
  readonly writable?: boolean;
} = {}): GuidanceStateStorage & {
  readonly markers: Map<string, string>;
} => {
  const markers = new Map<string, string>();
  return {
    markers,
    candidateDirectories: () => ["memory"],
    readMarker: async ({ directory, name }) =>
      markers.get(join(directory, name)),
    writeMarker: async ({ directory, name, content }) => {
      if (!writable) {
        return false;
      }
      markers.set(join(directory, name), content);
      return true;
    },
    probeWritable: async () => writable,
  };
};

// One marker file per working directory, so acknowledging guidance in one
// project never unlocks another.
const markerName = (): string => {
  const key = createHash("sha256")
    .update(process.cwd())
    .digest("hex")
    .slice(0, 16);
  return `guidance-${key}.json`;
};

type AcknowledgmentMarker = {
  readonly version: string;
  readonly acknowledgedAtMs: number;
};

const parseMarker = (raw: string): AcknowledgmentMarker | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "string" &&
      "acknowledgedAtMs" in parsed &&
      typeof parsed.acknowledgedAtMs === "number"
    ) {
      return {
        version: parsed.version,
        acknowledgedAtMs: parsed.acknowledgedAtMs,
      };
    }
  } catch {
    // A corrupt marker is treated as no acknowledgment.
  }
  return undefined;
};

export type GuidanceGate = {
  readonly recordGuidanceAcknowledgment: () => Promise<{
    readonly persisted: boolean;
  }>;
  readonly requireGuidanceAcknowledgment: () => Promise<{
    readonly warnings: ReadonlyArray<string>;
  }>;
};

/**
 * Creates the acknowledgment gate over one storage adapter. The clock is
 * injectable so tests can age an acknowledgment without rewriting state.
 */
export const createGuidanceGate = ({
  storage,
  now = Date.now,
}: {
  readonly storage: GuidanceStateStorage;
  readonly now?: () => number;
}): GuidanceGate => {
  const isMarkerCurrent = (marker: AcknowledgmentMarker | undefined): boolean =>
    marker !== undefined &&
    marker.version === GUIDANCE_VERSION &&
    now() - marker.acknowledgedAtMs < ACKNOWLEDGMENT_TTL_MS;

  const readCurrentMarker = async (): Promise<boolean> => {
    for (const directory of storage.candidateDirectories()) {
      const raw = await storage.readMarker({ directory, name: markerName() });
      if (raw !== undefined && isMarkerCurrent(parseMarker(raw))) {
        return true;
      }
    }
    return false;
  };

  const isAnyStateDirectoryWritable = async (): Promise<boolean> => {
    for (const directory of storage.candidateDirectories()) {
      if (await storage.probeWritable({ directory })) {
        return true;
      }
    }
    return false;
  };

  /**
   * Records that the current guidance version was read for this directory.
   * Reports whether any state location accepted the marker, so the caller can
   * tell the reader when persistence was impossible.
   */
  const recordGuidanceAcknowledgment = async (): Promise<{
    readonly persisted: boolean;
  }> => {
    const marker: AcknowledgmentMarker = {
      version: GUIDANCE_VERSION,
      acknowledgedAtMs: now(),
    };
    for (const directory of storage.candidateDirectories()) {
      const persisted = await storage.writeMarker({
        directory,
        name: markerName(),
        content: JSON.stringify(marker),
      });
      if (persisted) {
        return { persisted: true };
      }
    }
    return { persisted: false };
  };

  /**
   * Enforces the guidance gate. A current acknowledgment passes silently; a
   * missing one fails with a structured error while any state location is
   * writable, and degrades to returned warnings when none is, so filesystem
   * restrictions never block the plan workflow outright.
   */
  const requireGuidanceAcknowledgment = async (): Promise<{
    readonly warnings: ReadonlyArray<string>;
  }> => {
    if (await readCurrentMarker()) {
      return { warnings: [] };
    }
    if (await isAnyStateDirectoryWritable()) {
      throw new AxiError(
        "Read the plan-writing guidance before working on a plan",
        "GUIDANCE_REQUIRED",
        [
          "Run `big-plan guidance` to read how to write a plan a human loves to review",
          "Guidance is acknowledged per directory and expires after 24 hours or when the guidance changes",
        ],
      );
    }
    return {
      warnings: [
        "Guidance acknowledgment could not be verified: no writable state directory exists in this environment",
        "Run `big-plan guidance` and follow its principles, or set BIG_PLAN_STATE_DIR to a writable directory to restore the acknowledgment gate",
      ],
    };
  };

  return { recordGuidanceAcknowledgment, requireGuidanceAcknowledgment };
};

// The default gate the commands share, so a call site stays one line.
export const { recordGuidanceAcknowledgment, requireGuidanceAcknowledgment } =
  createGuidanceGate({ storage: createFileSystemGuidanceStorage() });
