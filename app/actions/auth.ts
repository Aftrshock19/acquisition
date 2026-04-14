"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  // Sign-out invalidates every per-user shell. Cold paths; fan-out is fine.
  revalidatePath("/"); // perf-ok: sign-out
  revalidatePath("/login"); // perf-ok: sign-out
  revalidatePath("/profile"); // perf-ok: sign-out
  revalidatePath("/settings"); // perf-ok: sign-out
  revalidatePath("/today"); // perf-ok: sign-out

  redirect("/login");
}
