import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { readFile } from "node:fs/promises"
import path from "node:path"

export const metadata: Metadata = {
  title: "View result",
  description: "Render a single locked results artefact (CSV, PDF, or PNG).",
}

const ALLOWED = new Set([
  "h1_participant_scores.csv",
  "engagement_profile.csv",
  "h1_anchor_form_summary.csv",
  "engagement_outcome_associations.csv",
  "interest_enjoyment_ratings.csv",
  "corrected_imi.csv",
  "usability_scores.csv",
])

type Kind = "csv" | "pdf" | "png"

function kindFor(file: string): Kind | null {
  if (file.endsWith(".csv")) return "csv"
  if (file.endsWith(".pdf")) return "pdf"
  if (file.endsWith(".png")) return "png"
  return null
}

function parseCsv(text: string): string[][] {
  // Minimal CSV parser: handles quoted fields with commas, doubled quotes for escaping.
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n") {
      row.push(field)
      field = ""
      rows.push(row)
      row = []
    } else if (c === "\r") {
      // skip
    } else {
      field += c
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c !== ""))
}

export default async function ResultViewPage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string }>
}) {
  const { file } = await searchParams
  if (!file || !ALLOWED.has(file)) {
    notFound()
  }
  const kind = kindFor(file)
  if (!kind) notFound()

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-10 text-zinc-900 dark:text-zinc-100">
      <nav className="text-sm">
        <Link href="/results" className="text-blue-700 underline dark:text-blue-300">
          ← Back to results
        </Link>
      </nav>
      <header>
        <h1 className="font-mono text-lg font-semibold">{file}</h1>
      </header>

      {kind === "csv" && <CsvTable file={file} />}
      {kind === "png" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/results/${file}`}
          alt={file}
          className="max-w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
        />
      )}
      {kind === "pdf" && (
        <iframe
          src={`/results/${file}`}
          title={file}
          className="h-[80vh] w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
        />
      )}

      <p className="pt-2 text-xs text-zinc-500 dark:text-zinc-400">
        <a
          href={`/results/${file}`}
          download
          className="text-blue-700 underline dark:text-blue-300"
        >
          Download raw file
        </a>
      </p>
    </main>
  )
}

async function CsvTable({ file }: { file: string }) {
  const fullPath = path.join(process.cwd(), "public", "results", file)
  const text = await readFile(fullPath, "utf8")
  const rows = parseCsv(text)
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">Empty CSV.</p>
  }
  const [header, ...body] = rows
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-zinc-100 dark:bg-zinc-800">
          <tr>
            {header.map((h, i) => (
              <th
                key={i}
                className="border-b border-zinc-200 px-3 py-2 text-left font-semibold text-zinc-900 whitespace-nowrap dark:border-zinc-700 dark:text-zinc-100"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
          {body.map((r, ri) => (
            <tr
              key={ri}
              className="border-t border-zinc-200 dark:border-zinc-800"
            >
              {r.map((c, ci) => {
                const numeric = /^-?\d+(\.\d+)?$/.test(c)
                return (
                  <td
                    key={ci}
                    className={`px-3 py-2 whitespace-nowrap ${
                      numeric ? "text-right tabular-nums" : "text-left"
                    }`}
                  >
                    {c}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
