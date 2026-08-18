// The service's own version, as reported by `/healthz` and compared by every
// link-printing command.
//
// A service outlives the CLI that spawned it: nothing restarts it on upgrade,
// so a months-old process could otherwise keep serving old pages and lacking
// new routes while the installed docs describe something else. The version on
// `/healthz` is what makes that detectable, and the lifecycle's restart-on-
// mismatch policy is what makes it self-correcting.

import { readFile } from "node:fs/promises";

// dist/review/service/version.js -> repo root package.json
const PACKAGE_JSON = new URL("../../../package.json", import.meta.url);

// Read once per process. The file cannot change under a running process in a
// way that process should react to, and every mutating route would otherwise
// pay for a read it never needs.
let cached: string | undefined;

/**
 * Reports this build's version, or `"unknown"` when it cannot be read.
 *
 * An unreadable version is never fatal. It compares unequal to a real version,
 * which errs toward restarting a service rather than adopting one whose
 * behaviour cannot be confirmed.
 */
export const serviceVersion = async (): Promise<string> => {
  if (cached !== undefined) return cached;
  try {
    const parsed: unknown = JSON.parse(await readFile(PACKAGE_JSON, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "string" &&
      parsed.version !== ""
    ) {
      cached = parsed.version;
      return cached;
    }
  } catch {
    // Fall through: an unreadable package.json reports "unknown" rather than
    // crashing a service whose whole job is to keep answering.
  }
  cached = "unknown";
  return cached;
};
