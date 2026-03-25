export type Grade = "again" | "hard" | "good" | "easy";

export type Word = {
  id: string;
  language: string;
  lemma: string;
  rank: number;
  definition: string | null;
  pos?: string | null;
  extra?: Record<string, unknown> | null;
};

/** Per-user SRS state (non-stationary half-life model) */
export type UserWord = {
  user_id: string;
  word_id: string;
  status: "learning" | "known" | "suspended";
  half_life_hours: number;
  target_p: number;
  last_review_at: string | null;
  due_at: string;
  reps: number;
  lapses: number;
  ewma_surprise: number;
  ewma_abs_surprise: number;
  ewma_accuracy: number;
  created_at: string;
  updated_at: string;
};

/** Item returned by get_daily_queue RPC */
export type QueueItem = {
  word_id: string;
  lemma: string;
  rank: number;
  kind: "review" | "new";
  surface: string | null;
  pos: string | null;
  extra: Record<string, unknown> | null;
  definition: string | null;
};

export type DueReviewItem = Word & {
  word_id: string;
  user_id: string;
  status: string;
  definition: string | null;
  pos?: string | null;
  extra?: Record<string, unknown> | null;
};

export type TodaySession = {
  dueReviews: DueReviewItem[];
  newWords: Word[];
  configMissing?: boolean;
  signedIn?: boolean;
  error?: string;
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

/** Payload for recordReview: grade is derived server-side from correct (good vs again). */
export type RecordReviewPayload = {
  wordId: string;
  correct: boolean;
  msSpent: number;
  userAnswer: string;
  expected: string[];
};

export type RecordExposurePayload = {
  wordId: string;
  kind: ExposureKind;
  weight?: number;
};
