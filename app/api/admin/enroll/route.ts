import { NextRequest, NextResponse } from "next/server";
import { requireResearcher } from "@/lib/admin/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/admin/enroll?cohort=default
 * Lists all enrolled participants in a cohort.
 *
 * POST /api/admin/enroll
 * Body: { email: string, cohort_key?: string, participant_id?: string }
 * Enrolls a user by email. Generates a sequential participant ID if not provided.
 */

export async function GET(request: NextRequest) {
  const auth = await requireResearcher();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured." },
      { status: 503 },
    );
  }

  const cohortKey = request.nextUrl.searchParams.get("cohort") ?? "default";

  const { data, error } = await serviceClient
    .from("study_enrollments")
    .select("id, user_id, cohort_key, participant_id, enrolled_at")
    .eq("cohort_key", cohortKey)
    .order("enrolled_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Look up emails for display (service role can read auth.users via admin API)
  const enrollments = await Promise.all(
    (data ?? []).map(async (row) => {
      const { data: userData } = await serviceClient.auth.admin.getUserById(
        row.user_id,
      );
      return {
        ...row,
        email: userData?.user?.email ?? null,
      };
    }),
  );

  return NextResponse.json({ cohort_key: cohortKey, enrollments });
}

export async function POST(request: NextRequest) {
  const auth = await requireResearcher();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured." },
      { status: 503 },
    );
  }

  let body: { email?: string; cohort_key?: string; participant_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: "email is required." },
      { status: 400 },
    );
  }

  const cohortKey = body.cohort_key?.trim() || "default";

  // Look up user by email via Supabase admin API
  const { data: userList, error: listError } =
    await serviceClient.auth.admin.listUsers({ perPage: 1000 });

  if (listError) {
    return NextResponse.json(
      { error: `Failed to list users: ${listError.message}` },
      { status: 500 },
    );
  }

  const targetUser = userList.users.find(
    (u) => u.email?.toLowerCase() === email,
  );

  if (!targetUser) {
    return NextResponse.json(
      { error: `No user found with email "${email}".` },
      { status: 404 },
    );
  }

  // Generate participant ID if not provided
  let participantId = body.participant_id?.trim();
  if (!participantId) {
    const { count, error: countError } = await serviceClient
      .from("study_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("cohort_key", cohortKey);

    if (countError) {
      return NextResponse.json(
        { error: `Failed to count enrollments: ${countError.message}` },
        { status: 500 },
      );
    }

    const nextNumber = (count ?? 0) + 1;
    participantId = `P${String(nextNumber).padStart(3, "0")}`;
  }

  // Insert enrollment
  const { data: enrollment, error: insertError } = await serviceClient
    .from("study_enrollments")
    .insert({
      user_id: targetUser.id,
      cohort_key: cohortKey,
      participant_id: participantId,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "User is already enrolled in this cohort." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: insertError.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      enrolled: {
        ...enrollment,
        email: targetUser.email,
      },
    },
    { status: 201 },
  );
}
