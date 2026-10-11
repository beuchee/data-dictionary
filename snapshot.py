#!/usr/bin/env python3
"""Update concept_sets_versions.json with the current commit SHA for any concept set
whose version is not yet recorded in the index.

Workflow:
  1. Edit concept_sets/{id}.json (e.g. bump version 1.0.0 -> 1.1.0).
  2. git commit -am "Update concept set {id} to v1.1.0"
  3. python3 snapshot.py
  4. git commit -am "Snapshot concept set {id} v1.1.0"

The index maps {id: {version: commit_sha}} so build.py can later retrieve the
exact JSON of any pinned (id, version) pair via `git show <sha>:concept_sets/{id}.json`.

Why HEAD, and why two commits:
  For every (id, version) pair NOT already in the index, this records the CURRENT
  HEAD sha -- not the commit that historically introduced that version. It therefore
  assumes the version on disk at HEAD is the canonical content for that pair. Two
  consequences:

  1. A file with uncommitted (staged or unstaged) changes is SKIPPED with a warning:
     pinning HEAD while the file differs from HEAD would record a sha whose content
     does not match. So you must commit the version bump BEFORE snapshotting, then
     commit the updated index AFTER -- the two-commit workflow above.

  2. If you batch several version bumps across multiple commits and snapshot only at
     the end, every newly-seen pair is stamped with the same HEAD. That is fine ONLY
     because each version's content is frozen the moment it is committed -- which is
     why you must NEVER reuse a published (id, version) pair. If a version turns out
     wrong, bump to a new version rather than rewriting the old one.

     Caveat: only the version currently on disk is seen. If the SAME file is bumped
     twice across commits (1.0.0 -> 1.1.0 -> 1.2.0) before snapshotting, the
     intermediate 1.1.0 is never indexed and any project pinned to it will fail at
     build time. Snapshot after every bump of a given file.

This script is idempotent: pairs already in the index are never re-stamped, so
re-running it (or build.py) does nothing once everything is recorded. Never edit
concept_sets_versions.json by hand.

Backfill (--backfill):
  The default mode only ever sees the version currently on disk, so a version that
  came and went between two runs is missed -- which is what happens when others push
  bumps for a while and nobody snapshots in between (contributions merged through the
  SPA's "Propose" button, for one: CI runs build.py but never commits the index).

  --backfill walks the git history of every concept_sets/*.json instead, reads the
  `version` field at each commit that touched it, and records the FIRST commit where
  each version appears. That sha is strictly better than the HEAD approximation above:
  it is the commit that actually introduced the version, so `git show <sha>:...` is
  guaranteed to return that version's content. It also recovers the intermediate
  versions the caveat above calls unreachable.

  It is additive only. A pair already in the index keeps its recorded sha even when
  the walk finds a different (more accurate) one, because those shas are published --
  the SPA resolves them at runtime to fetch past versions, so rewriting one would
  repoint a version someone already cited. Such disagreements are reported as
  "divergences" and left alone; --show-divergences lists them individually.

  Deleted concept sets are included: their file is gone from disk but a project may
  still pin one, and the history still holds the content.

  Cost: one `git log` per file plus one `git show` per touching commit -- seconds on a
  repo this size, but enough that it stays opt-in and is never called by build.py.

Implementation: apps/api/app/services/versioning.py (standard library only), shared
with the v2 API, which snapshots right after its own commits and backfills after
pulling merged proposals. This script is its command line.
"""

import argparse
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SERVICES_DIR = os.path.join(ROOT, "apps", "api", "app", "services")


def load_service(name):
    """Load apps/api/app/services/<name>.py on its own: it needs nothing but the
    standard library, so CI runs it with a bare `python3`."""
    if name in sys.modules:
        return sys.modules[name]
    path = os.path.join(SERVICES_DIR, f"{name}.py")
    if not os.path.isfile(path):
        sys.exit(f"Missing {os.path.relpath(path, ROOT)}: this script runs the implementation that lives there.")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


versioning = load_service("versioning")


def backfill(dry_run=False, show_divergences=False):
    try:
        result = versioning.backfill(ROOT, write=not dry_run)
    except versioning.VersioningError as e:
        sys.exit(str(e))

    if not result.scanned:
        print("No concept set history found — nothing to backfill.")
        return
    print(f"Scanning the history of {result.scanned} concept set file(s)…")

    divergences = result.divergences
    if divergences:
        print()
        print(f"{len(divergences)} pair(s) already indexed at a different commit than the "
              f"one that introduced them.")
        print("Left untouched: those shas are published and the app resolves them at runtime.")
        if show_divergences:
            for key, version, recorded, found in divergences:
                print(f"  concept set {key} v{version}: indexed {recorded[:10]}, "
                      f"introduced at {found[:10]}")
        else:
            print("Re-run with --show-divergences to list them.")

    if not result.added:
        print()
        print("No missing versions found. Index unchanged.")
        return

    print()
    print(f"{'Would add' if dry_run else 'Added'} {len(result.added)} missing "
          f"(id, version) pair(s):")
    for key, version, sha, path in result.added:
        deleted = "" if os.path.isfile(os.path.join(ROOT, path)) else "  [deleted file]"
        print(f"  concept set {key} -> v{version} at {sha[:10]}{deleted}")

    if dry_run:
        print()
        print("Dry run — concept_sets_versions.json was not modified.")
        return

    print()
    print("Don't forget to commit concept_sets_versions.json.")


def main():
    try:
        result = versioning.snapshot_head(ROOT)
    except versioning.VersioningError as e:
        sys.exit(str(e))

    if result.warnings:
        print("Warnings:")
        for w in result.warnings:
            print(w)

    if not result.added:
        print("No new versions to snapshot. Index unchanged.")
        return

    print(f"Snapshotted {len(result.added)} new (id, version) pair(s) at {result.sha[:10]}:")
    for cs_id, version in result.added:
        print(f"  concept set {cs_id} -> v{version}")
    print()
    print("Don't forget to commit concept_sets_versions.json.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Record the commit sha of each concept set version in "
                    "concept_sets_versions.json.",
        epilog="Without --backfill, stamps versions currently on disk at HEAD "
               "(the two-commit workflow). With it, walks the git history to recover "
               "versions no run ever saw. Both modes only ever add to the index.",
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="walk the git history and add every (id, version) pair missing from the "
             "index, using the commit that introduced it",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="with --backfill, list what would be added without writing the index",
    )
    parser.add_argument(
        "--show-divergences",
        action="store_true",
        help="with --backfill, list indexed pairs whose recorded sha differs from the "
             "commit that introduced them (reported but never rewritten)",
    )
    args = parser.parse_args()

    if args.dry_run and not args.backfill:
        sys.exit("--dry-run only applies to --backfill.")
    if args.show_divergences and not args.backfill:
        sys.exit("--show-divergences only applies to --backfill.")

    if args.backfill:
        backfill(dry_run=args.dry_run, show_divergences=args.show_divergences)
    else:
        main()
