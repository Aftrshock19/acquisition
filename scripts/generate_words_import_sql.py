#!/usr/bin/env python3
"""Generate SQL that imports the canonical word list CSV into public.words.

The default output is safe to rerun on a database with users: it inserts ranks
that do not exist yet, only fills empty fields on existing words, and deletes
nothing. --overwrite and --prune bring back the old replace-everything import
and are meant for an empty or throwaway database. Apply the output with
`npm run seed` (scripts/seed.mjs); see supabase/README.md.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

BATCH_SIZE = 500
EXPECTED_HEADERS = [
    "rank",
    "lemma",
    "original_lemma",
    "translation",
    "definitions",
    "english_definition",
    "pos",
    "tags",
    "sentence",
    "english_sentence",
]
LEGACY_HEADERS = [
    "rank",
    "lemma",
    "original_lemma",
    "translation",
    "definitions",
    "english_definition",
    "pos",
    "sentence",
    "english_sentence",
]

PRUNE_WARNING = """\
!!! WARNING: --prune is set !!!
The generated SQL DELETEs every row of public.words whose rank is not in
{csv}. The delete cascades to user_words, review_events,
exposure_events, user_deck_words, definitions, word_forms and
placement_filtered_lemmas, so learners permanently lose their progress on
those words. Only apply it to an empty or throwaway database.
"""

# A CTE only lives for one statement, so both statements that read the
# normalized rows get their own copy.
NORMALIZED_CTE = """WITH normalized AS (
  SELECT
    rank,
    btrim(lemma) AS lemma,
    COALESCE(NULLIF(btrim(original_lemma), ''), btrim(lemma)) AS original_lemma,
    NULLIF(btrim(translation), '') AS translation,
    NULLIF(btrim(definitions), '') AS definition_es,
    NULLIF(btrim(english_definition), '') AS definition_en,
    public.normalize_word_pos(pos) AS pos,
    CASE
      WHEN NULLIF(btrim(tags), '') IS NULL THEN ARRAY[]::text[]
      ELSE regexp_split_to_array(
        regexp_replace(btrim(tags), E'\\\\s*\\\\|\\\\s*', '|', 'g'),
        E'\\\\|'
      )
    END AS tags,
    NULLIF(btrim(sentence), '') AS example_sentence,
    NULLIF(btrim(english_sentence), '') AS example_sentence_en
  FROM public.words_import_raw
  WHERE rank IS NOT NULL
)
"""

WORDS_INSERT = """INSERT INTO public.words (
  rank,
  lemma,
  original_lemma,
  translation,
  tags,
  pos,
  example_sentence,
  example_sentence_en
)
SELECT
  rank,
  lemma,
  original_lemma,
  translation,
  tags,
  pos,
  example_sentence,
  example_sentence_en
FROM normalized
ON CONFLICT (rank) DO UPDATE
"""

WORDS_OVERWRITE = """SET
  lemma = EXCLUDED.lemma,
  original_lemma = EXCLUDED.original_lemma,
  translation = EXCLUDED.translation,
  tags = EXCLUDED.tags,
  pos = EXCLUDED.pos,
  example_sentence = EXCLUDED.example_sentence,
  example_sentence_en = EXCLUDED.example_sentence_en;
"""

# Existing words keep their values (hand corrections included); only empty
# fields are filled, and only when the CSV row is still the same lemma. The
# example sentences are a pair (the English translates the Spanish): the
# Spanish is filled only when both are empty, the English only when both are
# empty or the stored Spanish is the CSV's sentence.
WORDS_FILL_EMPTY = """SET
  translation = COALESCE(words.translation, EXCLUDED.translation),
  tags = CASE WHEN cardinality(words.tags) = 0 THEN EXCLUDED.tags ELSE words.tags END,
  example_sentence = CASE
    WHEN words.example_sentence IS NULL AND words.example_sentence_en IS NULL
      THEN EXCLUDED.example_sentence
    ELSE words.example_sentence
  END,
  example_sentence_en = CASE
    WHEN words.example_sentence_en IS NULL
      AND (words.example_sentence IS NULL OR words.example_sentence = EXCLUDED.example_sentence)
      THEN EXCLUDED.example_sentence_en
    ELSE words.example_sentence_en
  END
