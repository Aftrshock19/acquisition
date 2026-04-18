#!/usr/bin/env python3
"""Generate Spanish titles for listening passage .txt files.

Each file's first line is expected to be a title wrapped as ---Title---.
This script replaces that title (or prepends one if missing) using Claude.
"""

from __future__ import annotations

import argparse
import os
import random
import re
import sys
import time
from collections import Counter
from pathlib import Path

import anthropic
from anthropic import Anthropic

INPUT_DIR = Path("/Users/bassam/Projects/acquisition/listening_passages/passages")
MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 50
TEMPERATURE = 0.7

SYSTEM_PROMPT = """You generate titles for Spanish reading passages used in a language-learning app. Rules:
- Output ONLY the title. No quotation marks, no preamble, no explanation.
- Title must be in Spanish.
- Exactly 2 to 5 words. Never more.
- Specific and evocative, not generic. Prefer 'El cumpleaños de mi abuela' over 'La familia'. Prefer 'Un domingo en Sevilla' over 'Un día'.
- No trailing punctuation.
- Match the register of the passage (formal passages get formal titles; casual ones get casual)."""

TITLE_RE = re.compile(r"^---(.*)---\s*$")
TRIM_QUOTES_RE = re.compile(r"^[\"'«»“”‘’`]+|[\"'«»“”‘’`]+$")
TRIM_PUNCT_RE = re.compile(r"[.!?,;:]+$")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true", help="Process 5 random files, no writes")
    p.add_argument("--limit", type=int, default=None, help="Process only the first N files")
    p.add_argument("--force", action="store_true", help="Regenerate even if a title is already present")
    return p.parse_args()


def api_key_or_die() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        print("ERROR: ANTHROPIC_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)
    return key


def clean_title(raw: str) -> str:
    t = raw.strip()
    t = TRIM_QUOTES_RE.sub("", t)
    t = TRIM_PUNCT_RE.sub("", t)
    return t.strip()


def parse_file(raw: str) -> tuple[str, str, bool]:
    """Return (old_title, body, has_title_line)."""
    nl = raw.find("\n")
    first = raw if nl == -1 else raw[:nl]
    rest = "" if nl == -1 else raw[nl + 1 :]
    m = TITLE_RE.match(first)
    if m:
        return m.group(1).strip(), rest, True
    return "", raw, False


class TitleTooLongError(Exception):
    def __init__(self, title: str):
        self.title = title
        super().__init__(f"title too long after retry: {title}")


def _messages_create_with_retry(client: Anthropic, **kwargs):
    delays = [1, 2, 4]
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            return client.messages.create(**kwargs)
        except (
            anthropic.RateLimitError,
            anthropic.APIConnectionError,
            anthropic.InternalServerError,
        ) as e:
            last_err = e
            if attempt < 2:
                time.sleep(delays[attempt])
    assert last_err is not None
    raise last_err


def _call_title(client: Anthropic, messages: list[dict]) -> str:
    resp = _messages_create_with_retry(
        client,
        model=MODEL,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise RuntimeError("No text block in API response")
    title = clean_title(text)
    if not title:
        raise RuntimeError("Empty title after cleaning")
    return title


def generate_title(client: Anthropic, passage: str) -> str:
    messages: list[dict] = [{"role": "user", "content": passage}]
    title = _call_title(client, messages)
    if len(title.split()) <= 5:
        return title
    messages.append({"role": "assistant", "content": title})
    messages.append(
        {
            "role": "user",
            "content": "Previous attempt was too long. Exactly 2 to 5 words. Output only the title.",
        }
    )
    retry = _call_title(client, messages)
    if len(retry.split()) > 5:
        raise TitleTooLongError(retry)
    return retry


def main() -> None:
    args = parse_args()
    client = Anthropic(api_key=api_key_or_die())

    all_files = sorted(p.name for p in INPUT_DIR.glob("*.txt"))

    if args.dry_run:
        files = random.sample(all_files, min(5, len(all_files)))
        print("DRY RUN: processing 5 random files (no writes).")
    elif args.limit is not None:
        if args.limit <= 0:
            print("ERROR: --limit must be positive", file=sys.stderr)
            sys.exit(1)
        files = all_files[: args.limit]
        print(f"LIMIT: processing first {len(files)} files.")
    else:
        files = all_files

    succeeded: list[str] = []
    failed: list[tuple[str, str]] = []
    skipped = 0

    for i, filename in enumerate(files, start=1):
        path = INPUT_DIR / filename
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as e:
            print(f"Processed {i}/{len(files)}: {filename} -> READ ERROR: {e}", file=sys.stderr)
            failed.append((filename, f"read: {e}"))
            continue

        old_title, body, has_title_line = parse_file(raw)

        if not args.force and has_title_line and old_title:
            skipped += 1
            continue

        passage = body.strip()
        if not passage:
            print(f"Processed {i}/{len(files)}: {filename} -> MISSING passage body", file=sys.stderr)
            failed.append((filename, "missing passage body"))
            continue

        try:
            new_title = generate_title(client, passage)
        except TitleTooLongError as e:
            print(f"Processed {i}/{len(files)}: {filename} -> TOO LONG: {e.title}", file=sys.stderr)
            failed.append((filename, f"title too long after retry: {e.title}"))
            continue
        except Exception as e:
            print(f"Processed {i}/{len(files)}: {filename} -> API ERROR: {e}", file=sys.stderr)
            failed.append((filename, f"api: {e}"))
            continue

        print(f"Processed {i}/{len(files)}: {filename} -> '{old_title}' -> '{new_title}'")

        if not args.dry_run:
            title_line = f"---{new_title}---"
            updated = f"{title_line}\n{body}" if has_title_line else f"{title_line}\n{raw}"
            path.write_text(updated, encoding="utf-8")
        succeeded.append(filename)

    print("\n=== Summary ===")
    print(f"Total processed: {len(files)}")
    print(f"Succeeded:       {len(succeeded)}")
    print(f"Skipped (already titled): {skipped}")
    print(f"Failed:          {len(failed)}")
    if failed:
        print("Failed files:")
        for f, err in failed:
            print(f"  - {f}: {err}")

    if not args.dry_run:
        titles: list[str] = []
        for f in sorted(p.name for p in INPUT_DIR.glob("*.txt")):
            try:
                raw = (INPUT_DIR / f).read_text(encoding="utf-8")
            except OSError:
                continue
            old_title, _, has_title_line = parse_file(raw)
            if has_title_line and old_title:
                titles.append(old_title)
        counts = Counter(titles)
        print(f"\n=== Title stats across {len(titles)} files ===")
        print(f"Unique titles: {len(counts)} / {len(titles)}")
        dupes = [(t, n) for t, n in counts.most_common(10) if n > 1]
        if not dupes:
            print("No duplicate titles remain.")
        else:
            print("Top 10 most-duplicated titles:")
            for t, n in dupes:
                print(f"  {n}x  {t}")


if __name__ == "__main__":
    main()
