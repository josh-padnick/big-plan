// Owns the guidance acknowledgment gate: running `big-plan guidance` records
// that the current guidance version was read for a working directory, and
// validate and render refuse to run for that directory until it has been.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { GUIDANCE_VERSION } from "./content.generated.js";

// A fresh session the next day should reread the guidance; iteration loops
// within a working day should not be interrupted.
const ACKNOWLEDGMENT_TTL_MS = 24 * 60 * 60 * 1000;

// BIG_PLAN_STATE_DIR exists for tests and sandboxed environments that need
// acknowledgment state isolated from the user's home directory.
const stateDirectory = (): string =>
  process.env["BIG_PLAN_STATE_DIR"] ?? join(homedir(), ".big-plan");

// One marker file per working directory, so acknowledging guidance in one
// project never unlocks another.
const markerPath = (): string => {
  const key = createHash("sha256")
    .update(process.cwd())
    .digest("hex")
    .slice(0, 16);
  return join(stateDirectory(), `guidance-${key}.json`);
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

/** Records that the current guidance version was read for this directory. */
export const recordGuidanceAcknowledgment = async (): Promise<void> => {
  const marker: AcknowledgmentMarker = {
    version: GUIDANCE_VERSION,
    acknowledgedAtMs: Date.now(),
  };
  await mkdir(stateDirectory(), { recursive: true });
  await writeFile(markerPath(), JSON.stringify(marker), "utf8");
};

/**
 * Fails with a structured error unless the current guidance version was
 * acknowledged for this directory within the acknowledgment window.
 */
export const requireGuidanceAcknowledgment = async (): Promise<void> => {
  let marker: AcknowledgmentMarker | undefined;
  try {
    marker = parseMarker(await readFile(markerPath(), "utf8"));
  } catch {
    marker = undefined;
  }
  const isCurrent =
    marker !== undefined &&
    marker.version === GUIDANCE_VERSION &&
    Date.now() - marker.acknowledgedAtMs < ACKNOWLEDGMENT_TTL_MS;
  if (!isCurrent) {
    throw new AxiError(
      "Read the plan-writing guidance before working on a plan",
      "GUIDANCE_REQUIRED",
      [
        "Run `big-plan guidance` to read how to write a plan a human loves to review",
        "Guidance is acknowledged per directory and expires after 24 hours or when the guidance changes",
      ],
    );
  }
};
