import { readdir } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";

export const dynamic = "force-static";

async function findResultsFile(): Promise<string | null> {
  const dir = path.join(process.cwd(), "public", "results");
  try {
    const files = await readdir(dir);
    const pdf = files.find((f) => f.toLowerCase().endsWith(".pdf"));
    return pdf ?? null;
  } catch {
    return null;
  }
}

export default async function ResultsPage() {
  const file = await findResultsFile();
  if (!file) notFound();

  const src = `/results/${encodeURIComponent(file)}`;

  return (
    <main className="fixed inset-0 bg-zinc-100 dark:bg-zinc-950">
      <object data={src} type="application/pdf" className="h-full w-full">
        <iframe src={src} className="h-full w-full border-0" title="Results" />
      </object>
    </main>
  );
}
