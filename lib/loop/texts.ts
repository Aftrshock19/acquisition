import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ReaderText } from "@/lib/reader/types";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getTextById(
  supabase: SupabaseServerClient,
  id: string,
): Promise<ReaderText | null> {
  if (!UUID_RE.test(id)) {
    return null;
  }

  const { data, error } = await supabase
    .from("texts")
    .select("id, lang, title, content")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    lang: data.lang,
    title: data.title,
    content: data.content,
  };
}
