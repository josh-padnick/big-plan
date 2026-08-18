// Activates this checkout's committed compliance hooks without replacing an
// effective hooks path or hook that another worktree tool already owns.
// Run automatically by `bun install` via package.json's "prepare" script.

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hookNames = ["prepare-commit-msg", "commit-msg"];
const managedHookPrefix = "#!/bin/sh\nBIG_PLAN_COMPLIANCE_HOOK=1\n";
const managedBackupPattern = /^BIG_PLAN_ORIGINAL_HOOK=([A-Za-z0-9.-]*)$/m;
const managedOwnerPrefix = "BIG_PLAN_COMMON_DIR=";
const compositeEnvironmentVariable = "BIG_PLAN_COMPOSITE_HOOK";

const readEffectiveHooksPath = (repoRoot) => {
  try {
    return execFileSync(
      "git",
      ["config", "--path", "--get", "core.hooksPath"],
      { cwd: repoRoot, encoding: "utf8" },
    ).trim();
  } catch (error) {
    if (error && typeof error === "object" && error.status === 1) return null;
    throw error;
  }
};

const readDefaultHooksDirectory = (repoRoot) =>
  execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();

/** Detects active default-directory hooks that cannot be preserved by the two
 * commit-message dispatchers when core.hooksPath moves to `.githooks`. */
const hasUnrelatedDefaultHooks = (hooksDirectory) =>
  existsSync(hooksDirectory) &&
  readdirSync(hooksDirectory).some((name) => {
    if (name.endsWith(".sample")) return false;
    if (
      hookNames.some(
        (hookName) =>
          name === hookName || name.startsWith(`${hookName}.before-big-plan`),
      )
    ) {
      return false;
    }
    const hookPath = join(hooksDirectory, name);
    if (!existsSync(hookPath)) return false;
    const hook = statSync(hookPath);
    return hook.isFile() && (hook.mode & 0o111) !== 0;
  });

