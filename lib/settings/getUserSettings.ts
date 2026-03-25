import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserSettingsRow } from "./types";

const DEFAULT_SETTINGS: UserSettingsRow = {
  user_id: "",
  learning_lang: "es",
  daily_plan_mode: "recommended",
  manual_daily_card_limit: 200,
  flashcard_selection_mode: "recommended",
  include_cloze: true,
  include_normal: true,
  include_audio: false,
  include_mcq: false,
  include_sentences: false,
  retry_delay_seconds: 90,
  show_pos_hint: true,
  show_definition_first: true,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

export async function getUserSettings() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { settings: DEFAULT_SETTINGS, exists: false, signedIn: false };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { settings: DEFAULT_SETTINGS, exists: false, signedIn: false };
  }

  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // On error, fall back to defaults but mark signed-in
    return {
      settings: { ...DEFAULT_SETTINGS, user_id: user.id },
      exists: false,
      signedIn: true,
    };
  }

  if (!data) {
    return {
      settings: { ...DEFAULT_SETTINGS, user_id: user.id },
      exists: false,
      signedIn: true,
    };
  }

  return { settings: data as UserSettingsRow, exists: true, signedIn: true };
}
