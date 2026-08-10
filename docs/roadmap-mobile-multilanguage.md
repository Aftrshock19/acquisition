# Roadmap v2: Expo mobile app + L1×L2 architecture

Status: proposal, revised. Supersedes v1.
Audit base: `fb490bd`.

---

## 0. Decisions taken

| # | Decision | Consequence |
|---|---|---|
| D1 | **Full L1×L2 is the product model**, not a parameterised Spanish app. | Infrastructure phase precedes all mobile work. |
| D2 | **Mobile = real Expo/React Native app**, not a wrapper. | ~10.8k LOC of DOM components get rewritten. |
| D3 | **Postgres RPCs remain the authoritative runtime scheduler.** TS is reference only. | Every client gets scheduling for free. No bespoke API server. |
| D4 | **Scheduling unit = the sense, not the lexeme.** | `user_words` → `user_senses`; `record_review` and `get_daily_queue` rekey. Rewrites the crown jewels. See §6. |
| D5 | **UI locale, instruction language and target language are three independent axes.** | `interface_lang` as "L1" is rejected. |
| D6 | **`learning_track` is a first-class entity** (user × instruction_lang × target_lang). | Sessions, recommendations, placement runs scope to the track, not to a `lang` column. |
| D7 | **Contracts real, content minimal.** Foundational contracts, migrations, invariants and reference paths are fully implemented and validated now. Only en→es is populated. Unsupported pairs get null implementations. Regenerable pipeline work (lexicon, TTS) runs in parallel as scratch. **No full French or Arabic content yet.** | The goal is an architecture real enough that the Expo build cannot later expose a fundamental modelling or synchronisation flaw. |

D4 is only affordable because **the pilot study is finished**. `user_senses` can be built fresh rather than migrated from `user_words`. This decision would be brutal in six months and is merely expensive today.

---

## 1. What the audit actually found

### The scheduler is already in Postgres — and that is the mobile API

```
get_daily_queue(p_lang text, p_new_limit int, p_review_limit int)
record_review(p_word_id, p_grade, p_ms_spent, ...)
pick_new_words_near_frontier(...)
record_exposure(...)
```

`lib/srs/scheduler.ts` is a reference implementation; `sqlParity.test.ts` exists to stop the two drifting. React Native can call these directly. **No API server needs to be built.**

Caveat that matters for D4: `sqlParity.test.ts` extracts *numeric constants* by regex and compares them to TS exports. It is a guard against constant drift. **It will not catch a bad rekey from `word_id` to `sense_id`.** The rewrite in §6 is unprotected by the existing test suite and needs its own.

### RLS is real, but it is authorisation, not safety

24 tables with RLS enabled, 53 policies, service-role confined to three admin/export routes. That makes direct mobile→Postgres access *architecturally viable*. It does **not** make it "safe by construction" — v1 overclaimed. See §8.

### `definitions` is the worst thing in the schema

```sql
CREATE TABLE public.definitions (
  id uuid, rank integer, lemma text,
  translation text,
  definition_es text,
  definition_en text,   -- gloss language encoded as a COLUMN NAME
  created_at timestamptz
);
```

Gloss language is not under-modelled — it is a column name. Adding Arabic is `ALTER TABLE`. There is no sense layer at all: one row per lemma, one gloss per language, polysemy discarded.

**But the source data is sense-structured.** Wiktextract/Kaikki emits glosses per sense. That structure was thrown away when the pipeline flattened into `definition_es` / `definition_en`. The senses migration is therefore *not* hand-annotation of 35,000 lemmas — it is re-running extraction and no longer destroying a field.

### `review_events` cannot survive offline replay

```sql
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- server-generated → retry duplicates the row
happened_at timestamptz NOT NULL DEFAULT now(),  -- server clock → offline review gets the wrong time
half_life_before numeric,
half_life_after numeric,
p_pred numeric                                    -- scheduler OUTPUT stored inside the event
```

