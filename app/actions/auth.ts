"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  revalidatePath("/");
  revalidatePath("/login");
  revalidatePath("/profile");
  revalidatePath("/settings");
  revalidatePath("/today");

  redirect("/login");
}
