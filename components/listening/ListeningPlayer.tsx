"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  completeListeningStep,
  markListeningOpened,
  markListeningPlaybackStarted,
  uncompleteListeningStep,
} from "@/app/actions/srs";
import { InteractiveText } from "@/components/interactive-text/InteractiveText";
import { InteractiveTextProvider } from "@/components/interactive-text/InteractiveTextProvider";
import { toReadingBlocks } from "@/lib/loop/reader";
import { tokenize } from "@/lib/reader/tokenize";

type ListeningPlayerProps = {
  asset: {
    id: string;
    title: string;
    audioUrl: string;
    transcript: string | null;
    durationSeconds: number | null;
    text?: { id: string; lang: string; title: string } | null;
  };
  completedForToday: boolean;
  prevAssetId?: string | null;
  nextAssetId?: string | null;
  initialSavedWordIds?: string[];
  initialSavedLemmas?: string[];
  initialCompletion: {
    completed: boolean;
    maxPositionSeconds: number | null;
    transcriptOpened: boolean;
    playbackRate: number | null;
  };
};

const SPEED_MIN = 0.25;
const SPEED_MAX = 2.5;
const SPEED_STEP = 0.05;
const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5] as const;
const PREV_RESTART_THRESHOLD = 1; // seconds

function clampSpeed(value: number): number {
  const stepped = Math.round(value / SPEED_STEP) * SPEED_STEP;
  return Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, stepped)) * 100) / 100;
}

function formatSpeed(value: number): string {
  return value.toFixed(2) + "x";
}

