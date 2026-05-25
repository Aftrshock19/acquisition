import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Appendix — Anchor vs form-specific item checks (H1)",
  description:
    "Per-participant breakdown of anchor (shared across forms) and form-specific items in the H1 battery, to allow inspection of potential item-memory effects.",
}

type Row = {
  p: string
  inst: string
  anchorPre: string
  anchorPost: string
  anchorDelta: number | null
  formPre: string
  formPost: string
  formDelta: number | null
}

const rows: Row[] = [
  { p: "P035", inst: "UOS",          anchorPre: "2/6",  anchorPost: "3/6",   anchorDelta: 1,  formPre: "1/6",  formPost: "3/6",   formDelta: 2 },
  { p: "P035", inst: "RL Reading",   anchorPre: "3/9",  anchorPost: "5/9",   anchorDelta: 2,  formPre: "2/9",  formPost: "8/9",   formDelta: 6 },
  { p: "P035", inst: "RL Listening", anchorPre: "1/3",  anchorPost: "3/6",   anchorDelta: 2,  formPre: "0/3",  formPost: "4/6",   formDelta: 4 },
  { p: "P044", inst: "UOS",          anchorPre: "1/3",  anchorPost: "6/9",   anchorDelta: 5,  formPre: "1/3",  formPost: "5/9",   formDelta: 4 },
  { p: "P044", inst: "RL Reading",   anchorPre: "7/18", anchorPost: "8/12",  anchorDelta: 1,  formPre: "6/18", formPost: "10/12", formDelta: 4 },
  { p: "P044", inst: "RL Listening", anchorPre: "2/3",  anchorPost: "7/12",  anchorDelta: 5,  formPre: "2/3",  formPost: "8/12",  formDelta: 6 },
  { p: "P045", inst: "UOS",          anchorPre: "1/9",  anchorPost: "6/9",   anchorDelta: 5,  formPre: "1/9",  formPost: "8/9",   formDelta: 7 },
  { p: "P045", inst: "RL Reading",   anchorPre: "7/18", anchorPost: "15/18", anchorDelta: 8,  formPre: "5/18", formPost: "14/18", formDelta: 9 },
  { p: "P045", inst: "RL Listening", anchorPre: "4/18", anchorPost: "4/6",   anchorDelta: 0,  formPre: "6/18", formPost: "4/6",   formDelta: -2 },
  { p: "P046", inst: "UOS",          anchorPre: "2/3",  anchorPost: "12/18", anchorDelta: 10, formPre: "1/3",  formPost: "16/18", formDelta: 15 },
  { p: "P046", inst: "RL Reading",   anchorPre: "7/15", anchorPost: "11/12", anchorDelta: 4,  formPre: "5/15", formPost: "8/12",  formDelta: 3 },
  { p: "P046", inst: "RL Listening", anchorPre: "1/6",  anchorPost: "3/6",   anchorDelta: 2,  formPre: "3/6",  formPost: "6/6",   formDelta: 3 },
  { p: "P047", inst: "UOS",          anchorPre: "0/6",  anchorPost: "4/6",   anchorDelta: 4,  formPre: "1/6",  formPost: "4/6",   formDelta: 3 },
  { p: "P047", inst: "RL Reading",   anchorPre: "1/3",  anchorPost: "2/3",   anchorDelta: 1,  formPre: "2/3",  formPost: "1/3",   formDelta: -1 },
  { p: "P047", inst: "RL Listening", anchorPre: "1/3",  anchorPost: "0/3",   anchorDelta: -1, formPre: "3/3",  formPost: "2/3",   formDelta: -1 },
  { p: "P057", inst: "UOS",          anchorPre: "1/6",  anchorPost: "6/9",   anchorDelta: 5,  formPre: "1/6",  formPost: "6/9",   formDelta: 5 },
  { p: "P057", inst: "RL Reading",   anchorPre: "6/18", anchorPost: "16/18", anchorDelta: 10, formPre: "5/18", formPost: "14/18", formDelta: 9 },
  { p: "P057", inst: "RL Listening", anchorPre: "3/18", anchorPost: "11/12", anchorDelta: 8,  formPre: "5/18", formPost: "9/12",  formDelta: 4 },
  { p: "P059", inst: "UOS",          anchorPre: "9/12", anchorPost: "13/18", anchorDelta: 4,  formPre: "7/12", formPost: "16/18", formDelta: 9 },
  { p: "P059", inst: "RL Reading",   anchorPre: "17/18",anchorPost: "17/18", anchorDelta: 0,  formPre: "17/18",formPost: "17/18", formDelta: 0 },
  { p: "P059", inst: "RL Listening", anchorPre: "16/18",anchorPost: "17/18", anchorDelta: 1,  formPre: "16/18",formPost: "18/18", formDelta: 2 },
  { p: "P063", inst: "UOS",          anchorPre: "0/6",  anchorPost: "7/12",  anchorDelta: 7,  formPre: "0/6",  formPost: "10/12", formDelta: 10 },
  { p: "P063", inst: "RL Reading",   anchorPre: "8/18", anchorPost: "17/18", anchorDelta: 9,  formPre: "4/18", formPost: "15/18", formDelta: 11 },
  { p: "P063", inst: "RL Listening", anchorPre: "3/18", anchorPost: "16/18", anchorDelta: 13, formPre: "5/18", formPost: "18/18", formDelta: 13 },
  { p: "P080", inst: "UOS",          anchorPre: "1/12", anchorPost: "8/9",   anchorDelta: 7,  formPre: "3/12", formPost: "7/9",   formDelta: 4 },
  { p: "P080", inst: "RL Reading",   anchorPre: "8/18", anchorPost: "12/18", anchorDelta: 4,  formPre: "8/18", formPost: "17/18", formDelta: 9 },
  { p: "P080", inst: "RL Listening", anchorPre: "5/18", anchorPost: "17/18", anchorDelta: 12, formPre: "6/18", formPost: "13/18", formDelta: 7 },
  { p: "P083", inst: "UOS",          anchorPre: "0/3",  anchorPost: "0/3",   anchorDelta: 0,  formPre: "0/3",  formPost: "2/3",   formDelta: 2 },
  { p: "P083", inst: "RL Reading",   anchorPre: "1/9",  anchorPost: "8/12",  anchorDelta: 7,  formPre: "1/9",  formPost: "10/12", formDelta: 9 },
  { p: "P083", inst: "RL Listening", anchorPre: "1/6",  anchorPost: "3/6",   anchorDelta: 2,  formPre: "4/6",  formPost: "4/6",   formDelta: 0 },
]

