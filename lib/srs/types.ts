export type Grade = "again" | "hard" | "good" | "easy";
export type FlashcardType = "cloze" | "normal" | "audio" | "mcq" | "sentences";
export type ClozeDirection = "en_to_es" | "es_to_en";
export type NormalDirection = "en_to_es" | "es_to_en";

export type Word = {
  id: string;
  language: string;
  lemma: string;
  rank: number;
  translation?: string | null;
  definition: string | null;
  definitionEs?: string | null;
  definitionEn?: string | null;
  exampleSentence?: string | null;
  exampleSentenceEn?: string | null;
  pos?: string | null;
  extra?: Record<string, unknown> | null;
};

/** Per-user current learning state for one user_id + word_id row. */
export type UserWord = {
  user_id: string;
  word_id: string;
  status: "learning" | "known" | "suspended";
  due_at: string;
  attempts: number;
  correct_attempts: number;
  accuracy: number;
  difficulty: number;
  last_seen_at: string | null;
  last_graded_at: string | null;
  reps_today: number;
  reps_today_date: string | null;
  half_life_hours?: number;
  target_p?: number;
  last_review_at?: string | null;
  reps?: number;
  lapses?: number;
  ewma_surprise?: number;
  ewma_abs_surprise?: number;
  ewma_accuracy?: number;
  created_at: string;
  updated_at: string;
};

/** Item returned by get_daily_queue RPC */
export type QueueItem = {
  word_id: string;
  lemma: string;
  rank: number;
  kind: "review" | "new";
  pos: string | null;
  translation: string | null;
  definition_es: string | null;
  definition_en: string | null;
  example_sentence: string | null;
  example_sentence_en: string | null;
  definition: string | null;
};

export type DueReviewItem = Word & {
  word_id: string;
  user_id: string;
  status: string;
  pos?: string | null;
};

export type TodaySession = {
  dueReviews: DueReviewItem[];
  newWords: Word[];
  configMissing?: boolean;
  signedIn?: boolean;
  error?: string;
};

export type DailySessionRow = {
  id: string;
  user_id: string;
  session_date: string;
  stage: "flashcards" | "reading" | "listening" | "complete";
  new_words_count: number;
  reviews_done: number;
  reading_done: boolean;
  reading_text_id: string | null;
  reading_completed_at: string | null;
  listening_done: boolean;
  listening_asset_id: string | null;
  listening_completed_at: string | null;
  listening_max_position_seconds: number | null;
  listening_required_seconds: number | null;
  listening_transcript_opened: boolean;
  listening_playback_rate: number | null;
  completed: boolean;
  created_at: string;
  updated_at: string;
};

export type ReviewState = {
  next_review: string;
  interval_days: number;
  ease_factor: number;
  repetitions: number;
};

export type ExposureKind =
  | "reader_tap"
  | "reader_seen"
  | "listening_seen";

/** Payload for recordReview. grade may be explicit for self-rated cards like normal. */
export type RecordReviewPayload = {
  wordId: string;
  correct: boolean;
  grade?: Grade;
  cardType?: FlashcardType;
  msSpent: number;
  userAnswer: string;
  expected: string[];
};

export type RecordExposurePayload = {
  wordId: string;
  kind: ExposureKind;
  weight?: number;
};
