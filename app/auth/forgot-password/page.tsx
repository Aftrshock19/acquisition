import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">Reset password</h1>
        <p className="app-subtitle">
          Enter your email and we&rsquo;ll send you a link to reset your
          password.
        </p>
      </section>
      <div className="app-card p-6">
        <ForgotPasswordForm />
      </div>
      <p className="text-sm text-zinc-500">
        <Link href="/login" className="underline">
          Back to login
        </Link>
      </p>
    </main>
  );
}
