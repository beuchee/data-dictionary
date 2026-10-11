#!/usr/bin/env python3
"""Build legacy/data_inline.js and legacy/data.json from concept_sets/, projects/, units/ and mapping_recommendations/.

Runs snapshot.py first (stamps new concept set versions at HEAD), then the static
payload builder. Implementation: apps/api/app/services/catalog_build.py (standard
library only), shared with the v2 API; this script is its command line.
"""

import os
import sys

import snapshot

ROOT = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(ROOT, "legacy")

catalog_build = snapshot.load_service("catalog_build")


def main():
    config_path = os.path.join(ROOT, "config.json")
    if not os.path.isfile(config_path):
        raise SystemExit(f"Missing config.json at {config_path}. See config.json in the repo root.")

    print("Updating concept_sets_versions.json...")
    snapshot.main()

    try:
        catalog_build.build(ROOT, DOCS, log=print)
    except catalog_build.BuildError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
