import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { claimSignupCode } from "@/lib/auth/signupCodes";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const FAIL = { ok: false as const };

function json(data: unknown) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(FAIL);
  }

  if (!body || typeof body !== "object") return json(FAIL);
  const { code, email, userId } = body as {
    code?: unknown;
    email?: unknown;
    userId?: unknown;
  };
  if (
    typeof code !== "string" ||
    typeof email !== "string" ||
    typeof userId !== "string"
  ) {
    return json(FAIL);
  }
  if (!code.trim() || !email.trim() || !userId.trim()) {
    return json(FAIL);
  }

  // Verify the userId actually belongs to a Supabase auth user whose email
  // matches what the client is claiming. Without this, an authenticated client
  // could claim a code for an arbitrary userId/email pair.
  const admin = createSupabaseServiceClient();
  if (!admin) {
    console.error(`[api/signup-code/claim] no service client`);
    return json(FAIL);
  }

  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) {
      console.warn(
        `[api/signup-code/claim] getUserById failed for ${userId}: ${error?.message ?? "no user"}`,
      );
      return json(FAIL);
    }
    const userEmail = data.user.email;
    if (
      typeof userEmail !== "string" ||
      userEmail.trim().toLowerCase() !== email.trim().toLowerCase()
    ) {
      console.warn(
        `[api/signup-code/claim] email mismatch for user ${userId}`,
      );
      return json(FAIL);
    }
  } catch (err) {
    console.error(
      `[api/signup-code/claim] admin lookup threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return json(FAIL);
  }

  try {
    const result = await claimSignupCode(code, userId, email);
    if (!result.ok) {
      console.warn(
        `[api/signup-code/claim] claim refused for user ${userId}: ${result.error}`,
      );
      return json(FAIL);
    }
    return json({ ok: true });
  } catch (err) {
    console.error(
      `[api/signup-code/claim] claim threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return json(FAIL);
  }
}
