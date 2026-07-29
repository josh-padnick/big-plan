// Owns the guidance acknowledgment gate: running `big-plan guidance` records
// that the current guidance version was read for a working directory, and
// validate and render refuse to run for that directory until it has been.
// Environments with no writable state location degrade to a warning, so a
// sandboxed agent is reminded rather than locked out.

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { GUIDANCE_VERSION } from "./content.generated.js";

// A fresh session the next day should reread the guidance; iteration loops
// within a working day should not be interrupted.
const ACKNOWLEDGMENT_TTL_MS = 24 * 60 * 60 * 1000;

// BIG_PLAN_STATE_DIR pins state to one directory for tests and sandboxed
// environments. Without it, the home directory is preferred and the system
// temporary directory is the fallback for sandboxes that block home writes.
const candidateStateDirectories = (): ReadonlyArray<string> => {
  const override = process.env["BIG_PLAN_STATE_DIR"];
  if (override !== undefined) {
    return [override];
  }
  return [join(homedir(), ".big-plan"), join(tmpdir(), "big-plan")];
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

const isMarkerCurrent = (marker: AcknowledgmentMarker | undefined): boolean =>
  marker !== undefined &&
  marker.version === GUIDANCE_VERSION &&
  Date.now() - marker.acknowledgedAtMs < ACKNOWLEDGMENT_TTL_MS;

const readCurrentMarker = async (): Promise<boolean> => {
  for (const directory of candidateStateDirectories()) {
    try {
      const raw = await readFile(join(directory, markerName()), "utf8");
      if (isMarkerCurrent(parseMarker(raw))) {
        return true;
      }
    } catch {
      // Missing or unreadable in this location; try the next candidate.
    }
  }
  return false;
};

// Confirms a candidate directory accepts writes without leaving a fake
// acknowledgment behind.
const isAnyStateDirectoryWritable = async (): Promise<boolean> => {
  for (const directory of candidateStateDirectories()) {
    const probePath = join(directory, `.probe-${process.pid}`);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(probePath, "", "utf8");
      await rm(probePath, { force: true });
      return true;
    } catch {
      // This location rejects writes; try the next candidate.
    }
  }
  return false;
};

/**
 * Records that the current guidance version was read for this directory.
 * Reports whether any state location accepted the marker, so the caller can
 * tell the reader when persistence was impossible.
 */
export const recordGuidanceAcknowledgment = async (): Promise<{
  readonly persisted: boolean;
}> => {
  const marker: AcknowledgmentMarker = {
    version: GUIDANCE_VERSION,
    acknowledgedAtMs: Date.now(),
  };
  for (const directory of candidateStateDirectories()) {
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, markerName()),
        JSON.stringify(marker),
        "utf8",
      );
      return { persisted: true };
    } catch {
      // This location rejects writes; try the next candidate.
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
export const requireGuidanceAcknowledgment = async (): Promise<{
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
