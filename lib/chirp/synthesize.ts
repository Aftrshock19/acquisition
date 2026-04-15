/**
 * Server-only Google Cloud Text-to-Speech (Chirp) synthesis.
 *
 * Uses @google-cloud/text-to-speech with Application Default Credentials.
 * Never import this module on the client.
 */

import { TextToSpeechClient } from "@google-cloud/text-to-speech";

// ── Defaults ──────────────────────────────────────────────────

const DEFAULT_VOICE =
  process.env.GOOGLE_TTS_VOICE_SUPPORT ?? "es-ES-Chirp3-HD-Leda";

/**
 * Maximum safe bytes per synthesis request.  The Cloud TTS v1 API
 * accepts up to 5 000 bytes of plain-text input.  We use a slightly
 * lower ceiling so a sentence that straddles the boundary is never
 * split mid-word.
 */
const MAX_REQUEST_BYTES = 4800;

/** Initial backoff for transient failures (ms). */
const INITIAL_BACKOFF_MS = 1000;
const MAX_RETRIES = 3;

/**
 * Dedicated backoff schedule for RESOURCE_EXHAUSTED (code 8).
 * Chirp HD voices enforce per-minute quotas — short retries (<10s) are
 * useless because the quota bucket refills per minute. Wait long enough
 * to cross a quota window.
 */
const QUOTA_BACKOFF_MS = [15_000, 30_000, 60_000, 90_000];

// ── Singleton client ──────────────────────────────────────────

let _client: TextToSpeechClient | null = null;

function getClient(): TextToSpeechClient {
  if (!_client) {
    _client = new TextToSpeechClient();
  }
  return _client;
}

// ── Public types ──────────────────────────────────────────────

export type SynthesizeResult = {
  /** Complete MP3 audio (merged if chunked). */
  audioBytes: Buffer;
  /** Number of API requests made (>1 if chunked). */
  requestCount: number;
};

export type SynthesizeChirpOptions = {
  text: string;
  voiceName?: string;
};

// ── Main entry point ──────────────────────────────────────────

/**
 * Synthesize Spanish speech with Google Cloud Chirp.
 *
 * Handles passages longer than the API byte limit by splitting on
 * sentence boundaries, synthesizing each chunk, and concatenating the
 * resulting MP3 frames.
 */
export async function synthesizeChirp({
  text,
  voiceName,
}: SynthesizeChirpOptions): Promise<SynthesizeResult> {
  if (!text.trim()) {
    throw new Error("Cannot synthesize empty text");
  }

  const voice = voiceName ?? DEFAULT_VOICE;
  const chunks = splitIntoChunks(text, MAX_REQUEST_BYTES);
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    const buf = await synthesizeOneChunk(chunk, voice);
    buffers.push(buf);
  }

  return {
    audioBytes: Buffer.concat(buffers),
    requestCount: chunks.length,
  };
}

// ── Internals ─────────────────────────────────────────────────

async function synthesizeOneChunk(
  text: string,
  voice: string,
): Promise<Buffer> {
  const languageCode = voice.slice(0, 5); // e.g. "es-ES"
  const client = getClient();

  let lastError: Error | null = null;
  let quotaAttempt = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const [response] = await client.synthesizeSpeech({
        input: { text },
        voice: { languageCode, name: voice },
        audioConfig: {
          audioEncoding: "MP3",
          sampleRateHertz: 24000,
        },
      });

      if (!response.audioContent) {
        throw new Error("Chirp response missing audioContent");
      }

      const audioBytes =
        response.audioContent instanceof Uint8Array
          ? Buffer.from(response.audioContent)
          : Buffer.from(response.audioContent as string, "base64");

      if (audioBytes.length === 0) {
        throw new Error("Chirp returned empty audio");
      }

      return audioBytes;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Only retry on transient errors (network, rate-limit, server errors)
      const code = (err as { code?: number }).code;
      const isQuota = code === 8; // RESOURCE_EXHAUSTED
      const isTransient =
        code === 14 || // UNAVAILABLE
        isQuota ||
        code === 4; // DEADLINE_EXCEEDED

      if (!isTransient) break;

      if (isQuota) {
        if (quotaAttempt >= QUOTA_BACKOFF_MS.length) break;
        const wait = QUOTA_BACKOFF_MS[quotaAttempt] + Math.random() * 2000;
        quotaAttempt++;
        attempt--; // quota retries don't count against MAX_RETRIES
        await sleep(wait);
        continue;
      }

      if (attempt === MAX_RETRIES) break;
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      await sleep(backoff + Math.random() * 500);
    }
  }

  throw lastError ?? new Error("Synthesis failed");
}

/**
 * Split text into chunks that each fit within `maxBytes` of UTF-8.
 * Splits on sentence boundaries (., !, ?, newlines) first, falling
 * back to any whitespace only if a single sentence exceeds the limit.
 */
export function splitIntoChunks(text: string, maxBytes: number): string[] {
  const totalBytes = Buffer.byteLength(text, "utf-8");
  if (totalBytes <= maxBytes) {
    return [text];
  }

  // Split into sentences preserving trailing punctuation
  const sentences = text.match(/[^.!?\n]+[.!?\n]?\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const combined = current + sentence;
    if (
      Buffer.byteLength(combined, "utf-8") > maxBytes &&
      current.length > 0
    ) {
      chunks.push(current.trimEnd());
      current = sentence;
    } else {
      current = combined;
    }
  }

  if (current.trim()) {
    chunks.push(current.trimEnd());
  }

  // Safety: if any chunk is still too large, force-split on whitespace
  const result: string[] = [];
  for (const chunk of chunks) {
    if (Buffer.byteLength(chunk, "utf-8") <= maxBytes) {
      result.push(chunk);
    } else {
      result.push(...forceWhitespaceSplit(chunk, maxBytes));
    }
  }

  return result;
}

function forceWhitespaceSplit(text: string, maxBytes: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (Buffer.byteLength(next, "utf-8") > maxBytes && current) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
