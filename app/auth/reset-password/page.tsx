import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash, type } = await searchParams;

  if (!token_hash || type !== "recovery") {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Invalid reset link</h1>
          <p className="app-subtitle">
            This password reset link is invalid or has expired.
          </p>
        </section>
        <p className="text-sm text-zinc-500">
          <Link href="/auth/forgot-password" className="underline">
            Request a new reset link
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">Set new password</h1>
        <p className="app-subtitle">Enter your new password below.</p>
      </section>
      <div className="app-card p-6">
        <ResetPasswordForm tokenHash={token_hash} type={type} />
      </div>
      <p className="text-sm text-zinc-500">
        <Link href="/login" className="underline">
          Back to login
        </Link>
      </p>
    </main>
  );
}
