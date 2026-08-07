#!/usr/bin/env python3
"""One-off local tool: re-record approved-manifest evidence after a rebase.

Reads the evidence ledgers written by collect-evidence.local.mjs, rebuilds each
approved commit's manifest captureChanges (preserving authored propertyDeltas),
then replays the branch with git plumbing so every rewritten commit carries the
updated manifest blob. Not committed; delete after use.
"""

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def git(*args, input_bytes=None, env=None):
    result = subprocess.run(
        ["git", *args],
        cwd=REPO,
        input=input_bytes,
        capture_output=True,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {result.stderr.decode()}")
    return result.stdout


def git_text(*args):
    return git(*args).decode().strip()


def main():
    merge_base = git_text("merge-base", "origin/main", "HEAD")
    commits = git_text("rev-list", "--reverse", f"{merge_base}..HEAD").split()

    # Map each commit to the manifest it adds (if any).
    manifest_of = {}
    for commit in commits:
        added = git_text(
            "diff", "--name-only", "--diff-filter=A",
            f"{commit}~1", commit, "--", ".style-snapshots/manifests/",
        )
        if added:
            paths = added.split("\n")
            assert len(paths) == 1, (commit, paths)
            manifest_of[commit] = paths[0]

    # Rebuild manifests from evidence ledgers.
    new_content = {}  # manifest path -> bytes
    problems = []
    for commit, manifest_path in manifest_of.items():
        ledger_path = REPO / "test-results" / "style-history" / commit[:12] / "evidence.json"
        if not ledger_path.exists():
            problems.append(f"{commit[:12]}: no evidence ledger at {ledger_path}")
            continue
        ledger = json.loads(ledger_path.read_text())
        old = json.loads(git(f"show", f"{commit}:{manifest_path}").decode())
        old_by_capture = {e["capture"]: e for e in old["captureChanges"]}
        changes = [c for c in ledger["captures"] if c["changedPixels"] > 0]
        changes.sort(key=lambda c: c["capture"])
        rebuilt = []
        for change in changes:
            prior = old_by_capture.get(change["capture"])
            if prior is None:
                problems.append(
                    f"{commit[:12]}: capture {change['capture']} changed but has no "
                    f"authored propertyDeltas in {manifest_path}"
                )
                continue
            rebuilt.append({
                "capture": change["capture"],
                "changedPixels": change["changedPixels"],
                "before": change["before"],
                "after": change["after"],
                "propertyDeltas": prior["propertyDeltas"],
            })
        dropped = sorted(set(old_by_capture) - {c["capture"] for c in changes})
        if dropped:
            print(f"note {commit[:12]}: captures no longer changed, dropped: {dropped}")
        new = dict(old)
        new["captureChanges"] = rebuilt
        new_content[manifest_path] = (json.dumps(new, indent=2) + "\n").encode()

    if problems:
        for p in problems:
            print("PROBLEM:", p, file=sys.stderr)
        sys.exit(1)

    unchanged = [
        p for c, p in manifest_of.items()
        if git(f"show", f"{c}:{p}") == new_content[p]
    ]
    for p in unchanged:
        print(f"manifest already exact, left untouched in rewrite: {p}")

    # Replay history, swapping in updated manifest blobs from each adding
    # commit onward so a manifest is still added once and never modified.
    blobs = {}
    for path, content in new_content.items():
        blobs[path] = subprocess.run(
            ["git", "hash-object", "-w", "--stdin"],
            cwd=REPO, input=content, capture_output=True, check=True,
        ).stdout.decode().strip()

    import os
    index_file = REPO / ".git-rewrite-index"
    mapped = {}
    active = {}  # path -> blob, live from the adding commit onward
    for commit in commits:
        if commit in manifest_of:
            path = manifest_of[commit]
            active[path] = blobs[path]
        parent = git_text("rev-parse", f"{commit}~1")
        new_parent = mapped.get(parent, parent)
        env = dict(os.environ)
        env["GIT_INDEX_FILE"] = str(index_file)
        subprocess.run(["git", "read-tree", f"{commit}^{{tree}}"],
                       cwd=REPO, env=env, check=True)
        for path, blob in active.items():
            subprocess.run(
                ["git", "update-index", "--cacheinfo", f"100644,{blob},{path}"],
                cwd=REPO, env=env, check=True,
            )
        tree = subprocess.run(["git", "write-tree"], cwd=REPO, env=env,
                              capture_output=True, check=True).stdout.decode().strip()
        meta = git_text(
            "show", "-s",
            "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI", commit,
        ).split("\x00")
        message = git("show", "-s", "--format=%B", commit)
        env2 = dict(os.environ)
        env2.update({
            "GIT_AUTHOR_NAME": meta[0], "GIT_AUTHOR_EMAIL": meta[1],
            "GIT_AUTHOR_DATE": meta[2], "GIT_COMMITTER_NAME": meta[3],
            "GIT_COMMITTER_EMAIL": meta[4], "GIT_COMMITTER_DATE": meta[5],
        })
        new_commit = subprocess.run(
            ["git", "commit-tree", tree, "-p", new_parent],
            cwd=REPO, input=message, env=env2, capture_output=True, check=True,
        ).stdout.decode().strip()
        mapped[commit] = new_commit

    if index_file.exists():
        index_file.unlink()
    old_head = commits[-1]
    print(f"old head {old_head}")
    print(f"new head {mapped[old_head]}")


if __name__ == "__main__":
    main()