WHERE words.lemma = EXCLUDED.lemma
  AND (
    (words.translation IS NULL AND EXCLUDED.translation IS NOT NULL)
    OR (cardinality(words.tags) = 0 AND cardinality(EXCLUDED.tags) > 0)
    OR (
      words.example_sentence IS NULL
      AND words.example_sentence_en IS NULL
      AND EXCLUDED.example_sentence IS NOT NULL
    )
    OR (
      words.example_sentence_en IS NULL
      AND (words.example_sentence IS NULL OR words.example_sentence = EXCLUDED.example_sentence)
      AND EXCLUDED.example_sentence_en IS NOT NULL
    )
  );
"""

PRUNE_WORDS = """-- --prune: cascades to user_words, review_events and exposure_events.
DELETE FROM public.words w
WHERE NOT EXISTS (
  SELECT 1
  FROM public.words_import_raw raw
  WHERE raw.rank = w.rank
);
"""

DEFINITIONS_INSERT = """INSERT INTO public.definitions (
  id,
  rank,
  lemma,
  translation,
  definition_es,
  definition_en
)
SELECT
  w.id,
  w.rank,
  w.lemma,
  COALESCE(w.translation, normalized.translation),
  normalized.definition_es,
  normalized.definition_en
FROM normalized
JOIN public.words w
  ON w.rank = normalized.rank
"""

DEFINITIONS_OVERWRITE = """ON CONFLICT (id) DO UPDATE
SET
  rank = EXCLUDED.rank,
  lemma = EXCLUDED.lemma,
  translation = EXCLUDED.translation,
  definition_es = EXCLUDED.definition_es,
  definition_en = EXCLUDED.definition_en;
"""

DEFINITIONS_FILL_EMPTY = """  AND w.lemma = normalized.lemma
ON CONFLICT (id) DO UPDATE
SET
  translation = COALESCE(definitions.translation, EXCLUDED.translation),
  definition_es = COALESCE(definitions.definition_es, EXCLUDED.definition_es),
  definition_en = COALESCE(definitions.definition_en, EXCLUDED.definition_en)
WHERE (definitions.translation IS NULL AND EXCLUDED.translation IS NOT NULL)
  OR (definitions.definition_es IS NULL AND EXCLUDED.definition_es IS NOT NULL)
  OR (definitions.definition_en IS NULL AND EXCLUDED.definition_en IS NOT NULL);
"""

UNLINK_WORD_FORMS = """UPDATE public.word_forms
SET word_id = NULL
WHERE lang = 'es';
"""

LINK_WORD_FORMS = """UPDATE public.word_forms wf
SET word_id = w.id
FROM public.words w
WHERE wf.lang = 'es'
  AND wf.word_id IS NULL
  AND wf.lemma = w.lemma;

WITH fallback AS (
  SELECT
    wf.id AS word_form_id,
    (
      SELECT w.id
      FROM public.words w
      WHERE w.original_lemma = wf.lemma
      ORDER BY w.rank ASC
      LIMIT 1
    ) AS word_id
  FROM public.word_forms wf
  WHERE wf.lang = 'es'
    AND wf.word_id IS NULL
)
UPDATE public.word_forms wf
SET word_id = fallback.word_id
FROM fallback
WHERE wf.id = fallback.word_form_id
  AND fallback.word_id IS NOT NULL;