The last three columns are the real problem: `review_events` is not an append-only record of fact, it carries derived scheduler state. Replaying an offline batch out of order does not merely misorder history — it writes **wrong half-lives**. See §7.

### The Spanish assumptions are not where you'd grep for them

`tokenize.ts` is Unicode-aware (`\p{L}`), not `split(" ")`. The hardcode is one line lower:

```ts
return surface.trim().toLocaleLowerCase("es");
```

Case-folding is a target-language property (Turkish dotless ı; Japanese has no case). A `split(" ")` grep finds nothing here. A CJK/Turkish fixture finds it immediately.

`lib/placement/cognate.ts` — note the directory. **Cognate advantage is already an input to placement.** Item difficulty is therefore already pair-dependent, whether or not anyone decided that. See §5.

### The bill

| Thing | Size | Why it hurts |
|---|---|---|
| `components/**/*.tsx` | 10,841 LOC | DOM + Tailwind. The Expo rewrite. |
| `app/actions/*` | 3,981 LOC (2,450 in `srs.ts`) | Server Actions are Next-internal RPC. **RN cannot call them.** |
| 806 passages + 955 audio tracks | — | Zero sense annotations. D4 requires them. See §6.2. |
| Hardcoded `'es'` | `settings.ts:201`, `srs.ts:683/701/725` | Defaults that make Spanish the only citizen. |

---

## 2. The three axes

`interface_lang` conflates three things that vary independently:

| Axis | Meaning | Example |
|---|---|---|
| `ui_locale` | Language + regional formatting of the interface chrome | `en-GB` |
| `instruction_lang` | Language of glosses, explanations, grammar notes | `ar` |
| `target_lang` | Language being learned | `es-ES` |

A native Arabic speaker may read the interface in English while learning Spanish through Arabic explanations. A polyglot may pick a different instruction language per course, choosing whichever is most useful for that pairing. Nothing in the model may assume `ui_locale == instruction_lang`, and nothing may assume a user has exactly one instruction language.

**`ui_locale` is a user property. `instruction_lang` is a track property.**

---

## 3. `learning_track` and the scoping table

```sql
CREATE TABLE learning_tracks (
  id                uuid PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instruction_lang  text NOT NULL,     -- BCP-47, see §4
  target_lang       text NOT NULL,
  target_variant    text,              -- es-MX vs es-ES
  script            text,              -- ISO 15924, for sr-Latn/sr-Cyrl cases
  current_level     text,
  status            text NOT NULL,     -- active | paused | archived
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, instruction_lang, target_lang, target_variant)
);
```

en→es and ar→es are **different learning contexts**: different glosses, different cognate support, different distractors, different placement calibration. A `lang = 'es'` column would silently merge them.

**But not everything scopes to the track.** Getting this table wrong in either direction is the most expensive mistake available:

| Data | Scoped to | Reasoning |
|---|---|---|
| **Sense knowledge** (`user_senses`) | **`(user_id, target_lang)`** | You do not forget Spanish when you change how it is explained to you. Track-scoping this would wipe SRS half-lives on an instruction-language switch. **This is the single most important row in this table.** |
| **Exposure facts** (`exposure_events`) | `(user_id, target_lang)`, with `track_id` recorded for provenance | Seeing a Spanish word is exposure regardless of instruction language. Keep the *fact* at target level; keep `track_id` for analytics. |
| `daily_sessions` | `learning_track_id` | A session happens within a course. Streaks, summaries and the daily loop are per-course. |
| `daily_recommendation` | `learning_track_id` | Recommendations depend on instruction language (which glosses, which distractors). |
| Placement **runs and responses** | `learning_track_id` | Administration is pair-dependent — see §5. |
| Placement **ability estimate** | `(user_id, target_lang)`, derived | Measured Spanish ability is Spanish ability. Store the raw run at track level; derive the target-level estimate by applying the pair's calibration. |
| `ui_locale` | `user_id` | Interface chrome is a user preference. |
| Study settings (flashcard direction, card formats) | `learning_track_id` | "L1→L2 vs L2→L1" is *definitionally* pair-scoped. These are currently global user settings — that is a bug the moment a second track exists. |

