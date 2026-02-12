export type Flashcard = {
  front: string;
  back: string;
};

export function Flashcards({ cards }: { cards: Flashcard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-lg font-semibold tracking-tight">Flashcards</h2>
      <ul className="list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-200">
        {cards.map((c, idx) => (
          <li key={`${idx}-${c.front.slice(0, 12)}`}>
            {c.front} — {c.back}
          </li>
        ))}
      </ul>
    </section>
  );
}

