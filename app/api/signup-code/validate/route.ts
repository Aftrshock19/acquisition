import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { validateSignupCode } from "@/lib/auth/signupCodes";

export const dynamic = "force-dynamic";

const INVALID = { state: "invalid_or_used" as const };

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
    return json(INVALID);
  }

  if (!body || typeof body !== "object") return json(INVALID);
  const { code, email } = body as { code?: unknown; email?: unknown };
  if (typeof code !== "string" || typeof email !== "string") {
    return json(INVALID);
  }
  if (!code.trim() || !email.trim()) {
    return json(INVALID);
  }

  try {
    const result = await validateSignupCode(code, email);
    return json(result);
  } catch (err) {
    console.error(
      `[api/signup-code/validate] threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return json(INVALID);
  }
}