---

## 4. Identifiers

`es` and `fr` are not sufficient. Model these as separate, orthogonal fields from day one:

| Field | Standard | Example |
|---|---|---|
| language | ISO 639-1/3 | `es` |
| variant / locale | BCP-47 | `es-ES`, `es-MX`, `pt-BR` |
| script | ISO 15924 | `Latn`, `Cyrl`, `Arab`, `Jpan` |
| TTS voice | provider-specific | `es-ES-Chirp3-HD-Leda` |
| content variant | internal | which passage/audio corpus |

Regional varieties need not be *supported* now. The identifiers must simply not make supporting them a migration later. TTS voice is already env-overridable — it moves into the `TargetLanguagePack`.

---

## 5. Pack architecture

Ownership boundary: **a target-language pack understands its language. It must never learn about every possible instruction language.**

```ts
interface TargetLanguagePack {
  id: LangId;                      // language + variant + script
  tokenize(text: string): Token[];
  normalize(surface: string): string;   // ← case-folding lives HERE, not in a shared util
  lemmatize(surface: string): string[];
  morphology: MorphologyRules;
  normalizePos(raw: string): Pos;
  buildCloze(sentence: string, target: Sense): ClozePrompt;
  pronunciation: { tts: TtsVoice; phonemes?: PhonemeTable };
  writingSystem: { script: Script; hasCase: boolean; delimited: boolean };
  assessment: TargetAssessmentRules;
  capabilities: Capabilities;      // §5.1
}

interface InstructionLanguagePack {
  id: LangId;
  uiStrings: StringCatalogue;
  glossFormatting: GlossFormatRules;
  grammarTerminology: TermTable;   // "subjunctive" in the instruction language
  capabilities: Capabilities;
}

interface LanguagePairPack {         // OPTIONAL. Absent is a valid, safe state.
  instructionLang: LangId;
  targetLang: LangId;
  cognates?: CognateModel;
  falseFriends?: FalseFriendTable;
  translationRules?: TranslationRules;
  grammarComparisons?: ComparisonNotes;
  transferWarnings?: TransferTable;   // L1 interference patterns
  pairDistractors?: DistractorPolicy;
  placementCalibration?: ItemCalibration;   // §5.2
  capabilities: Capabilities;
}
```

Composition:

```
language-independent core
  + instruction-language pack
  + target-language pack
  + optional pair pack
  + declared fallback behaviour
```

`cognateScore(l1, l2, word)` on the target pack — as proposed in v1 — is rejected. It would make every target pack gradually aware of every instruction language.

### 5.1 Capability registry and explicit fallback

Every pack declares what it supports:

```ts
capabilities: {
  tokenization: true,
  lemmatization: true,
  morphology: "basic" | "full" | "none",
  cognates: false,
  falseFriends: false,
  tts: true,
  placement: true,
  clozeGeneration: true,
}
```

Fallback must be **declared, deterministic and visible** — never implicit:

| Missing | Behaviour |
|---|---|
| pair pack | No cognate assistance, no transfer warnings. Placement uses uncalibrated priors and says so. |
| requested gloss language | Fall back to English **and mark the gloss as translated-not-authored**, or show "unavailable". Never silently substitute. |
| TTS voice | Generic voice, or audio disabled for that track. Never a wrong-language voice. |
| morphology | Surface-form matching only. Degrades review accuracy — must be surfaced in analytics, not hidden. |

Silent fallback is the dangerous failure mode in a *learning* application: the user receives confidently-presented, linguistically wrong behaviour and has no way to know. A disabled feature is honest; a wrong one is not.

### 5.2 Placement is already pair-dependent — and that is a calibration problem

