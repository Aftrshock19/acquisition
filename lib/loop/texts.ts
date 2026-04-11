import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ReaderText } from "@/lib/reader/types";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReadingIndexCollectionRow = {
  id: string;
  title: string;
  lang: string;
  author: string | null;
  description: string | null;
  collection_type: string | null;
};

type ReadingIndexRow = {
  id: string;
  lang: string;
  title: string;
  collection_id: string | null;
  order_index: number | null;
  section_number: number | null;
  word_count: number | null;
  estimated_minutes: number | null;
  difficulty_cefr: string | null;
  display_label: string | null;
  passage_mode: string | null;
  stage_index: number | null;
  created_at: string;
  text_collections:
    | ReadingIndexCollectionRow
    | ReadingIndexCollectionRow[]
    | null;
};

export type ReadingIndexText = {
  id: string;
  lang: string;
  title: string;
  collectionId: string | null;
  orderIndex: number | null;
  sectionNumber: number | null;
  wordCount: number | null;
  estimatedMinutes: number | null;
  difficultyCefr: string | null;
  displayLabel: string | null;
  passageMode: string | null;
  stageIndex: number | null;
};

export type ReadingIndexCollection = {
  id: string;
  title: string;
  lang: string;
  author: string | null;
  description: string | null;
  collectionType: string | null;
  texts: ReadingIndexText[];
};

export type ReadingIndexData = {
  collections: ReadingIndexCollection[];
  standaloneTexts: ReadingIndexText[];
};

export async function getTextById(
  supabase: SupabaseServerClient,
  id: string,
): Promise<ReaderText | null> {
  if (!UUID_RE.test(id)) {
    return null;
  }

  const { data, error } = await supabase
    .from("texts")
    .select(
      `
        id,
        lang,
        title,
        content,
        collection_id,
        order_index,
        section_number,
        word_count,
        estimated_minutes,
        difficulty_cefr,
        text_collections (
          id,
          title,
          lang,
          author,
          description,
          collection_type
        )
      `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const collection = Array.isArray(data.text_collections)
    ? data.text_collections[0]
    : data.text_collections;

  return {
    id: data.id,
    lang: data.lang,
    title: data.title,
    content: data.content,
    collectionId: data.collection_id ?? null,
    orderIndex: data.order_index ?? null,
    sectionNumber: data.section_number ?? null,
    wordCount: data.word_count ?? null,
    estimatedMinutes: data.estimated_minutes ?? null,
    difficultyCefr: data.difficulty_cefr ?? null,
    collection: collection
      ? {
          id: collection.id,
          title: collection.title,
          lang: collection.lang,
          author: collection.author ?? null,
          description: collection.description ?? null,
          collectionType: collection.collection_type ?? null,
        }
      : null,
  };
}

export async function getReadingIndexData(
  supabase: SupabaseServerClient,
): Promise<ReadingIndexData> {
  const { data, error } = await supabase
    .from("texts")
    .select(
      `
        id,
        lang,
        title,
        collection_id,
        order_index,
        section_number,
        word_count,
        estimated_minutes,
        difficulty_cefr,
        display_label,
        passage_mode,
        stage_index,
        created_at,
        text_collections (
          id,
          title,
          lang,
          author,
          description,
          collection_type
        )
      `,
    );

  if (error) {
    throw new Error(error.message);
  }

  const collections = new Map<string, ReadingIndexCollection>();
  const standaloneTexts: ReadingIndexText[] = [];

  for (const row of (data ?? []) as ReadingIndexRow[]) {
    const text = toReadingIndexText(row);
    const collection = normalizeCollection(row.text_collections);

    if (!collection || !row.collection_id) {
      standaloneTexts.push(text);
      continue;
    }

    const existing = collections.get(collection.id);

    if (existing) {
      existing.texts.push(text);
      continue;
    }

    collections.set(collection.id, {
      id: collection.id,
      title: collection.title,
      lang: collection.lang,
      author: collection.author ?? null,
      description: collection.description ?? null,
      collectionType: collection.collection_type ?? null,
      texts: [text],
    });
  }

  return {
    collections: Array.from(collections.values())
      .map((collection) => ({
        ...collection,
        texts: collection.texts.sort(compareReadingIndexTexts),
      }))
      .sort(compareReadingIndexCollections),
    standaloneTexts: standaloneTexts.sort(compareReadingIndexTexts),
  };
}

function toReadingIndexText(row: ReadingIndexRow): ReadingIndexText {
  return {
    id: row.id,
    lang: row.lang,
    title: row.title,
    collectionId: row.collection_id ?? null,
    orderIndex: row.order_index ?? null,
    sectionNumber: row.section_number ?? null,
    wordCount: row.word_count ?? null,
    estimatedMinutes: row.estimated_minutes ?? null,
    difficultyCefr: row.difficulty_cefr ?? null,
    displayLabel: row.display_label ?? null,
    passageMode: row.passage_mode ?? null,
    stageIndex: row.stage_index ?? null,
  };
}

function normalizeCollection(
  collection: ReadingIndexRow["text_collections"],
): ReadingIndexCollectionRow | null {
  if (!collection) {
    return null;
  }

  return Array.isArray(collection) ? collection[0] ?? null : collection;
}

function compareNullableNumber(a: number | null, b: number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareReadingIndexTexts(a: ReadingIndexText, b: ReadingIndexText) {
  const byOrder = compareNullableNumber(a.orderIndex, b.orderIndex);
  if (byOrder !== 0) return byOrder;

  const bySection = compareNullableNumber(a.sectionNumber, b.sectionNumber);
  if (bySection !== 0) return bySection;

  const byTitle = a.title.localeCompare(b.title, "es", { sensitivity: "base" });
  if (byTitle !== 0) return byTitle;

  return a.id.localeCompare(b.id);
}

function compareReadingIndexCollections(
  a: ReadingIndexCollection,
  b: ReadingIndexCollection,
) {
  const byTitle = a.title.localeCompare(b.title, "es", { sensitivity: "base" });
  if (byTitle !== 0) return byTitle;

  return a.id.localeCompare(b.id);
}
