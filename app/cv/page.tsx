import { readdir } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";

export const dynamic = "force-static";

async function findCvFile(): Promise<string | null> {
  const cvDir = path.join(process.cwd(), "public", "cv");
  try {
    const files = await readdir(cvDir);
    const pdf = files.find((f) => f.toLowerCase().endsWith(".pdf"));
    return pdf ?? null;
  } catch {
    return null;
  }
}

export default async function CvPage() {
  const file = await findCvFile();
  if (!file) notFound();

  const src = `/cv/${encodeURIComponent(file)}`;

  return (
    <main className="fixed inset-0 bg-zinc-100 dark:bg-zinc-950">
      <object data={src} type="application/pdf" className="h-full w-full">
        <iframe src={src} className="h-full w-full border-0" title="CV" />
      </object>
    </main>
  );
}
