import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Appendix — H1 participant-level receptive scores",
  description:
    "Complete-case H1 sample (n = 10): per-participant pre, post, and delta scores across UoS, Reading, Listening, and the total receptive battery.",
}

type H1ScoreRow = {
  participant: string
  uosPre: number
  uosPost: number
  uosDiff: number
  readingPre: number
  readingPost: number
  readingDiff: number
  listeningPre: number
  listeningPost: number
  listeningDiff: number
  totalPre: number
  totalPost: number
  totalDiff: number
}

const h1ScoreRows: H1ScoreRow[] = [
  { participant: "P035", uosPre: 3,  uosPost: 6,  uosDiff: 3,  readingPre: 5,  readingPost: 13, readingDiff: 8,  listeningPre: 1,  listeningPost: 7,  listeningDiff: 6,  totalPre: 9,  totalPost: 26, totalDiff: 17 },
  { participant: "P044", uosPre: 2,  uosPost: 11, uosDiff: 9,  readingPre: 13, readingPost: 18, readingDiff: 5,  listeningPre: 4,  listeningPost: 15, listeningDiff: 11, totalPre: 19, totalPost: 44, totalDiff: 25 },
  { participant: "P045", uosPre: 2,  uosPost: 14, uosDiff: 12, readingPre: 12, readingPost: 29, readingDiff: 17, listeningPre: 10, listeningPost: 8,  listeningDiff: -2, totalPre: 24, totalPost: 51, totalDiff: 27 },
  { participant: "P046", uosPre: 3,  uosPost: 28, uosDiff: 25, readingPre: 12, readingPost: 19, readingDiff: 7,  listeningPre: 4,  listeningPost: 9,  listeningDiff: 5,  totalPre: 19, totalPost: 56, totalDiff: 37 },
  { participant: "P047", uosPre: 1,  uosPost: 8,  uosDiff: 7,  readingPre: 3,  readingPost: 3,  readingDiff: 0,  listeningPre: 4,  listeningPost: 2,  listeningDiff: -2, totalPre: 8,  totalPost: 13, totalDiff: 5 },
  { participant: "P057", uosPre: 2,  uosPost: 12, uosDiff: 10, readingPre: 11, readingPost: 30, readingDiff: 19, listeningPre: 8,  listeningPost: 20, listeningDiff: 12, totalPre: 21, totalPost: 62, totalDiff: 41 },
  { participant: "P059", uosPre: 16, uosPost: 29, uosDiff: 13, readingPre: 34, readingPost: 34, readingDiff: 0,  listeningPre: 32, listeningPost: 35, listeningDiff: 3,  totalPre: 82, totalPost: 98, totalDiff: 16 },
  { participant: "P063", uosPre: 0,  uosPost: 17, uosDiff: 17, readingPre: 12, readingPost: 32, readingDiff: 20, listeningPre: 8,  listeningPost: 34, listeningDiff: 26, totalPre: 20, totalPost: 83, totalDiff: 63 },
  { participant: "P080", uosPre: 4,  uosPost: 15, uosDiff: 11, readingPre: 16, readingPost: 29, readingDiff: 13, listeningPre: 11, listeningPost: 30, listeningDiff: 19, totalPre: 31, totalPost: 74, totalDiff: 43 },
  { participant: "P083", uosPre: 0,  uosPost: 2,  uosDiff: 2,  readingPre: 2,  readingPost: 18, readingDiff: 16, listeningPre: 5,  listeningPost: 7,  listeningDiff: 2,  totalPre: 7,  totalPost: 27, totalDiff: 20 },
]

function deltaClass(d: number) {
  if (d > 0) return "text-emerald-700"
  if (d < 0) return "text-rose-700"
  return "text-neutral-500"
}

export default function AppendixH1ParticipantScoresPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-3 px-4 py-10">
      <div>
        <h1 className="text-lg font-semibold">
          H1 participant-level receptive scores
        </h1>
        <p className="text-sm text-neutral-600">
          Complete-case H1 sample, n = 10. Scores are receptive only.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full border-collapse text-xs">
          <caption className="caption-bottom px-3 py-2 text-left text-xs text-neutral-600">
            UoS, Reading, and Listening are each scored out of 36. Total
            receptive score is out of 108.
          </caption>
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-2 py-2 text-left font-semibold">Participant</th>
              <th className="px-2 py-2 text-right font-semibold">UoS pre</th>
              <th className="px-2 py-2 text-right font-semibold">UoS post</th>
              <th className="px-2 py-2 text-right font-semibold">Δ UoS</th>
              <th className="px-2 py-2 text-right font-semibold">Reading pre</th>
              <th className="px-2 py-2 text-right font-semibold">Reading post</th>
              <th className="px-2 py-2 text-right font-semibold">Δ Reading</th>
              <th className="px-2 py-2 text-right font-semibold">Listening pre</th>
              <th className="px-2 py-2 text-right font-semibold">Listening post</th>
              <th className="px-2 py-2 text-right font-semibold">Δ Listening</th>
              <th className="px-2 py-2 text-right font-semibold">Total pre</th>
              <th className="px-2 py-2 text-right font-semibold">Total post</th>
              <th className="px-2 py-2 text-right font-semibold">Δ Total</th>
            </tr>
          </thead>
          <tbody>
            {h1ScoreRows.map((row) => (
              <tr key={row.participant} className="border-t border-neutral-200">
                <td className="px-2 py-2 font-medium">{row.participant}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.uosPre}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.uosPost}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${deltaClass(row.uosDiff)}`}>{row.uosDiff > 0 ? `+${row.uosDiff}` : row.uosDiff}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.readingPre}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.readingPost}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${deltaClass(row.readingDiff)}`}>{row.readingDiff > 0 ? `+${row.readingDiff}` : row.readingDiff}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.listeningPre}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.listeningPost}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${deltaClass(row.listeningDiff)}`}>{row.listeningDiff > 0 ? `+${row.listeningDiff}` : row.listeningDiff}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.totalPre}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.totalPost}</td>
                <td className={`px-2 py-2 text-right tabular-nums font-semibold ${deltaClass(row.totalDiff)}`}>{row.totalDiff > 0 ? `+${row.totalDiff}` : row.totalDiff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
