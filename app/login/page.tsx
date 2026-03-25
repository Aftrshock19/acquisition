import Link from "next/link";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">Login</h1>
        <p className="app-subtitle">
          Sign in or create an account to use daily reviews and new words.
        </p>
      </section>
      <div className="app-card p-6">
        <LoginForm />
      </div>
      <p className="text-sm text-zinc-500">
        <Link href="/" className="underline">Back to home</Link>
      </p>
    </main>
  );
}
