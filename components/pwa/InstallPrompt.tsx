"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "acq.pwa.install.dismissedAt";
const DISMISS_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOS =
    navigator.platform === "MacIntel" &&
    typeof (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints === "number" &&
    ((navigator as unknown as { maxTouchPoints: number }).maxTouchPoints ?? 0) > 1;
  return iOS || iPadOS;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;
    if (wasRecentlyDismissed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setShowIosHint(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if (isIos() && !isStandalone()) {
      const t = window.setTimeout(() => setShowIosHint(true), 1500);
      return () => {
        window.clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBeforeInstall);
        window.removeEventListener("appinstalled", onInstalled);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    rememberDismissal();
    setHidden(true);
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* ignore */
    } finally {
      setDeferred(null);
      rememberDismissal();
    }
  };

  if (hidden) return null;
  if (!deferred && !showIosHint) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Acquisition"
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
    >
      <div className="app-card-strong pointer-events-auto flex max-w-md items-start gap-3 px-4 py-3 text-sm">
        <div className="flex-1 min-w-0">
          {deferred ? (
            <>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">Install Acquisition</p>
              <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                Add it to your home screen for a cleaner daily practice.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">Add to Home Screen</p>
              <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                Tap Share, then “Add to Home Screen” to install.
              </p>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {deferred ? (
            <button type="button" onClick={install} className="app-button py-1.5 text-xs">
              Install
            </button>
          ) : null}
          <button
            type="button"
            onClick={dismiss}
            className="app-button-secondary py-1.5 text-xs"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