`cognate.ts` lives in `lib/placement/`. Cognate advantage already feeds placement. An English speaker gets *importante* free; an Arabic speaker does not. Therefore **item difficulty parameters in `baseline_item_bank` are per-pair**, not per-language.

This is not just plumbing. A **new pair starts with uncalibrated item difficulties**, and cold-start needs an explicit policy: inherit priors from a typologically-near pair, widen the confidence interval, and recalibrate as responses arrive. Decide this in Phase 1; discovering it in Phase 5 means shipping a placement test that quietly mis-levels every non-English speaker.

---

## 6. Sense-level scheduling (D4)

### 6.1 The lexical model

```sql
lexemes      (id, target_lang, lemma, pos, rank, freq)
senses       (id, lexeme_id, sense_index, gloss_key, register, domain, sense_rank)
sense_glosses(id, sense_id, instruction_lang, text, register, version)
examples     (id, sense_id, target_lang, text, source)
```

Replaces `definitions`. `sense_glosses` is where the entire L1×L2 promise lives.

**Gloss matrix is O(n²) — do not populate it.** Support a small instruction set (`en`, plus `es`/`fr` later), English as declared fallback, expand on demand. Design the table for n²; populate the cells you actually need.

### 6.2 What D4 breaks, and the two costs that are not obvious

`user_words` → `user_senses`. `record_review(p_word_id, ...)` → `record_review(p_sense_id, ...)`. `get_daily_queue` returns senses. These are the only components currently proven correct, and `sqlParity.test.ts` does not protect a rekey.

**Cost 1 — senses have no frequency signal.** `pick_new_words_near_frontier` works because `words.rank` exists. Kaikki gives sense *structure*, not sense *distribution*. "Introduce the next item at the frontier" becomes "which sense of which lexeme?" with no corpus signal. Options, in ascending cost:

- Wiktionary sense order as a weak prior (first sense ≈ most common — roughly true, occasionally badly wrong)
- Frequency-weighted heuristics from the generated corpus (you control the content; you can count)
- Manual review of the top ~2–3k lexemes (tractable, and probably what actually happens)
- Corpus WSD (expensive; almost certainly not worth it)

**This is the biggest hidden cost of D4 and needs a decision in Phase 1, not Phase 4.** `senses.sense_rank` exists in the schema above precisely so this decision has somewhere to live.

**Cost 2 — the existing content has no sense annotations.** `record_exposure` maps a token to a word. At sense level, seeing *banco* in a passage exposes *which* sense. Runtime WSD in the reader is not acceptable.

The saving grace: **you generate the content.** The pipeline can tag the intended `sense_id` at generation time, per token, as part of the controlled-vocabulary step. This must enter the content contract **now**. The existing 806 passages and 955 audio tracks need retro-annotation — scope it as a real task rather than discovering it in Phase 4.

### 6.3 Two invariants D4 forces

- **Sibling suppression.** `get_daily_queue` must not surface two senses of the same lexeme in one session. *Banco*(bench) and *banco*(bank) on adjacent cards is interference, not learning. New selection constraint: at most one sense per lexeme per session.
- **Placement stays lexeme-level.** Placement estimates breadth; it should not care that *banco* is polysemous. SRS is sense-level, placement is lexeme-level. This asymmetry is deliberate — write it down, or someone will "fix" it.

---

## 7. Offline synchronisation protocol

"SQLite mirror + outbox" is the beginning, not the architecture. Scheduling is **order-dependent** (half-life update reads prior state), so replay semantics are correctness-critical, not merely hygiene.

**Event model.** `review_events` becomes genuinely append-only:

