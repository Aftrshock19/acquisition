/**
 * Analyze [auth/callback] log lines to detect email-link prefetcher double-hits.
 *
 * Usage:
 *   npx tsx scripts/analyze-auth-callback-logs.ts <logfile>
 *   vercel logs --output raw | grep '[auth/callback]' | npx tsx scripts/analyze-auth-callback-logs.ts
 *
 * Each relevant log line has the format emitted by app/auth/callback/route.ts:
 *   [auth/callback] hit code=XXXXXXXX ua=... ip=... t=1713400000000
 *
 * The script groups hits by code fingerprint and flags repeated codes where the
 * first hit's user-agent matches known link scanners (Gmail image proxy, Outlook
 * Safe Links, Proofpoint, Mimecast, etc.) — the signature of a prefetcher
 * consuming the PKCE code before the real user clicks.
 */

import { createReadStream } from "fs";
import { createInterface } from "readline";

// ---------------------------------------------------------------------------
// Known scanner UA patterns (case-insensitive)
// ---------------------------------------------------------------------------
const SCANNER_PATTERNS = [
  /GoogleImageProxy/i,
  /Proofpoint/i,
  /Barracuda/i,
  /Mimecast/i,
  /Microsoft/i,
  /bot/i,
  /crawler/i,
  /HeadlessChrome/i,
];

function looksLikeBrowser(ua: string): boolean {
  const hasMozilla = /Mozilla\/5\.0/i.test(ua);
  const hasWebkit = /AppleWebKit/i.test(ua);
  const hasGecko = /Gecko/i.test(ua);
  return hasMozilla && (hasWebkit || hasGecko);
}

function isScannerUA(ua: string): boolean {
  if (SCANNER_PATTERNS.some((p) => p.test(ua))) return true;
  if (!looksLikeBrowser(ua)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Log line parser
// ---------------------------------------------------------------------------
interface Hit {
  code: string;
  ua: string;
  ip: string;
  t: number;
  raw: string;
}

const HIT_RE =
  /\[auth\/callback\]\s+hit\s+code=(\S+)\s+ua=(.*?)\s+ip=(\S+)\s+t=(\d+)/;

function parseLine(line: string): Hit | null {
  const m = HIT_RE.exec(line);
  if (!m) return null;
  return {
    code: m[1],
    ua: m[2],
    ip: m[3],
    t: Number(m[4]),
    raw: line,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const filePath = process.argv[2];

  let input: NodeJS.ReadableStream;
  if (filePath) {
    try {
      input = createReadStream(filePath, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: could not open ${filePath} — ${msg}`);
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    input = process.stdin;
  } else {
    console.error(
      "Usage: npx tsx scripts/analyze-auth-callback-logs.ts <logfile>\n" +
        "       cat logs.txt | npx tsx scripts/analyze-auth-callback-logs.ts",
    );
    process.exit(1);
  }

  const rl = createInterface({ input, crlfDelay: Infinity });

  const hitsByCode = new Map<string, Hit[]>();
  let totalHits = 0;

  for await (const line of rl) {
    const hit = parseLine(line);
    if (!hit || hit.code === "none") continue;
    totalHits++;
    const list = hitsByCode.get(hit.code);
    if (list) {
      list.push(hit);
    } else {
      hitsByCode.set(hit.code, [hit]);
    }
  }

  if (totalHits === 0) {
    console.log("No [auth/callback] hit lines found in input.");
    process.exit(0);
  }

  // Sort each group by timestamp
  for (const hits of hitsByCode.values()) {
    hits.sort((a, b) => a.t - b.t);
  }

  const uniqueCodes = hitsByCode.size;
  const repeatedCodes = [...hitsByCode.entries()].filter(
    ([, hits]) => hits.length > 1,
  );

  // ---- Summary ----
  console.log("=== Auth Callback Log Analysis ===\n");
  console.log(`Total callback hits:          ${totalHits}`);
  console.log(`Unique code fingerprints:     ${uniqueCodes}`);
  console.log(`Repeated code fingerprints:   ${repeatedCodes.length}`);

  // ---- Repeated codes detail ----
  if (repeatedCodes.length > 0) {
    console.log("\n--- Repeated Code Fingerprints ---\n");
    for (const [code, hits] of repeatedCodes) {
      console.log(`  code=${code}  (${hits.length} hits)`);
      for (const h of hits) {
        const time = new Date(h.t).toISOString();
        console.log(`    ${time}  ip=${h.ip}  ua=${h.ua}`);
      }
      console.log();
    }
  }

  // ---- Flagged: scanner first-hit ----
  const flagged = repeatedCodes.filter(([, hits]) => isScannerUA(hits[0].ua));

  if (flagged.length > 0) {
    console.log("--- FLAGGED: Suspected Scanner Prefetch ---\n");
    for (const [code, hits] of flagged) {
      console.log(`  code=${code}  first-hit UA looks like a scanner`);
      console.log(`    first:  ${new Date(hits[0].t).toISOString()}  ua=${hits[0].ua}`);
      if (hits.length > 1) {
        console.log(
          `    second: ${new Date(hits[1].t).toISOString()}  ua=${hits[1].ua}`,
        );
      }
      console.log();
    }
    console.log(
      `${flagged.length} code(s) likely consumed by a link scanner before the user clicked.`,
    );
  } else if (repeatedCodes.length > 0) {
    console.log(
      "--- No repeated codes had a scanner-like UA on the first hit. ---",
    );
  } else {
    console.log("\nNo repeated code fingerprints detected — no double-hit evidence.");
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
