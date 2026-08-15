// Activates this checkout's committed compliance hooks without replacing an
// effective hooks path or hook that another worktree tool already owns.
// Run automatically by `bun install` via package.json's "prepare" script.

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
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
  hook
    .split("\n")
    .find((line) => line.startsWith(managedOwnerPrefix)) ===
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

const deployCompositeHook = (
  hooksDirectory,
  hookName,
  commonDirectory,
) => {
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
  const hasDefaultHooks =
    hookNames.some((hookName) =>
      existsSync(join(defaultHooksDirectory, hookName)),
    );
  const effectiveHooksDirectory = effectiveHooksPath
    ? resolve(repoRoot, effectiveHooksPath)
    : hasDefaultHooks
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
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
      cwd: repoRoot,
    });
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
  const hooksPath = installGitHooks(repoRoot);
  console.log(
    `git hooks installed: core.hooksPath -> ${hooksPath} (${repoRoot})`,
  );
}
