import { cookies } from "next/headers";

export const MCQ_QUESTION_FORMATS_COOKIE = "mcq_question_formats";

export type McqQuestionFormat = "single_word" | "sentence";

export const DEFAULT_MCQ_QUESTION_FORMATS: McqQuestionFormat[] = [
  "single_word",
];

const ALL_MCQ_QUESTION_FORMATS: McqQuestionFormat[] = [
  "single_word",
  "sentence",
];

function extractMcqQuestionFormats(
  value: string | null | undefined,
): McqQuestionFormat[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is McqQuestionFormat =>
      ALL_MCQ_QUESTION_FORMATS.includes(item as McqQuestionFormat),
    );
}

export function parseMcqQuestionFormats(
  value: string | null | undefined,
): McqQuestionFormat[] {
  const parsed = extractMcqQuestionFormats(value);

  return parsed.length > 0 ? [...new Set(parsed)] : DEFAULT_MCQ_QUESTION_FORMATS;
}

export function readRequestedMcqQuestionFormats(
  value: string | null | undefined,
): McqQuestionFormat[] {
  return [...new Set(extractMcqQuestionFormats(value))];
}

export function serializeMcqQuestionFormats(
  formats: readonly McqQuestionFormat[],
): string {
  const normalized = formats.filter((format, index) => {
    return (
      ALL_MCQ_QUESTION_FORMATS.includes(format) &&
      formats.indexOf(format) === index
    );
  });

  const resolved =
    normalized.length > 0 ? normalized : DEFAULT_MCQ_QUESTION_FORMATS;

  return resolved.join(",");
}

export async function getMcqQuestionFormatsPreference() {
  const cookieStore = await cookies();
  return parseMcqQuestionFormats(
    cookieStore.get(MCQ_QUESTION_FORMATS_COOKIE)?.value,
  );
}
