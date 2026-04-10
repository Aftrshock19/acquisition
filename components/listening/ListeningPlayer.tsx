"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeListeningStep } from "@/app/actions/srs";
import { toReadingBlocks } from "@/lib/loop/reader";

type ListeningPlayerProps = {
  asset: {
    id: string;
    title: string;
    audioUrl: string;
    transcript: string | null;
    durationSeconds: number | null;
  };
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
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audioElement.duration || asset.durationSeconds || 0);
      setMaxPositionSeconds((currentMax) =>
        Math.max(currentMax, audioElement.duration || 0),
      );
    };

    const handleError = () => {
      setIsPlaying(false);
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
      audioElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audioElement.removeEventListener("durationchange", handleDurationChange);
      audioElement.removeEventListener("timeupdate", handleTimeUpdate);
      audioElement.removeEventListener("play", handlePlay);
      audioElement.removeEventListener("pause", handlePause);
      audioElement.removeEventListener("ended", handleEnded);
      audioElement.removeEventListener("error", handleError);
    };
  }, [asset.durationSeconds]);

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
    effectiveDuration > 0
      ? Math.min(Math.max(effectiveDuration * 0.6, 15), 90)
      : 30;
  const thresholdMet = maxPositionSeconds >= requiredListenSeconds;
  const completionProgress = Math.min(
    1,
    maxPositionSeconds / Math.max(requiredListenSeconds, 1),
  );
  const transcriptBlocks = asset.transcript ? toReadingBlocks(asset.transcript) : [];

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
    <div className="flex flex-col gap-5">
      <audio
        ref={audioRef}
        src={asset.audioUrl}
        preload="metadata"
      />

      <section className="app-card-strong flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Player
          </p>
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
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {formatTime(currentTime)} / {formatTime(effectiveDuration)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
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

        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Speed
          </p>
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

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setTranscriptOpen((open) => !open)}
            className="app-button-secondary self-start"
          >
            {transcriptOpen ? "Hide transcript" : "Show transcript"}
          </button>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {asset.transcript
              ? "Open the transcript only if you need the support."
              : "No transcript is stored for this listening asset yet."}
          </p>
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

      {transcriptOpen ? (
        <section className="app-card flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
              Transcript
            </p>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Follow along if you want the support
            </h2>
          </div>

          {transcriptBlocks.length > 0 ? (
            <div className="flex flex-col gap-4 text-base leading-8 text-zinc-900 dark:text-zinc-100">
              {transcriptBlocks.map((block, blockIndex) => (
                <p
                  key={`${asset.id}-transcript-${blockIndex}`}
                  className="whitespace-pre-wrap"
                >
                  {block}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              No transcript is available for this asset.
            </p>
          )}
        </section>
      ) : null}

      {initialCompletion.completed ? (
        <Link href="/today" className="app-button self-start">
          Back to today
        </Link>
      ) : (
        <button
          type="button"
          disabled={!thresholdMet || pending}
          onClick={handleComplete}
          className="app-button self-start"
        >
          {pending ? "Saving..." : "Mark listening complete"}
        </button>
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
