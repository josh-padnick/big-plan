// Owns the one portable fact of a spawner's death, for the connection loop
// whose life is what the reviewer's status card vouches for.
//
// When the process that started this one exits, the operating system reparents
// the orphan: macOS hands it to launchd, Linux to init or the nearest
// subreaper. Both show up as a change from the parent pid recorded at startup,
// so change detection works on every platform and nothing here names pid 1.
// A loop started detached on purpose never sees a change, and so keeps waiting.

/** True once the process that started this one has exited. */
export const spawnerIsGone = ({
  recordedPpid,
  livePpid,
}: {
  readonly recordedPpid: number;
  readonly livePpid: number;
}): boolean => recordedPpid !== livePpid;
