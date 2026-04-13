# Chirp Listening Pipeline

Pre-generated Google Cloud Chirp audio for the daily listening step.

## Architecture

```
listening_passages/*.txt
  → scripts/generate-chirp-audio.ts
    → Google Cloud TTS (Chirp)
    → Supabase Storage (listening-audio bucket)
    → audio table row (linked to texts row)
  → /listening/[assetId] page (ListeningPlayer)
```

Audio is synthesized offline and stored. No live TTS during user sessions.

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (server/scripts only) |
| `GOOGLE_CLOUD_PROJECT_ID` | No | GCP project ID (default: `acquisition-493119`) |
| `GOOGLE_TTS_VOICE_SUPPORT` | No | Chirp voice name (default: `es-ES-Chirp3-HD-Leda`) |
| `GOOGLE_TTS_VOICE_TRANSFER` | No | Future transfer variant voice |

## Auth Setup

The synthesis module uses **Application Default Credentials (ADC)**.

```bash
# One-time setup
gcloud auth application-default login
gcloud auth application-default set-quota-project acquisition-493119
```

ADC file location: `~/.config/gcloud/application_default_credentials.json`

Do NOT use API keys for synthesis. The `@google-cloud/text-to-speech` library
picks up ADC automatically.

## Generating Audio

### Generate for all texts (resume-safe)

```bash
npx tsx scripts/generate-chirp-audio.ts
```

### Generate for a specific CEFR level

```bash
npx tsx scripts/generate-chirp-audio.ts --cefr a1
```

### Generate for a single text

```bash
npx tsx scripts/generate-chirp-audio.ts --text-id <uuid>
```

### Resume after partial failure

```bash
npx tsx scripts/generate-chirp-audio.ts --only-missing
```

### Dry run (show what would be generated)

```bash
npx tsx scripts/generate-chirp-audio.ts --dry-run
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--limit N` | Process at most N texts |
| `--offset N` | Skip the first N eligible texts |
| `--text-id UUID` | Process a single text |
| `--filename GLOB` | Filter by passage filename (e.g. `a1_short_*`) |
| `--stage STAGE` | Filter by stage (e.g. `stage1`) |
| `--cefr LEVEL` | Filter by CEFR level (e.g. `a1`, `b2`) |
| `--only-missing` | Only texts without a ready support asset (default) |
| `--variant TYPE` | Asset variant (default: `support`) |
| `--dry-run` | Preview without synthesizing |

## Storage Layout

```
listening-audio/                    # Supabase Storage bucket (public)
  audio/
    es-ES/
      <textId>/
        support.mp3                 # One stable file per text+variant
```

The path is deterministic: given a text ID and variant, you always know
where the file is. This supports future offline caching and download features.

## Database Model

The `audio` table stores asset metadata:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `text_id` | uuid FK | References texts(id) |
| `variant_type` | text | `support` or `transfer` |
| `provider` | text | `google_chirp` |
| `voice_name` | text | e.g. `es-ES-Chirp3-HD-Leda` |
| `language_code` | text | e.g. `es-ES` |
| `storage_path` | text | Path within the storage bucket |
| `url` | text | Full public URL for playback |
| `transcript` | text | Exact text used for synthesis |
| `duration_seconds` | int | Audio duration (nullable) |
| `mime_type` | text | `audio/mpeg` |
| `status` | text | `ready`, `pending`, `processing`, `failed` |
| `error_message` | text | Error details if status = failed |

**Unique constraint**: `(text_id, variant_type)` — one support asset per text.

## How Listening Works in the Daily Loop

1. User completes flashcards and reading
2. Daily session stage advances to `listening`
3. `/today` page links to `/listening/{assetId}` if an asset is assigned
4. ListeningPlayer loads audio from the asset's URL
5. User listens — must reach 90% of duration to complete
6. `completeListeningStep()` persists completion to `daily_sessions`

## Chunking

Passages over ~4800 bytes are automatically split on sentence boundaries
before synthesis. Chunk MP3s are concatenated into a single final file.
This is invisible to the user — each text has one stable MP3.

## Future: Offline / Download / Library

The asset model is designed so future features can:

- **Download**: Each text has one deterministic MP3 at a stable URL
- **Offline caching**: `storage_path` enables cache-key generation
- **Library browsing**: Query `audio` table by `variant_type`, `status`, `language_code`
- **Export**: `storage_path` + bucket name = reproducible file access
