import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ReadingPassage,
  ReadingPassageSummary,
  ReadingQuestion,
  ReadingStageGroup,
} from "./types";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Row types matching texts + reading_questions ───────────

type TextPassageRow = {
  id: string;
  stage: string;
  stage_index: number;
  display_label: string;
  difficulty_cefr: string;
  passage_mode: string;
  passage_number: number;
  title: string;
  content: string;
  word_count: number | null;
  estimated_minutes: number | null;
};

type QuestionRow = {
  id: string;
  question_index: number;
  question_type: string;
  question_en: string;
  options_en: string[];
  correct_option_index: number;
};

// ── Converters ─────────────────────────────────────────────

function toSummary(row: TextPassageRow): ReadingPassageSummary {
  return {
    id: row.id,
    stage: row.stage,
    stageIndex: row.stage_index,
    displayLabel: row.display_label,
    difficultyCefr: row.difficulty_cefr,
    mode: row.passage_mode as ReadingPassageSummary["mode"],
    passageNumber: row.passage_number,
    title: row.title,
    wordCount: row.word_count,
    estimatedMinutes: row.estimated_minutes,
  };
}

function toQuestion(row: QuestionRow): ReadingQuestion {
  return {
    id: row.id,
    questionIndex: row.question_index,
    questionType: row.question_type as ReadingQuestion["questionType"],
    questionEn: row.question_en,
    optionsEn: row.options_en,
    correctOptionIndex: row.correct_option_index,
  };
}

// ── In-memory cache for passage index (same for all users) ──

let _cachedIndex: ReadingStageGroup[] | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Queries ────────────────────────────────────────────────

const PASSAGE_SUMMARY_COLUMNS =
  "id, stage, stage_index, display_label, difficulty_cefr, passage_mode, passage_number, title, word_count, estimated_minutes";

/**
 * List all imported passages grouped by stage, then by mode.
 * Queries from texts WHERE stage IS NOT NULL.
 * Result is cached in memory for 5 minutes (same for all users).
 */
export async function getPassageIndex(
  supabase: SupabaseServerClient,
): Promise<ReadingStageGroup[]> {
  if (_cachedIndex && Date.now() - _cachedAt < CACHE_TTL_MS) {
    return _cachedIndex;
  }

  const { data, error } = await supabase
    .from("texts")
    .select(PASSAGE_SUMMARY_COLUMNS)
    .not("stage", "is", null)
    .order("stage_index", { ascending: true })
    .order("order_index", { ascending: true });

  if (error) throw new Error(error.message);

  const stageMap = new Map<string, ReadingStageGroup>();
  const MODE_ORDER = ["short", "medium", "long", "very_long"];

  for (const row of (data ?? []) as TextPassageRow[]) {
    const summary = toSummary(row);

    let group = stageMap.get(row.stage);
    if (!group) {
      group = {
        stage: row.stage,
        stageIndex: row.stage_index,
        displayLabel: row.display_label,
        modes: [],
      };
      stageMap.set(row.stage, group);
    }

    let modeGroup = group.modes.find((m) => m.mode === row.passage_mode);
    if (!modeGroup) {
      modeGroup = { mode: row.passage_mode, passages: [] };
      group.modes.push(modeGroup);
    }

    modeGroup.passages.push(summary);
  }

  for (const group of stageMap.values()) {
    group.modes.sort(
      (a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode),
    );
  }

  const result = Array.from(stageMap.values()).sort(
    (a, b) => a.stageIndex - b.stageIndex,
  );

  _cachedIndex = result;
  _cachedAt = Date.now();

  return result;
}

/**
 * List all passages for a given stage index.
 */
export async function getPassagesByStage(
  supabase: SupabaseServerClient,
  stageIdx: number,
): Promise<ReadingPassageSummary[]> {
  const { data, error } = await supabase
    .from("texts")
    .select(PASSAGE_SUMMARY_COLUMNS)
    .eq("stage_index", stageIdx)
    .not("stage", "is", null)
    .order("order_index", { ascending: true });

  if (error) throw new Error(error.message);

  return ((data ?? []) as TextPassageRow[]).map(toSummary);
}

/**
 * Get a single passage by text ID, including its comprehension questions.
 */
export async function getPassageById(
  supabase: SupabaseServerClient,
  id: string,
): Promise<ReadingPassage | null> {
  if (!UUID_RE.test(id)) return null;

  const { data: textData, error: textError } = await supabase
    .from("texts")
    .select(PASSAGE_SUMMARY_COLUMNS + ", content")
    .eq("id", id)
    .not("stage", "is", null)
    .maybeSingle();

  if (textError) throw new Error(textError.message);
  if (!textData) return null;

  const row = textData as unknown as TextPassageRow;

  const { data: questionData, error: questionError } = await supabase
    .from("reading_questions")
    .select(
      "id, question_index, question_type, question_en, options_en, correct_option_index",
    )
    .eq("text_id", id)
    .order("question_index", { ascending: true });

  if (questionError) throw new Error(questionError.message);

  return {
    ...toSummary(row),
    content: row.content,
    questions: ((questionData ?? []) as QuestionRow[]).map(toQuestion),
  };
}

/**
 * Get comprehension questions for a text, if any exist.
 * Works for any text ID — returns empty array if none are linked.
 */
export async function getQuestionsForText(
  supabase: SupabaseServerClient,
  textId: string,
): Promise<ReadingQuestion[]> {
  if (!UUID_RE.test(textId)) return [];

  const { data, error } = await supabase
    .from("reading_questions")
    .select(
      "id, question_index, question_type, question_en, options_en, correct_option_index",
    )
    .eq("text_id", textId)
    .order("question_index", { ascending: true });

  if (error) throw new Error(error.message);

  return ((data ?? []) as QuestionRow[]).map(toQuestion);
}

/**
 * Get aggregate counts for admin overview.
 */
export async function getPassageCounts(
  supabase: SupabaseServerClient,
): Promise<{ passages: number; questions: number; stages: number }> {
  const { count: passages, error: pErr } = await supabase
    .from("texts")
    .select("id", { count: "exact", head: true })
    .not("stage", "is", null);

  if (pErr) throw new Error(pErr.message);

  const { count: questions, error: qErr } = await supabase
    .from("reading_questions")
    .select("id", { count: "exact", head: true });

  if (qErr) throw new Error(qErr.message);

  const { data: stageData, error: sErr } = await supabase
    .from("texts")
    .select("stage_index")
    .not("stage", "is", null);

  if (sErr) throw new Error(sErr.message);

  const uniqueStages = new Set(
    (stageData ?? []).map((r: { stage_index: number }) => r.stage_index),
  );

  return {
    passages: passages ?? 0,
    questions: questions ?? 0,
    stages: uniqueStages.size,
  };
}