export function ListeningPlayer({
  asset,
  completedForToday,
  prevAssetId,
  nextAssetId,
  initialSavedWordIds = [],
  initialSavedLemmas = [],
  initialCompletion,
}: ListeningPlayerProps) {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [pending, startTransition] = useTransition();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(asset.durationSeconds ?? 0);
  const [maxPositionSeconds, setMaxPositionSeconds] = useState(
    Math.max(0, initialCompletion.maxPositionSeconds ?? 0),
  );
  const [transcriptOpen, setTranscriptOpen] = useState(
    initialCompletion.transcriptOpened,
  );
  const [playbackRate, setPlaybackRate] = useState(() =>
    clampSpeed(initialCompletion.playbackRate ?? 1),
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const playbackStartedLoggedRef = useRef(false);
  const playStartedAtRef = useRef<number | null>(null);
  const accumulatedPlayMsRef = useRef(0);
  const localCompletedRef = useRef(initialCompletion.completed);
  const pendingRef = useRef(false);

  // ── Side effects ────────────────────────────────────────────

  useEffect(() => {
    void markListeningOpened({ assetId: asset.id });
  }, [asset.id]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audioElement.duration) && audioElement.duration > 0) {
        setDuration(audioElement.duration);
      }
    };

    const handleDurationChange = () => {
      if (Number.isFinite(audioElement.duration) && audioElement.duration > 0) {
        setDuration(audioElement.duration);
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audioElement.currentTime);
      setMaxPositionSeconds((currentMax) =>
        Math.max(currentMax, audioElement.currentTime),
      );
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setAudioError(null);
      if (playStartedAtRef.current === null) {
        playStartedAtRef.current = Date.now();
      }
      if (!playbackStartedLoggedRef.current) {
        playbackStartedLoggedRef.current = true;
        void markListeningPlaybackStarted({ assetId: asset.id });
      }
    };

    const handlePause = () => {
      setIsPlaying(false);
      if (playStartedAtRef.current !== null) {
        accumulatedPlayMsRef.current += Date.now() - playStartedAtRef.current;
        playStartedAtRef.current = null;
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      if (playStartedAtRef.current !== null) {
        accumulatedPlayMsRef.current += Date.now() - playStartedAtRef.current;
        playStartedAtRef.current = null;
      }
      const finalTime = audioElement.duration || asset.durationSeconds || 0;
      setCurrentTime(finalTime);
      setMaxPositionSeconds((currentMax) =>
        Math.max(currentMax, audioElement.duration || 0),
      );
      // Auto-complete when the passage finishes playing
      if (!localCompletedRef.current && !pendingRef.current) {
        autoCompleteOnEnd(finalTime);
      }
    };

    const handleError = () => {
      setIsPlaying(false);
      if (playStartedAtRef.current !== null) {
        accumulatedPlayMsRef.current += Date.now() - playStartedAtRef.current;
        playStartedAtRef.current = null;
      }
      setAudioError("The audio could not load. Check the file URL and try again.");
    };

    audioElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    audioElement.addEventListener("durationchange", handleDurationChange);
    audioElement.addEventListener("timeupdate", handleTimeUpdate);
    audioElement.addEventListener("play", handlePlay);
    audioElement.addEventListener("pause", handlePause);
    audioElement.addEventListener("ended", handleEnded);
    audioElement.addEventListener("error", handleError);

    return () => {
      if (playStartedAtRef.current !== null) {
        accumulatedPlayMsRef.current += Date.now() - playStartedAtRef.current;
        playStartedAtRef.current = null;
      }
      audioElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audioElement.removeEventListener("durationchange", handleDurationChange);
      audioElement.removeEventListener("timeupdate", handleTimeUpdate);
      audioElement.removeEventListener("play", handlePlay);
      audioElement.removeEventListener("pause", handlePause);
      audioElement.removeEventListener("ended", handleEnded);
      audioElement.removeEventListener("error", handleError);
    };
  }, [asset.durationSeconds, asset.id]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    audioElement.playbackRate = playbackRate;
  }, [playbackRate]);

  // ── Derived state ───────────────────────────────────────────

  const effectiveDuration =
    duration > 0 ? duration : Math.max(0, asset.durationSeconds ?? 0);
  const requiredListenSeconds =
    effectiveDuration > 0 ? effectiveDuration * 0.9 : 30;
  const thresholdMet = maxPositionSeconds >= requiredListenSeconds;
  const transcriptBlocks = useMemo(
    () =>
      asset.transcript
        ? toReadingBlocks(asset.transcript).map((block) => tokenize(block))
        : [],
    [asset.transcript],
  );
  const transcriptLang = asset.text?.lang ?? "es";

  function getListeningTimeSeconds() {
    const liveMs =
      playStartedAtRef.current === null ? 0 : Date.now() - playStartedAtRef.current;
    return getRoundedSeconds(accumulatedPlayMsRef.current + liveMs);
  }

  // ── Handlers ────────────────────────────────────────────────

  async function handleTogglePlayback() {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    setAudioError(null);

    if (audioElement.paused) {
      await audioElement.play().catch(() => {
        setAudioError("Playback did not start. Try again once the file finishes loading.");
      });
      return;
    }

    audioElement.pause();
  }

  function handleSeek(nextTime: number) {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    audioElement.currentTime = nextTime;
    setCurrentTime(nextTime);
    setMaxPositionSeconds((currentMax) => Math.max(currentMax, nextTime));
  }

  function handleReplay() {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    const target = Math.max(0, audioElement.currentTime - 10);
    audioElement.currentTime = target;
    setCurrentTime(target);
  }

  function handleForward() {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    const cap = effectiveDuration > 0 ? effectiveDuration : audioElement.duration || 0;
    const target = Math.min(cap, audioElement.currentTime + 10);
    audioElement.currentTime = target;
    setCurrentTime(target);
    setMaxPositionSeconds((currentMax) => Math.max(currentMax, target));
  }

  function handlePrevious() {
    if (currentTime > PREV_RESTART_THRESHOLD) {
      const audioElement = audioRef.current;
      if (audioElement) {
        audioElement.currentTime = 0;
      }
      setCurrentTime(0);
      return;
    }
    if (prevAssetId) {
      router.push(`/listening/${prevAssetId}`);
    }
  }

  function handlePlayAgain() {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    audioElement.currentTime = 0;
    setCurrentTime(0);
    if (!audioElement.paused) return;
    void audioElement.play().catch(() => {
      setAudioError("Playback did not start. Try again once the file finishes loading.");
    });
  }

  function autoCompleteOnEnd(finalTime: number) {
    startTransition(async () => {
      setSubmitError(null);
      const liveMs =
        playStartedAtRef.current === null ? 0 : Date.now() - playStartedAtRef.current;
      const listeningTimeSeconds = getRoundedSeconds(accumulatedPlayMsRef.current + liveMs);

      const result = await completeListeningStep({
        assetId: asset.id,
        maxPositionSeconds: Math.max(maxPositionSeconds, finalTime),
        requiredListenSeconds,
        transcriptOpened: transcriptOpen,
        playbackRate,
        listeningTimeSeconds,
      });

      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }

      setLocalCompleted(true);
      router.refresh();
    });
  }

  function handleUncomplete() {
    if (!localCompleted || pending) return;

    startTransition(async () => {
      setSubmitError(null);
      const result = await uncompleteListeningStep({ assetId: asset.id });

      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }

      setLocalCompleted(false);
      router.refresh();
    });
  }

  function handleMarkComplete() {
    if (pending || localCompleted) return;

    startTransition(async () => {
      setSubmitError(null);
      const result = await completeListeningStep({
        assetId: asset.id,
        maxPositionSeconds,
        requiredListenSeconds,
        transcriptOpened: transcriptOpen,
        playbackRate,
        listeningTimeSeconds: getListeningTimeSeconds(),
      });

      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }

      setLocalCompleted(true);
    });
  }

  function handleDoneForToday() {
    if (localCompleted) {
      router.push("/today");
      return;
    }
    if (!thresholdMet || pending) return;

    startTransition(async () => {
      setSubmitError(null);
      const result = await completeListeningStep({
        assetId: asset.id,
        maxPositionSeconds,
        requiredListenSeconds,
        transcriptOpened: transcriptOpen,
        playbackRate,
        listeningTimeSeconds: getListeningTimeSeconds(),
      });

      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }

      setLocalCompleted(true);
      router.push(result.nextPath);
      router.refresh();
    });
  }

  // ── Derived state ───────────────────────────────────────────

  const [localCompleted, setLocalCompleted] = useState(initialCompletion.completed);
  localCompletedRef.current = localCompleted;
  pendingRef.current = pending;

  return (
    <InteractiveTextProvider
      lang={transcriptLang}
      initialSavedWordIds={initialSavedWordIds}
      initialSavedLemmas={initialSavedLemmas}
      interactionContext="listening-transcript"
      textId={asset.text?.id ?? null}
      saveSource="reader"
    >
    <section className="app-card-strong flex flex-col p-5 sm:p-7">
      <audio ref={audioRef} src={asset.audioUrl} preload="metadata" />

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/listening"
            aria-label="Back to listening"
            className="app-icon-button shrink-0"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
              <path
                d="M11.5 4.5L6 10l5.5 5.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Listening
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={localCompleted ? handleUncomplete : handleMarkComplete}
          className={localCompleted
            ? "rounded-full border border-emerald-200 bg-emerald-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            : "rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-800 disabled:opacity-30 disabled:hover:border-zinc-200 disabled:hover:text-zinc-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200 dark:disabled:hover:border-zinc-700 dark:disabled:hover:text-zinc-400"}
          data-testid={localCompleted ? "complete-pill" : "mark-complete-button"}
        >
          {localCompleted ? "Complete" : "Mark complete"}
        </button>
      </div>

      {/* ── Title ──────────────────────────────────────────── */}
      <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-xl">
        {asset.title}
      </h2>

      {/* ── Transport controls ─────────────────────────────── */}
      <div className="mt-8 flex items-center justify-center">
        {/* Left group: previous + rewind */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            disabled={!prevAssetId && currentTime <= PREV_RESTART_THRESHOLD}
            onClick={handlePrevious}
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-300 transition hover:bg-zinc-100 hover:text-zinc-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-300 sm:h-12 sm:w-12 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400 dark:disabled:hover:bg-transparent dark:disabled:hover:text-zinc-600"
            aria-label="Previous listening item"
            data-testid="prev-item-button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="sm:h-5 sm:w-5" aria-hidden="true">
              <rect x="4" y="6" width="2.5" height="12" rx="0.5" />
              <path d="M19 6v12l-9.5-6L19 6z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={handleReplay}
            className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 sm:h-16 sm:w-16 sm:text-lg dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Rewind 10 seconds"
            data-testid="rewind-button"
          >
            −10
          </button>
        </div>

        {/* Center: play / pause */}
        <button
          type="button"
          onClick={() => { void handleTogglePlayback(); }}
          className="mx-3 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg transition hover:scale-105 hover:bg-zinc-800 active:scale-95 sm:mx-5 sm:h-20 sm:w-20 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          aria-label={isPlaying ? "Pause audio" : "Play audio"}
          data-testid="play-pause-button"
        >
          {isPlaying ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="sm:h-7 sm:w-7" aria-hidden="true">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="sm:h-7 sm:w-7" aria-hidden="true">
              <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
            </svg>
          )}
        </button>

        {/* Right group: forward + next */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={handleForward}
            className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 sm:h-16 sm:w-16 sm:text-lg dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Forward 10 seconds"
            data-testid="forward-button"
          >
            +10
          </button>

          <button
            type="button"
            disabled={!nextAssetId}
            onClick={() => { if (nextAssetId) router.push(`/listening/${nextAssetId}`); }}
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-300 transition hover:bg-zinc-100 hover:text-zinc-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-300 sm:h-12 sm:w-12 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400 dark:disabled:hover:bg-transparent dark:disabled:hover:text-zinc-600"
            aria-label="Next listening item"
            data-testid="next-item-button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="sm:h-5 sm:w-5" aria-hidden="true">
              <path d="M5 6v12l9.5-6L5 6z" />
              <rect x="17.5" y="6" width="2.5" height="12" rx="0.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Scrubber + time ────────────────────────────────── */}
      <div className="mt-6 flex flex-col gap-1.5">
        <input
          type="range"
          min={0}
          max={effectiveDuration > 0 ? effectiveDuration : 0}
          step={0.1}
          value={Math.min(currentTime, effectiveDuration || currentTime)}
          disabled={effectiveDuration <= 0}
          onChange={(event) => handleSeek(Number(event.target.value))}
          className="app-range"
          aria-label="Audio progress"
        />
        <div className="flex justify-between text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(effectiveDuration)}</span>
        </div>
      </div>

      {/* ── Speed controls ────────────────────────────────── */}
      <div className="mt-3 flex flex-col items-center gap-2" role="group" aria-label="Playback speed">
        {/* Stepper */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={playbackRate <= SPEED_MIN}
            onClick={() => setPlaybackRate(clampSpeed(playbackRate - SPEED_STEP))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:disabled:hover:bg-transparent"
            aria-label="Decrease playback speed"
            data-testid="speed-decrease"
          >
            −
          </button>
          <span
            className="min-w-[4rem] text-center text-sm font-semibold tabular-nums text-zinc-700 dark:text-zinc-300"
            data-testid="speed-display"
          >
            {formatSpeed(playbackRate)}
          </span>
          <button
            type="button"
            disabled={playbackRate >= SPEED_MAX}
            onClick={() => setPlaybackRate(clampSpeed(playbackRate + SPEED_STEP))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:disabled:hover:bg-transparent"
            aria-label="Increase playback speed"
            data-testid="speed-increase"
          >
            +
          </button>
        </div>
        {/* Presets */}
        <div className="flex flex-wrap items-center justify-center gap-1">
          {SPEED_PRESETS.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => setPlaybackRate(clampSpeed(rate))}
              className={[
                "rounded-md px-2 py-0.5 text-[11px] font-medium transition",
                playbackRate === rate
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200",
              ].join(" ")}
              aria-pressed={playbackRate === rate}
              data-testid={`speed-preset-${rate}`}
            >
              {formatSpeed(rate)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Status ─────────────────────────────────────────── */}
      {!localCompleted ? (
        <p className="mt-5 text-center text-[13px] text-zinc-400 dark:text-zinc-500" data-testid="listening-status">
          {thresholdMet
            ? "Ready to continue"
            : "Listen through once to continue"}
        </p>
      ) : null}

      {/* ── Errors ─────────────────────────────────────────── */}
      {audioError ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {audioError}
        </p>
      ) : null}

      {submitError ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {submitError}
        </p>
      ) : null}

      {/* ── Transcript accordion ───────────────────────────── */}
      {asset.transcript ? (
        <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setTranscriptOpen((open) => !open)}
            className="flex w-full items-center justify-between py-1 text-[13px] font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            data-testid="transcript-toggle"
          >
            <span>{transcriptOpen ? "Hide transcript" : "Show transcript"}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              className={`shrink-0 text-zinc-400 transition-transform dark:text-zinc-500 ${transcriptOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            >
              <path
                d="M5.5 7.5L10 12l4.5-4.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {transcriptOpen && transcriptBlocks.length > 0 ? (
              <div
                className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/60 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/40"
                data-testid="transcript-content"
              >
                <div className="flex flex-col gap-4 text-base leading-8 text-zinc-800 dark:text-zinc-200 sm:text-lg sm:leading-9">
                  {transcriptBlocks.map((block, blockIndex) => (
                    <p
                      key={`${asset.id}-transcript-${blockIndex}`}
                      className="whitespace-pre-wrap"
                    >
                      <InteractiveText
                        tokens={block}
                        tokenKeyPrefix={`transcript-block-${blockIndex}`}
                      />
                    </p>
                  ))}
                </div>
              </div>
          ) : null}
        </div>
      ) : null}

      {/* ── CTA ────────────────────────────────────────────── */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={localCompleted ? false : !thresholdMet || pending}
          onClick={handleDoneForToday}
          className="app-button"
          data-testid="done-for-today-button"
        >
          {pending ? "Saving..." : "Done for today"}
        </button>
        <button
          type="button"
          onClick={handlePlayAgain}
          className="app-button-secondary"
          data-testid="play-again-button"
        >
          Play again
        </button>
        {nextAssetId ? (
          <button
            type="button"
            onClick={() => router.push(`/listening/${nextAssetId}`)}
            className="text-sm font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            data-testid="another-passage-button"
          >
            Another passage
          </button>
        ) : null}
      </div>
    </section>
    </InteractiveTextProvider>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getRoundedSeconds(value: number) {
  return Math.max(0, Math.round(value / 1000));
}
