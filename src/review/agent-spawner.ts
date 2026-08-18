// Owns the one portable fact of a spawner's death, for the connection loop
// whose life is what the reviewer's status card vouches for.
//
// When the process that started this one exits, the operating system reparents
// the orphan: macOS hands it to launchd, Linux to init or the nearest
// subreaper. Both show up as a change from the parent pid recorded at startup,
// so change detection works on every platform and nothing here names pid 1.
// A loop started detached on purpose never sees a change, and so keeps waiting.

/**
 * The parent this process was started by, sampled as early as the module graph
 * allows.
 *
 * Timing is the whole reason this is a module constant rather than a call at
 * the top of the loop: everything between process start and the first sample
 * is a window in which a spawner can die unnoticed, because a parent already
 * gone by then leaves nothing left to change. Reading it during import is the
 * earliest this module can be asked, and it costs nothing to hold.
 */
export const SPAWNER_PPID = process.ppid;

/** True once the process that started this one has exited. */
export const spawnerIsGone = ({
  recordedPpid,
  livePpid,
}: {
  readonly recordedPpid: number;
  readonly livePpid: number;
}): boolean => recordedPpid !== livePpid;