| Field | Rule |
|---|---|
| `client_event_id` | **Client-generated UUID.** `UNIQUE` — the idempotency key. Retries are free. |
| `happened_at` | **Client clock** — when the review actually occurred, offline. |
| `received_at` | **Server clock** — authoritative for trust and ordering-of-arrival. |
| `client_seq` | Monotonic per-device counter. Restores intra-batch ordering. |
| `queue_version` / `content_version` | Which queue and content revision the client was working against. |
| `half_life_before/after`, `p_pred` | **Removed from the client contract.** Server-computed on ingest, never trusted from the client. |

**Protocol requirements:**

1. Client-generated idempotency keys; duplicate `client_event_id` is a no-op, not an error.
2. Deterministic retry with backoff; a partially-flushed outbox must be safe to re-flush in full.
3. Server recomputes all derived scheduler state on ingest, replaying in `(happened_at, client_seq)` order within a batch.
4. Clock-skew policy: reject or clamp `happened_at` outside a plausible window relative to `received_at`.
5. Content/queue versioning: a client holding a stale queue for deleted or replaced content must degrade cleanly, not crash or double-count.
6. Conflict policy for **settings** and **active track** (last-write-wins on server timestamp is acceptable here; it is not acceptable for review events).
7. Partial-sync recovery: an interrupted flush leaves the client in a resumable state, with no lost and no double-counted reviews.

**Test obligation:** a replay-fuzz suite — shuffle, duplicate, delay and partially drop an event batch, then assert the resulting scheduler state is identical to the online path. This is the test that makes the offline claim real.

---

## 8. Security: RLS is necessary, not sufficient

v1 said direct mobile access was "safe by construction." That was wrong. RLS gives row authorisation. It does not give:

- rate limiting and abuse control
- protection against expensive RPC invocation (a client can hammer `get_daily_queue`)
- input validation beyond column constraints
- protection against scraping shared content (the entire lexicon and passage corpus is readable by any authenticated user)
- safety for privileged content-generation operations (TTS costs money per call)
- secret-backed services (Google TTS keys must never reach a mobile binary)
- idempotency and replay protection (see §7)
- correctness of `SECURITY DEFINER` functions, which run as owner and **bypass RLS by design**

**Actions:**

- Audit every `SECURITY DEFINER` RPC for privilege escalation. These are the sharpest edge in the system.
- Adversarial RLS suite: one test per table asserting user A cannot read or write user B's rows. This is a test file, not a code review.
- Rate limits on RPCs at the edge.
- All secret-backed operations (TTS synthesis, admin export) stay server-side in Edge Functions. Nothing with a secret ships in the app bundle.
- Explicit decision on bulk content readability — is the corpus a scrapeable asset you care about?

---

## 9. Phasing

Per D7: contracts real, content minimal.

**Phase 0 — Cleanup + monorepo** *(~1 week)*
Delete `signup-codes.csv` (500 live codes in a public repo), `app/results/page 2.tsx`, the duplicate migration, the `*_backup.sql` files, the 3,982-line `.gitignore`. pnpm workspaces + turborepo. `lib/` → `packages/core`, tests intact. CI lint rule: **nothing in `packages/*` imports `next/*` or `react-dom`.**

**Phase 1 — The foundation** *(the substantial one)*
This is where D1, D4, D5, D6 are paid for.

- Migrations: `learning_tracks`, `lexemes`/`senses`/`sense_glosses`/`examples`, `user_senses`, rescoped `daily_sessions` / `daily_recommendation` / placement / settings per §3, `ui_locale` on the user.
- Rekey the scheduler: `record_review`, `get_daily_queue`, `pick_new_words_near_frontier` → sense-level. New parity/invariant tests, since the existing one will not catch this.
- Sibling suppression in the queue (§6.3).
- Sense-frequency decision (§6.2, Cost 1) — resolved, not deferred.
- Pack interfaces + registry + capability/fallback contracts. `lang-es` extracted. `InstructionLanguagePack` for `en`. **Null pair pack** as the reference for "no pair support" — this is the path that must work first, because it is the path every new pair starts on.
- Non-Latin skeletal fixtures (`ja` or `ar`): tokenization, no-case normalization, non-delimited text. These are **architecture tests**, not content. They exist to fail loudly if a Latin/whitespace assumption reappears.
- Rip out every hardcoded `'es'`. Rename `NormalEnToEsCard` → `NormalL1ToL2Card` etc.
- Content pipeline contract gains per-token `sense_id` annotation. Retro-annotate the existing es corpus.