const nextBackupName = (hooksDirectory, hookName) => {
  const baseName = `${hookName}.before-big-plan`;
  let candidate = baseName;
  let suffix = 2;
  while (existsSync(join(hooksDirectory, candidate))) {
    candidate = `${baseName}.${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;

const isManagedHookOwnedBy = (hook, commonDirectory) =>
  hook.startsWith(managedHookPrefix) &&
  hook.split("\n").find((line) => line.startsWith(managedOwnerPrefix)) ===
    `${managedOwnerPrefix}${shellQuote(commonDirectory)}`;

const compositeHook = (
  hookName,
  backupName,
  commonDirectory,
) => `${managedHookPrefix}BIG_PLAN_ORIGINAL_HOOK=${backupName ?? ""}
BIG_PLAN_COMMON_DIR=${shellQuote(commonDirectory)}
set -eu
hook_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
current_common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
if [ "$current_common_dir" != "$BIG_PLAN_COMMON_DIR" ]; then
${
  backupName
    ? `  if [ -x "$hook_dir/$BIG_PLAN_ORIGINAL_HOOK" ]; then
    exec "$hook_dir/$BIG_PLAN_ORIGINAL_HOOK" "$@"
  fi
`
    : ""
}  exit 0
fi
current_worktree_root=$(git rev-parse --path-format=absolute --show-toplevel)
compliance_hook="$current_worktree_root/.githooks/${hookName}"
${
  hookName === "commit-msg" && backupName
    ? `if [ -f "$compliance_hook" ]; then
  ${compositeEnvironmentVariable}=1 node "$compliance_hook" "$@"
fi
`
    : ""
}${
  backupName
    ? `if [ -x "$hook_dir/${backupName}" ]; then
  "$hook_dir/${backupName}" "$@"
fi
`
    : ""
}
if [ -f "$compliance_hook" ]; then
  exec env ${compositeEnvironmentVariable}=1 node "$compliance_hook" "$@"
fi
exit 0
`;

export const runManagedDefaultHook = (hookName, argv) => {
  if (process.env[compositeEnvironmentVariable] === "1") return false;
  const commonDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  const hookPath = join(commonDirectory, "hooks", hookName);
  if (!existsSync(hookPath)) return false;
  const hook = readFileSync(hookPath, "utf8");
  if (!isManagedHookOwnedBy(hook, commonDirectory)) return false;
  const result = spawnSync(hookPath, argv, {
    env: { ...process.env, [compositeEnvironmentVariable]: "1" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return true;
};

const deployCompositeHook = (hooksDirectory, hookName, commonDirectory) => {
  const hookPath = join(hooksDirectory, hookName);
  let backupName = null;
  if (existsSync(hookPath)) {
    const existingHook = readFileSync(hookPath, "utf8");
    if (existingHook.startsWith(managedHookPrefix)) {
      const backupMatch = existingHook.match(managedBackupPattern);
      if (!backupMatch) {
        throw new Error(`invalid managed hook: ${hookPath}`);
      }
      if (!isManagedHookOwnedBy(existingHook, commonDirectory)) {
        throw new Error(
          `cannot install Big Plan hook at ${hookPath}: the managed dispatcher belongs to a different repository`,
        );
      }
      backupName = backupMatch[1] || null;
    } else {
      backupName = nextBackupName(hooksDirectory, hookName);
      renameSync(hookPath, join(hooksDirectory, backupName));
    }
  }

  try {
    writeFileSync(
      hookPath,
      compositeHook(hookName, backupName, commonDirectory),
      {
        encoding: "utf8",
        mode: 0o755,
      },
    );
  } catch (error) {
    rmSync(hookPath, { force: true });
    if (backupName && existsSync(join(hooksDirectory, backupName))) {
      renameSync(join(hooksDirectory, backupName), hookPath);
    }
    throw error;
  }
};

/**
 * Whether there is a Git checkout here at all, and a `git` to ask.
 *
 * A missing repository is the one failure `prepare` absorbs, so it is answered
 * before installing rather than inferred from a caught error - which would
 * also swallow the refusals this script exists to raise.
 *
 * Two absences count, and only two: no `git` on PATH (`ENOENT` from the spawn)
 * and a tree that simply is not in a repository. Anything else - unreadable
 * git data, a broken install - is a real error about a checkout that may well
 * exist, and it is raised rather than read as "nothing to install into".
 *
 * `GIT_DIR` is what separates the second case from a misconfiguration, because
 * git reports both as "not a git repository". Nobody sets `GIT_DIR` by
 * accident: if it is set and git still cannot find a repository, the answer is
 * that the setting is wrong, not that there is nothing here.
 */
export const gitCheckoutIsAvailable = (repoRoot) => {
  try {
    execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    if (
      process.env["GIT_DIR"] === undefined &&
      /not a git repository/i.test(String(error?.stderr ?? ""))
    ) {
      return false;
    }
    throw error;
  }
};

export const installGitHooks = (repoRoot) => {
  const committedHooksDirectory = resolve(repoRoot, ".githooks");
  const commonDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
  const effectiveHooksPath = readEffectiveHooksPath(repoRoot);
  const defaultHooksDirectory = effectiveHooksPath
    ? join(commonDirectory, "hooks")
    : readDefaultHooksDirectory(repoRoot);
  const hasDefaultHooks = hookNames.some((hookName) =>
    existsSync(join(defaultHooksDirectory, hookName)),
  );
  const hasUnrelatedHooks = hasUnrelatedDefaultHooks(defaultHooksDirectory);
  const effectiveHooksDirectory = effectiveHooksPath
    ? resolve(repoRoot, effectiveHooksPath)
    : hasDefaultHooks || hasUnrelatedHooks
      ? defaultHooksDirectory
      : committedHooksDirectory;

  if (effectiveHooksDirectory === committedHooksDirectory) {
    const hasManagedDefaultHooks = hookNames.some((hookName) => {
      const hookPath = join(defaultHooksDirectory, hookName);
      return (
        existsSync(hookPath) &&
        readFileSync(hookPath, "utf8").startsWith(managedHookPrefix)
      );
    });
    if (hasManagedDefaultHooks) {
      for (const hookName of hookNames) {
        deployCompositeHook(defaultHooksDirectory, hookName, commonDirectory);
      }
    }
    if (hasUnrelatedHooks) {
      for (const hookName of hookNames) {
        deployCompositeHook(defaultHooksDirectory, hookName, commonDirectory);
      }
      execFileSync("git", ["config", "core.hooksPath", defaultHooksDirectory], {
        cwd: repoRoot,
      });
      return defaultHooksDirectory;
    }
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
      cwd: repoRoot,
    });
    for (const hookName of hookNames) {
      const hookPath = join(committedHooksDirectory, hookName);
      if (existsSync(hookPath)) chmodSync(hookPath, 0o755);
    }
    return ".githooks";
  }

  mkdirSync(effectiveHooksDirectory, { recursive: true });
  for (const hookName of hookNames) {
    deployCompositeHook(effectiveHooksDirectory, hookName, commonDirectory);
  }
  if (!effectiveHooksPath) {
    const installedHooksPath = hasUnrelatedHooks
      ? defaultHooksDirectory
      : ".githooks";
    execFileSync("git", ["config", "core.hooksPath", installedHooksPath], {
      cwd: repoRoot,
    });
    if (hasUnrelatedHooks) return defaultHooksDirectory;
    for (const hookName of hookNames) {
      const hookPath = join(committedHooksDirectory, hookName);
      if (existsSync(hookPath)) chmodSync(hookPath, 0o755);
    }
    return ".githooks";
  }
  return effectiveHooksPath ?? effectiveHooksDirectory;
};

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  // package.json runs this from `prepare`, so it executes on every install -
  // including installs with no repository and images with no git, such as a
  // Docker build over an extracted tarball. Hooks are a contributor
  // convenience, so having nothing to install into must not fail the install.
  //
  // Only that case is tolerated. A refusal - a managed dispatcher owned by
  // another repository, an unrelated hook already in place - is this script
  // protecting someone's setup, and it has to keep failing loudly.
  if (!gitCheckoutIsAvailable(repoRoot)) {
    console.log(
      "git hooks not installed: no Git checkout here. They are a contributor convenience, so the install continues.",
    );
  } else {
    const hooksPath = installGitHooks(repoRoot);
    console.log(
      `git hooks installed: core.hooksPath -> ${hooksPath} (${repoRoot})`,
    );
  }
}
