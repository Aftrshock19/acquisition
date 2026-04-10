#!/usr/bin/env python3
"""
Check which local migrations have and haven't been applied to the linked Supabase project.

Usage:
    python scripts/check_migrations.py

Requires:
    supabase CLI installed, logged in (`supabase login`), and linked (`supabase link`).
"""

import re
import subprocess
import sys


def main() -> None:
    result = subprocess.run(
        ["supabase", "migration", "list", "--linked"],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(result.stderr.strip(), file=sys.stderr)
        sys.exit(1)

    # Parse the table output. Rows look like:
    #   20260226120000 | abc123 | 2026-02-26 12:00:00
    # Remote column is blank if not applied remotely.
    pending = []
    applied = []

    for line in result.stdout.splitlines():
        # Skip header / separator lines
        if not re.match(r"\s+\d+", line):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 2:
            continue
        version = parts[0].strip()
        remote = parts[1].strip()
        if remote:
            applied.append(version)
        else:
            pending.append(version)

    print(result.stdout)
    print(f"Applied: {len(applied)}  Pending: {len(pending)}")

    if pending:
        print("\nPending migrations (in order):")
        for v in pending:
            print(f"  {v}")
        sys.exit(1)


if __name__ == "__main__":
    main()