*In parallel, as scratch:* French lexicon build and TTS generation. Regenerable, long-running, no dependency on the contracts landing. Do not commit it to the DB.

**Phase 2 — i18n extraction** *(~3 days)*
UI copy out of web components into `packages/i18n`, keyed by `ui_locale`. Before Expo screens exist — extracting strings from two UIs is worse than twice the work, and the second will drift.

**Phase 3 — `api-client`; retire Server Actions** *(~1–2 weeks)*
Typed wrappers over the RPCs. Migrate the web app's 4k LOC of Server Actions onto it. Keep server-side only what needs a secret (auth callbacks, TTS, admin export). **When the web app runs entirely through `api-client`, mobile's data layer is written and already proven in production.**

**Phase 4 — Validation, not content** *(~1 week)*
Prove the contracts: pair-pack path exercised end to end, capability fallbacks asserted, replay-fuzz suite green, adversarial RLS suite green, `docs/adding-a-language.md` written and *followed by someone other than its author*. French becomes the second full implementation **after** this — not during it.

**Phase 5 — Expo** *(~4–8 weeks)*
`expo-router`, `supabase-js` + `expo-secure-store`, NativeWind, `packages/core` + `api-client` imported unchanged.

Hard ports: **`InteractiveText`/`WordLookupPanel`** (DOM token spans → nested `<Text>` pressables — the heart of the reader) and **`ListeningPlayer`** (`expo-audio` + `expo-file-system` caching).

Not optional, and the reason it is an app rather than a website: **offline daily loop** (expo-sqlite mirror + outbox implementing §7) and **push notifications**. These are also what gets it past App Store guideline 4.2.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **D4 rewrites the only proven-correct component**, and the existing parity test does not cover a rekey. | Write the sense-level invariant suite *before* the rekey. Property tests over scheduler state, not just constant comparison. |
| **Sense frequency has no signal.** | Decide in Phase 1. Wiktionary sense order + manual top-2k review is the realistic answer. |
| **806 passages / 955 tracks need sense annotation.** | Pipeline generates it going forward; retro-annotation is a scoped Phase 1 task, not a discovery. |
| **Placement cold-start for new pairs.** | Explicit prior-inheritance + widened CI policy. Otherwise non-English speakers get silently mis-levelled. |
| **Silent linguistic fallback.** | Capability registry + declared fallbacks (§5.1). A disabled feature is honest; a wrong one is not. |
| **Offline replay corrupts scheduling.** | §7 protocol + replay-fuzz suite. Non-negotiable before mobile ships. |
| **`SECURITY DEFINER` bypasses RLS.** | Dedicated audit (§8). |
| **Apple 4.2.** | Offline + push, in Phase 5, not as stretch goals. |
| **Scope.** Phase 1 is roughly 3× v1's. | It is bounded by D7: contracts real, content minimal, one populated pair. Everything shippable at each phase boundary. If time runs out after Phase 4, the outcome is a correctly-modelled multilingual web app — a real result, not a half-built one. |

---

## 11. Open questions

1. **Sense-frequency source** (§6.2). Needs an answer before the queue is rekeyed.
2. **Does the web learning app survive** post-mobile, or become a landing page + dissertation archive? Changes how much polish Phases 2–3 deserve.
3. **Multiple simultaneously-active tracks per user**, or one active with a switcher? One-at-a-time is meaningfully simpler; the schema supports both, so this is a UX call, not a modelling one.
4. **Is the corpus a protected asset?** (§8) Determines whether authenticated bulk read is acceptable.
