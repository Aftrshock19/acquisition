import Link from "next/link";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Login</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Sign in or create an account to use daily reviews and new words.
      </p>
      <LoginForm />
      <p className="text-sm text-zinc-500">
        <Link href="/" className="underline">Back to home</Link>
      </p>
    </main>
  );
}
