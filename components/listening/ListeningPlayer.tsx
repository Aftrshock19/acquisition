"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  completeListeningStep,
  markListeningOpened,
  markListeningPlaybackStarted,
} from "@/app/actions/srs";
import { toReadingBlocks } from "@/lib/loop/reader";

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
  initialCompletion: {
    completed: boolean;
    maxPositionSeconds: number | null;
    transcriptOpened: boolean;
    playbackRate: number | null;
  };
};

const PLAYBACK_RATES = [0.75, 1, 1.25] as const;

export function ListeningPlayer({
  asset,
  completedForToday,
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
  const [playbackRate, setPlaybackRate] = useState(
    PLAYBACK_RATES.includes(
      (initialCompletion.playbackRate ?? 1) as (typeof PLAYBACK_RATES)[number],
    )
      ? ((initialCompletion.playbackRate ?? 1) as (typeof PLAYBACK_RATES)[number])
      : 1,
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const playbackStartedLoggedRef = useRef(false);
  const playStartedAtRef = useRef<number | null>(null);
  const accumulatedPlayMsRef = useRef(0);

  useEffect(() => {
    void markListeningOpened({ assetId: asset.id });
  }, [asset.id]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) {
      return;
    }

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
      setCurrentTime(audioElement.duration || asset.durationSeconds || 0);
      setMaxPositionSeconds((currentMax) =>
        Math.max(currentMax, audioElement.duration || 0),
      );
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
    if (!audioElement) {
      return;
    }

    audioElement.playbackRate = playbackRate;
  }, [playbackRate]);

  const effectiveDuration =
    duration > 0 ? duration : Math.max(0, asset.durationSeconds ?? 0);
  const requiredListenSeconds =
    effectiveDuration > 0 ? effectiveDuration * 0.9 : 30;
  const thresholdMet = maxPositionSeconds >= requiredListenSeconds;
  const completionProgress = Math.min(
    1,
    maxPositionSeconds / Math.max(requiredListenSeconds, 1),
  );
  const transcriptBlocks = asset.transcript ? toReadingBlocks(asset.transcript) : [];

  function getListeningTimeSeconds() {
    const liveMs =
      playStartedAtRef.current === null ? 0 : Date.now() - playStartedAtRef.current;
    return getRoundedSeconds(accumulatedPlayMsRef.current + liveMs);
  }

  async function handleTogglePlayback() {
    const audioElement = audioRef.current;
    if (!audioElement) {
      return;
    }

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
    if (!audioElement) {
      return;
    }

    audioElement.currentTime = nextTime;
    setCurrentTime(nextTime);
    setMaxPositionSeconds((currentMax) => Math.max(currentMax, nextTime));
  }

  function handleReplay() {
    const audioElement = audioRef.current;
    if (!audioElement) {
      return;
    }

    const target = Math.max(0, audioElement.currentTime - 10);
    audioElement.currentTime = target;
    setCurrentTime(target);
  }

  function handleComplete() {
    if (!thresholdMet || pending) {
      return;
    }

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

      router.push(result.nextPath);
      router.refresh();
    });
  }

  return (
    <>
      <audio
        ref={audioRef}
        src={asset.audioUrl}
        preload="metadata"
      />

      <section className="app-card-strong flex flex-col gap-6 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          {asset.text ? (
            <span className="rounded-full border border-zinc-200 px-3 py-1 dark:border-zinc-800">
              {asset.text.lang.toUpperCase()}
            </span>
          ) : null}
          {asset.durationSeconds ? (
            <span className="rounded-full border border-zinc-200 px-3 py-1 dark:border-zinc-800">
              {formatDurationLabel(asset.durationSeconds)}
            </span>
          ) : null}
          <span className="rounded-full border border-zinc-200 px-3 py-1 dark:border-zinc-800">
            {asset.transcript ? "Transcript available" : "Audio only"}
          </span>
          {completedForToday ? (
            <span className="rounded-full border border-zinc-200 px-3 py-1 dark:border-zinc-800">
              Completed today
            </span>
          ) : null}
        </div>

        {/* Player controls */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void handleTogglePlayback();
              }}
              className="app-button min-w-24"
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={handleReplay}
              className="app-button-secondary min-w-20"
              title="Replay last 10 seconds"
            >
              −10s
            </button>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {formatTime(currentTime)} / {formatTime(effectiveDuration)}
            </p>
          </div>

          <input
            type="range"
            min={0}
            max={effectiveDuration > 0 ? effectiveDuration : 0}
            step={0.1}
            value={Math.min(currentTime, effectiveDuration || currentTime)}
            disabled={effectiveDuration <= 0}
            onChange={(event) => {
              handleSeek(Number(event.target.value));
            }}
            className="app-range"
            aria-label="Audio progress"
          />

          <div className="flex h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className={`h-full rounded-full ${
                thresholdMet ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-500"
              }`}
              style={{ width: `${completionProgress * 100}%` }}
            />
          </div>

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {thresholdMet
              ? "Threshold met. You can mark this listening block complete."
              : `Listen until about ${formatTime(requiredListenSeconds)} to finish this block.`}
          </p>
        </div>

        {/* Speed controls */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Speed
          </span>
          <div className="flex flex-wrap gap-2">
            {PLAYBACK_RATES.map((rate) => {
              const active = playbackRate === rate;

              return (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setPlaybackRate(rate)}
                  className={[
                    "app-toggle",
                    active ? "app-toggle-active" : "",
                  ].join(" ").trim()}
                >
                  {rate}x
                </button>
              );
            })}
          </div>
        </div>

        {/* Transcript toggle */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setTranscriptOpen((open) => !open)}
            className="app-button-secondary"
          >
            {transcriptOpen ? "Hide transcript" : "Show transcript"}
          </button>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {asset.transcript
              ? "Open the transcript only if you need the support."
              : "No transcript is stored for this listening asset yet."}
          </span>
        </div>

        {audioError ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            {audioError}
          </p>
        ) : null}

        {submitError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {submitError}
          </p>
        ) : null}
      </section>

      {transcriptOpen && transcriptBlocks.length > 0 ? (
        <section className="app-card-strong flex flex-col gap-6 p-5 sm:p-7">
          <div className="flex flex-col gap-5 text-lg leading-9 text-zinc-900 dark:text-zinc-100 sm:text-xl sm:leading-10">
            {transcriptBlocks.map((block, blockIndex) => (
              <p
                key={`${asset.id}-transcript-${blockIndex}`}
                className="whitespace-pre-wrap"
              >
                {block}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <section className="app-card-strong flex flex-col gap-4 p-5 sm:p-7">
        {initialCompletion.completed ? (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              This listening step is already logged for today.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/today" className="app-button">
                Back to today
              </Link>
              {asset.text ? (
                <Link href={`/reader/${asset.text.id}`} className="app-button-secondary">
                  Open reader
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!thresholdMet || pending}
                onClick={handleComplete}
                className="app-button"
              >
                {pending ? "Saving..." : "Mark listening complete"}
              </button>
              {asset.text ? (
                <Link href={`/reader/${asset.text.id}`} className="app-button-secondary">
                  Open reader
                </Link>
              ) : null}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getRoundedSeconds(value: number) {
  return Math.max(0, Math.round(value / 1000));
}

function formatDurationLabel(durationSeconds: number) {
  const rounded = Math.max(1, Math.round(durationSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;

  if (minutes === 0) {
    return `${seconds}s audio`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")} audio`;
}