"""


def sql_string(value: str | None) -> str:
    if value is None:
        return "NULL"
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    return "'" + normalized.replace("'", "''") + "'"


def sql_integer(value: str | None) -> str:
    if value is None:
        return "NULL"
    stripped = value.strip()
    if not stripped:
        return "NULL"
    return str(int(stripped))


def row_to_sql_values(row: dict[str, str]) -> str:
    return "(" + ", ".join(
        [
            sql_integer(row.get("rank")),
            sql_string(row.get("lemma")),
            sql_string(row.get("original_lemma")),
            sql_string(row.get("translation")),
            sql_string(row.get("definitions")),
            sql_string(row.get("english_definition")),
            sql_string(row.get("pos")),
            sql_string(row.get("tags")),
            sql_string(row.get("sentence")),
            sql_string(row.get("english_sentence")),
        ]
    ) + ")"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate SQL that imports the word list CSV into public.words.",
    )
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("output_sql", type=Path)
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help=(
            "replace lemma, original_lemma, translation, tags, pos, example "
            "sentences and definitions of existing ranks with the CSV values, "
            "and relink every Spanish word form (discards hand corrections)"
        ),
    )
    parser.add_argument(
        "--prune",
        action="store_true",
        help=(
            "DELETE words whose rank is not in the CSV; cascades to users' "
            "user_words, review_events and exposure_events"
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    input_csv: Path = args.input_csv
    output_sql: Path = args.output_sql

    if not input_csv.exists():
        print(f"Input CSV not found: {input_csv}", file=sys.stderr)
        return 1

    with input_csv.open(newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        if reader.fieldnames not in (EXPECTED_HEADERS, LEGACY_HEADERS):
            print(
                f"Unexpected CSV headers: {reader.fieldnames!r}",
                file=sys.stderr,
            )
            return 1

        rows = list(reader)

    if args.prune:
        if not rows:
            print(
                "Refusing --prune with an empty CSV: it would delete every word.",
                file=sys.stderr,
            )
            return 1
        print(PRUNE_WARNING.format(csv=input_csv), file=sys.stderr)

    flags = [flag for flag, on in (("--overwrite", args.overwrite), ("--prune", args.prune)) if on]

    output_sql.parent.mkdir(parents=True, exist_ok=True)

    with output_sql.open("w", encoding="utf-8") as sql_file:
        sql_file.write("-- Generated by scripts/generate_words_import_sql.py\n")
        sql_file.write(
            f"-- Flags: {' '.join(flags) if flags else 'none (insert new ranks, fill empty fields, delete nothing)'}\n"
        )
        sql_file.write("BEGIN;\n\n")
        sql_file.write(
            "ALTER TABLE IF EXISTS public.words_import_raw ADD COLUMN IF NOT EXISTS tags text;\n\n"
        )
        sql_file.write("TRUNCATE TABLE public.words_import_raw;\n\n")

        for start in range(0, len(rows), BATCH_SIZE):
            batch = rows[start : start + BATCH_SIZE]
            sql_file.write(
                "INSERT INTO public.words_import_raw (rank, lemma, original_lemma, translation, definitions, english_definition, pos, tags, sentence, english_sentence)\nVALUES\n"
            )
            sql_file.write(",\n".join(row_to_sql_values(row) for row in batch))
            sql_file.write(";\n\n")

        sql_file.write(NORMALIZED_CTE + WORDS_INSERT)
        sql_file.write(WORDS_OVERWRITE if args.overwrite else WORDS_FILL_EMPTY)
        sql_file.write("\n")

        if args.prune:
            sql_file.write(PRUNE_WORDS + "\n")

        sql_file.write(NORMALIZED_CTE + DEFINITIONS_INSERT)
        sql_file.write(DEFINITIONS_OVERWRITE if args.overwrite else DEFINITIONS_FILL_EMPTY)
        sql_file.write("\n")

        if args.overwrite:
            sql_file.write(UNLINK_WORD_FORMS + "\n")

        sql_file.write(LINK_WORD_FORMS + "\n")
        sql_file.write("COMMIT;\n")

    print(f"Wrote {output_sql}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
