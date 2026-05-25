import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Additional Result Tables",
};

type Artefact = {
  file: string;
  title: string;
  description: string;
};

const artefacts: Artefact[] = [
  {
    file: "h1_participant_scores.csv",
    title: "H1 Participant Scores",
    description:
      "How each H1 participant scored before and after using Acquisition.",
  },
  {
    file: "engagement_profile.csv",
    title: "Engagement Profile",
    description: "How often each H1 participant used the app during the study.",
  },
  {
    file: "h1_anchor_form_summary.csv",
    title: "Anchor and Form-Specific Checks",
    description:
      "A check of whether gains also appeared on new test items, not only repeated ones.",
  },
  {
    file: "engagement_outcome_associations.csv",
    title: "Engagement–Outcome Associations",
    description:
      "A small descriptive check of whether higher app use tended to go with larger score gains.",
  },
  {
    file: "interest_enjoyment_ratings.csv",
    title: "Interest and Enjoyment Ratings (IMI)",
    description:
      "How participants rated Acquisition and their past Duolingo experience for interest and enjoyment.",
  },
  {
    file: "corrected_imi.csv",
    title: "Corrected Interest and Enjoyment Ratings (IMI)",
    description:
      "The same interest and enjoyment comparison with participants who were suitable for the analysis.",
  },
  {
    file: "usability_scores.csv",
    title: "Usability Scores (SUS)",
    description:
      "How participants rated Acquisition’s ease of use on the SUS scale.",
  },
];

export default function ResultsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Additional Result Tables</h1>
      <ul className="space-y-3">
        {artefacts.map((a) => (
          <li key={a.file}>
            <Link
              href={`/results/view?file=${encodeURIComponent(a.file)}`}
              className="block rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-400 hover:shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500"
            >
              <h2 className="text-sm font-semibold leading-snug text-blue-700 underline dark:text-blue-300">
                {a.title}
              </h2>
              <p className="mt-2 text-xs text-neutral-700 dark:text-zinc-300">
                {a.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
