import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ListeningTextRow = {
  id: string;
  title: string;
  content: string;
  lang: string;
  stage: string;
  stage_index: number | null;
  display_label: string | null;
  passage_mode: string;
  passage_number: number;
  difficulty_cefr: string;
  word_count: number | null;
  estimated_minutes: number | null;
};

type ListeningAssetRow = {
  id: string;
  text_id: string;
  title: string;
  url: string;
  transcript: string | null;
  duration_seconds: number | null;
  variant_type: string;
  storage_path: string | null;
  status: string;
  created_at: string;
  texts: ListeningTextRow | ListeningTextRow[] | null;
};

export type ListeningAsset = {
  id: string;
  textId: string;
  title: string;
  audioUrl: string;
  transcript: string | null;
  durationSeconds: number | null;
  variantType: string;
  storagePath: string | null;
  createdAt: string;
  text: {
    id: string;
    title: string;
    content: string;
    lang: string;
    stage: string;
    stageIndex: number | null;
    displayLabel: string | null;
    passageMode: string;
    passageNumber: number;
    difficultyCefr: string;
    wordCount: number | null;
    estimatedMinutes: number | null;
  } | null;
};

const ASSET_SELECT = `
  id,
  text_id,
  title,
  url,
  transcript,
  duration_seconds,
  variant_type,
  storage_path,
  status,
  created_at,
  texts (
    id,
    title,
    content,
    lang,
    stage,
    stage_index,
    display_label,
    passage_mode,
    passage_number,
    difficulty_cefr,
    word_count,
    estimated_minutes
  )
`;

export async function getListeningAssetById(
  supabase: SupabaseServerClient,
  id: string,
): Promise<ListeningAsset | null> {
  if (!UUID_RE.test(id)) {
    return null;
  }

  const { data, error } = await supabase
    .from("audio")
    .select(ASSET_SELECT)
    .eq("id", id)
    .eq("status", "ready")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? toListeningAsset(data as ListeningAssetRow) : null;
}

/**
 * Fetch the support audio asset for a text.
 * Prefers variant_type = 'support' with status = 'ready'.
 */
export async function getListeningAssetForTextId(
  supabase: SupabaseServerClient,
  textId: string,
): Promise<ListeningAsset | null> {
  if (!UUID_RE.test(textId)) {
    return null;
  }

  const { data, error } = await supabase
    .from("audio")
    .select(ASSET_SELECT)
    .eq("text_id", textId)
    .eq("variant_type", "support")
    .eq("status", "ready")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? toListeningAsset(data as ListeningAssetRow) : null;
}

export async function getListeningIndexData(
  supabase: SupabaseServerClient,
): Promise<ListeningAsset[]> {
  const { data, error } = await supabase
    .from("audio")
    .select(ASSET_SELECT)
    .eq("status", "ready")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as ListeningAssetRow[])
    .map(toListeningAsset)
    .sort(compareListeningAssets);
}

function toListeningAsset(row: ListeningAssetRow): ListeningAsset {
  const text = normalizeText(row.texts);

  return {
    id: row.id,
    textId: row.text_id,
    title: row.title,
    audioUrl: row.url,
    transcript: row.transcript ?? null,
    durationSeconds: row.duration_seconds ?? null,
    variantType: row.variant_type ?? "support",
    storagePath: row.storage_path ?? null,
    createdAt: row.created_at,
    text: text
      ? {
          id: text.id,
          title: text.title,
          content: text.content,
          lang: text.lang,
          stage: text.stage,
          stageIndex: text.stage_index ?? null,
          displayLabel: text.display_label ?? null,
          passageMode: text.passage_mode,
          passageNumber: text.passage_number,
          difficultyCefr: text.difficulty_cefr,
          wordCount: text.word_count ?? null,
          estimatedMinutes: text.estimated_minutes ?? null,
        }
      : null,
  };
}

function normalizeText(text: ListeningAssetRow["texts"]) {
  if (!text) {
    return null;
  }

  return Array.isArray(text) ? text[0] ?? null : text;
}

function compareListeningAssets(a: ListeningAsset, b: ListeningAsset) {
  const byTextTitle = (a.text?.title ?? "").localeCompare(
    b.text?.title ?? "",
    "es",
    { sensitivity: "base" },
  );
  if (byTextTitle !== 0) {
    return byTextTitle;
  }

  const byTitle = a.title.localeCompare(b.title, "es", { sensitivity: "base" });
  if (byTitle !== 0) {
    return byTitle;
  }

  return a.id.localeCompare(b.id);
}

// Navigation order matches the visual grouping on the listening index page:
// stageIndex → mode → passageNumber → title → id
const NAV_MODE_ORDER = ["short", "medium", "long", "very_long"];

function compareForNav(a: ListeningAsset, b: ListeningAsset): number {
  const aStage = a.text?.stageIndex ?? 0;
  const bStage = b.text?.stageIndex ?? 0;
  if (aStage !== bStage) return aStage - bStage;

  const aModeIdx = NAV_MODE_ORDER.indexOf(a.text?.passageMode ?? "");
  const bModeIdx = NAV_MODE_ORDER.indexOf(b.text?.passageMode ?? "");
  const aModeOrder = aModeIdx >= 0 ? aModeIdx : NAV_MODE_ORDER.length;
  const bModeOrder = bModeIdx >= 0 ? bModeIdx : NAV_MODE_ORDER.length;
  if (aModeOrder !== bModeOrder) return aModeOrder - bModeOrder;

  const aPassage = a.text?.passageNumber ?? 0;
  const bPassage = b.text?.passageNumber ?? 0;
  if (aPassage !== bPassage) return aPassage - bPassage;

  return (
    a.title.localeCompare(b.title, "es", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id)
  );
}

export async function getListeningNavNeighbors(
  supabase: SupabaseServerClient,
  currentAssetId: string,
): Promise<{ prevId: string | null; nextId: string | null }> {
  const all = await getListeningIndexData(supabase);
  const sorted = [...all].sort(compareForNav);
  const idx = sorted.findIndex((a) => a.id === currentAssetId);
  if (idx < 0) return { prevId: null, nextId: null };
  return {
    prevId: idx > 0 ? sorted[idx - 1]!.id : null,
    nextId: idx < sorted.length - 1 ? sorted[idx + 1]!.id : null,
  };
}
