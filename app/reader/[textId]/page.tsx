import { getTextById } from "@/lib/loop/texts";
import { toReadingBlocks } from "@/lib/loop/reader";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ textId: string }>;
}) {
  const { textId } = await params;
  const text = getTextById(textId);
  const blocks = toReadingBlocks(text?.content ?? "");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {text?.title ?? "Reader"}
        </h1>
        {text?.source ? (
          <p className="text-sm text-zinc-500">{text.source}</p>
        ) : null}
      </header>

      <section className="flex flex-col gap-4">
        {blocks.length === 0 ? (
          <p className="text-zinc-600">No text found for “{textId}”.</p>
        ) : (
          blocks.map((block, idx) => (
            <p key={`${idx}-${block.slice(0, 12)}`} className="leading-7">
              {block}
            </p>
          ))
        )}
      </section>
    </main>
  );
}