function fmtDelta(d: number | null) {
  if (d === null) return "-"
  if (d > 0) return `+${d}`
  return String(d)
}

function deltaClass(d: number | null) {
  if (d === null) return ""
  if (d > 0) return "text-emerald-700"
  if (d < 0) return "text-rose-700"
  return "text-neutral-500"
}

export default function AppendixAnchorFormChecksPage() {
  // Rows where anchor delta exceeds form delta by >1 — flagged as potential memory effects
  const flag = (r: Row) =>
    r.anchorDelta !== null && r.formDelta !== null && r.anchorDelta - r.formDelta > 1

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-10">
      <div>
        <h1 className="text-lg font-semibold">
          Anchor vs form-specific item checks (H1 battery)
        </h1>
        <p className="text-sm text-neutral-600">
          Each CEFR band administers two sets of items: <em>anchor</em> items
          (1-3 per band, identical content shared across Form A and Form B,
          with option order shuffled) and <em>form-specific</em> items (4-6
          per band, different content per form). If post-test gains were
          driven by item memory rather than learning, we would expect
          systematically larger gains on anchor than on form-specific items.
          The table below shows per-participant correct/attempted counts for
          each subset.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full border-collapse text-sm">
          <caption className="caption-bottom px-3 py-2 text-left text-xs text-neutral-600">
            Anchor and form-specific item performance per participant. A
            yellow row flag indicates anchor delta exceeds form delta by more
            than one item, which would be consistent with an item-memory
            effect.
          </caption>
          <thead className="bg-neutral-50">
            <tr>
              <th rowSpan={2} className="border-r border-neutral-200 px-3 py-2 text-left font-semibold">
                Participant
              </th>
              <th rowSpan={2} className="border-r border-neutral-200 px-3 py-2 text-left font-semibold">
                Instrument
              </th>
              <th colSpan={3} className="border-r border-b border-neutral-200 px-3 py-2 text-center font-semibold">
                Anchor (shared)
              </th>
              <th colSpan={3} className="border-b border-neutral-200 px-3 py-2 text-center font-semibold">
                Form-specific
              </th>
            </tr>
            <tr>
              <th className="px-3 py-1 text-right font-medium">Pre</th>
              <th className="px-3 py-1 text-right font-medium">Post</th>
              <th className="border-r border-neutral-200 px-3 py-1 text-right font-medium">Δ</th>
              <th className="px-3 py-1 text-right font-medium">Pre</th>
              <th className="px-3 py-1 text-right font-medium">Post</th>
              <th className="px-3 py-1 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const flagged = flag(r)
              const sameP = i > 0 && rows[i - 1].p === r.p
              return (
                <tr
                  key={`${r.p}-${r.inst}`}
                  className={`border-t border-neutral-200 ${flagged ? "bg-amber-50" : ""}`}
                >
                  <td className={`border-r border-neutral-200 px-3 py-2 ${sameP ? "text-neutral-400" : "font-medium"}`}>
                    {sameP ? "" : r.p}
                  </td>
                  <td className="border-r border-neutral-200 px-3 py-2">{r.inst}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.anchorPre}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.anchorPost}</td>
                  <td className={`border-r border-neutral-200 px-3 py-2 text-right tabular-nums ${deltaClass(r.anchorDelta)}`}>
                    {fmtDelta(r.anchorDelta)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.formPre}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.formPost}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${deltaClass(r.formDelta)}`}>
                    {fmtDelta(r.formDelta)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 text-sm text-neutral-600">
        <p>
          <strong>How to read it:</strong> Pre and post cells show correct /
          attempted on items of that type (anchor or form-specific) across
          all bands the participant attempted. Counts can differ between pre
          and post because the adaptive system administers different numbers
          of bands depending on session performance.
        </p>
        <p>
          <strong>Interpretation:</strong> Across the cohort, form-specific
          gains are comparable to or larger than anchor gains for most
          participants, which argues against a pervasive item-memory effect
          in the post-test scores. Rows flagged in amber are individual
          cases where the anchor gain noticeably exceeds the form-specific
          gain and may warrant closer inspection.
        </p>
      </div>
    </main>
  )
}
