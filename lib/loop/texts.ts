export type LoopText = {
  id: string;
  title: string;
  source?: string;
  content: string;
};

const TEXTS: LoopText[] = [
  {
    id: "welcome",
    title: "Welcome",
    source: "Local stub",
    content:
      "Welcome to Acquisition. Replace this sample text with your own corpus.",
  },
];

export function listTexts(): LoopText[] {
  return TEXTS;
}

export function getTextById(id: string): LoopText | undefined {
  return TEXTS.find((t) => t.id === id);
}

