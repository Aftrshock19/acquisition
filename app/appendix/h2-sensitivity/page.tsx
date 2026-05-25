import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Appendix — H2 sensitivity analyses",
  description:
    "Exploratory engagement-outcome Spearman associations using the log-verified H1 subset.",
}

type AssociationRow = {
  engagementMeasure: string
  outcomeChange: string
  rho: string
  p: string
}

const associationRows: AssociationRow[] = [
  {
    engagementMeasure: "Active-day rate",
    outcomeChange: "Total receptive gain",
    rho: ".45",
    p: ".222",
  },
  {
    engagementMeasure: "Completed-loop rate",
    outcomeChange: "Total receptive gain",
    rho: "-.18",
    p: ".651",
  },
  {
    engagementMeasure: "Flashcard-review rate",
    outcomeChange: "UoS gain",
    rho: ".07",
    p: ".865",
  },
  {
    engagementMeasure: "Reading-completion rate",
    outcomeChange: "Reading gain",
    rho: ".09",
    p: ".815",
  },
  {
    engagementMeasure: "Listening-completion rate",
    outcomeChange: "Listening gain",
    rho: ".42",
    p: ".265",
  },
]

export default function AppendixH2SensitivityPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-3 px-4 py-10">
      <div>
        <h1 className="text-lg font-semibold">
          Exploratory engagement outcome associations
        </h1>
        <p className="text-sm text-neutral-600">
          Spearman associations for the log-verified H1 subset, n = 9. P083 was
          excluded from this log-based table because their engagement logs were
          inconsistent with interview evidence of app use. These associations are
          descriptive only.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full border-collapse text-sm">
          <caption className="caption-bottom px-3 py-2 text-left text-xs text-neutral-600">
            Exploratory Spearman associations between app engagement and outcome
            change. Engagement rates account for different intervention windows.
          </caption>
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">
                Engagement measure
              </th>
              <th className="px-3 py-2 text-left font-semibold">
                Outcome change
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                Spearman ρ
              </th>
              <th className="px-3 py-2 text-right font-semibold">p</th>
            </tr>
          </thead>
          <tbody>
            {associationRows.map((row) => (
              <tr
                key={`${row.engagementMeasure}-${row.outcomeChange}`}
                className="border-t border-neutral-200"
              >
                <td className="px-3 py-2">{row.engagementMeasure}</td>
                <td className="px-3 py-2">{row.outcomeChange}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.rho}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.p}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-neutral-600">
        These results are not treated as dose-response evidence. They are
        included only to show the direction and approximate size of engagement
        outcome patterns in the audited log data.
      </p>
    </main>
  )
}
