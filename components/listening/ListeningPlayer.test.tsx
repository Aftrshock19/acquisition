import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/app/actions/srs", () => ({
  completeListeningStep: vi.fn(),
  markListeningOpened: vi.fn(),
  markListeningPlaybackStarted: vi.fn(),
  uncompleteListeningStep: vi.fn(),
}));

vi.mock("@/components/interactive-text/InteractiveTextProvider", () => ({
  InteractiveTextProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/interactive-text/InteractiveText", () => ({
  InteractiveText: ({ tokens }: { tokens: Array<{ surface: string; isWord: boolean }> }) => {
    const React = require("react");
    return React.createElement(
      React.Fragment,
      null,
      tokens.map((t: { surface: string; isWord: boolean }, i: number) =>
        t.isWord
          ? React.createElement("button", {
              key: i,
              "data-interactive-word": "true",
              type: "button",
            }, t.surface)
          : React.createElement("span", { key: i }, t.surface),
      ),
    );
  },
}));

import React from "react";
import { ListeningPlayer } from "./ListeningPlayer";

const baseAsset = {
  id: "asset-1",
  title: "La playa",
  audioUrl: "https://example.com/audio.mp3",
  transcript: "Hola mundo.\n\nAdiós sol.",
  durationSeconds: 120,
  text: { id: "text-1", lang: "es", title: "La playa" },
};

const defaultCompletion = {
  completed: false,
  maxPositionSeconds: null,
  transcriptOpened: false,
  playbackRate: null,
};

function render(props: Partial<Parameters<typeof ListeningPlayer>[0]> = {}) {
  return renderToStaticMarkup(
    <ListeningPlayer
      asset={baseAsset}
      completedForToday={false}
      initialCompletion={defaultCompletion}
      {...props}
    />,
  );
}

describe("ListeningPlayer", () => {
  // ── Structure ───────────────────────────────────────────────

  it("renders everything in a single card", () => {
    const html = render();
    expect((html.match(/<section/g) || []).length).toBe(1);
    expect(html).toContain("app-card-strong");
  });

  it("renders the Listening section label", () => {
    expect(render()).toContain("Listening");
  });

  it("renders the title inside the card", () => {
    expect(render()).toContain("La playa");
  });

  // ── Play / pause ────────────────────────────────────────────

  it("shows play button on initial render", () => {
    expect(render()).toContain('aria-label="Play audio"');
  });

  // ── Scrubber ────────────────────────────────────────────────

  it("renders exactly one audio scrubber", () => {
    const html = render();
    expect(html).toContain('aria-label="Audio progress"');
    const rangeCount = (html.match(/type="range"/g) || []).length;
    expect(rangeCount).toBe(1);
  });

  it("shows time labels under the scrubber", () => {
    const html = render();
    expect(html).toContain("0:00");
    expect(html).toContain("2:00");
  });

  // ── Transport controls ───────────────────────────────────────

  it("renders all transport icon buttons", () => {
    const html = render({ prevAssetId: "p", nextAssetId: "n" });
    expect(html).toContain('data-testid="prev-item-button"');
    expect(html).toContain('data-testid="rewind-button"');
    expect(html).toContain('data-testid="play-pause-button"');
    expect(html).toContain('data-testid="forward-button"');
    expect(html).toContain('data-testid="next-item-button"');
  });

  it("transport buttons use icons for prev/next and text for rewind/forward", () => {
    const html = render({ prevAssetId: "p", nextAssetId: "n" });
    // prev, next, play/pause use SVG icons; rewind/forward use text labels
    expect(html).toContain("−10");
    expect(html).toContain("+10");
    expect(html).not.toContain("&lt;&lt;");
    expect(html).not.toContain("&gt;&gt;");
  });

  it("rewind button has correct aria-label", () => {
    const html = render();
    expect(html).toContain('aria-label="Rewind 10 seconds"');
  });

  it("forward button has correct aria-label", () => {
    const html = render();
    expect(html).toContain('aria-label="Forward 10 seconds"');
  });

  // ── Speed stepper + presets ──────────────────────────────────

  it("old 6-chip speed row no longer renders", () => {
    const html = render();
    // Old presets that are no longer in the preset set
    expect(html).not.toContain("0.90x");
    expect(html).not.toContain("1.10x");
    // The old row had exactly 6 aria-pressed buttons; now 5 presets
    const pressedButtons = html.match(/aria-pressed=/g) || [];
    expect(pressedButtons.length).toBe(5);
  });

  it("renders speed decrease button", () => {
    const html = render();
    expect(html).toContain('data-testid="speed-decrease"');
    expect(html).toContain('aria-label="Decrease playback speed"');
  });

  it("renders speed increase button", () => {
    const html = render();
    expect(html).toContain('data-testid="speed-increase"');
    expect(html).toContain('aria-label="Increase playback speed"');
  });

  it("renders current speed label at 1.00x by default", () => {
    const html = render();
    expect(html).toContain('data-testid="speed-display"');
    expect(html).toContain("1.00x");
  });

  it("renders all 5 preset chips", () => {
    const html = render();
    expect(html).toContain("0.50x");
    expect(html).toContain("0.75x");
    expect(html).toContain("1.00x");
    expect(html).toContain("1.25x");
    expect(html).toContain("1.50x");
    expect(html).not.toContain('>0.25x<');
    expect(html).not.toContain('>2.00x<');
  });

  it("1.00x preset is active by default", () => {
    const html = render();
    const match = html.match(/<button[^>]*aria-pressed="true"[^>]*>[^<]*1\.00x/);
    expect(match).not.toBeNull();
  });

  it("persisted playback rate displays correctly", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, playbackRate: 0.75 },
    });
    // Display shows the persisted rate
    const display = html.match(/<span[^>]*data-testid="speed-display"[^>]*>[^<]*/);
    expect(display).not.toBeNull();
    expect(display![0]).toContain("0.75x");
    // The 0.75x preset is active
    const match = html.match(/<button[^>]*aria-pressed="true"[^>]*>[^<]*0\.75x/);
    expect(match).not.toBeNull();
  });

  it("persisted non-preset speed displays correctly with no active preset", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, playbackRate: 0.85 },
    });
    const display = html.match(/<span[^>]*data-testid="speed-display"[^>]*>[^<]*/);
    expect(display).not.toBeNull();
    expect(display![0]).toContain("0.85x");
    // No preset should be active at 0.85
    const activePresets = html.match(/<button[^>]*aria-pressed="true"[^>]*>/g) || [];
    expect(activePresets.length).toBe(0);
  });

  it("decrease button is disabled at minimum speed", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, playbackRate: 0.25 },
    });
    const match = html.match(/<button[^>]*data-testid="speed-decrease"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/disabled=""/);
  });

  it("increase button is disabled at maximum speed", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, playbackRate: 2.5 },
    });
    const match = html.match(/<button[^>]*data-testid="speed-increase"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/disabled=""/);
  });

  it("decrease button is enabled above minimum speed", () => {
    const html = render(); // 1.00x
    const match = html.match(/<button[^>]*data-testid="speed-decrease"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toMatch(/disabled=""/);
  });

  it("increase button is enabled below maximum speed", () => {
    const html = render(); // 1.00x
    const match = html.match(/<button[^>]*data-testid="speed-increase"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toMatch(/disabled=""/);
  });

  it("out-of-range high persisted rate is clamped to max", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, playbackRate: 3.0 },
    });
    const display = html.match(/<span[^>]*data-testid="speed-display"[^>]*>[^<]*/);
    expect(display).not.toBeNull();
    expect(display![0]).toContain("2.50x");
  });

  it("out-of-range low persisted rate is clamped to min", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, playbackRate: 0.1 },
    });
    const display = html.match(/<span[^>]*data-testid="speed-display"[^>]*>[^<]*/);
    expect(display).not.toBeNull();
    expect(display![0]).toContain("0.25x");
  });

  // ── Copy ────────────────────────────────────────────────────

  it("shows simplified product copy only", () => {
    const html = render();
    expect(html).toContain("Listen through once to continue");
    expect(html).not.toContain("Threshold met");
    expect(html).not.toContain("listening block");
    expect(html).not.toContain("Mark listening complete");
    expect(html).not.toContain("finish this block");
  });

  it("shows Ready to continue when threshold is met", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, maxPositionSeconds: 115 },
    });
    expect(html).toContain("Ready to continue");
  });

  // ── CTA ─────────────────────────────────────────────────────

  it("does not render Continue button", () => {
    const html = render();
    const continueBtn = html.match(/<button[^>]*data-testid="continue-button"[^>]*>/);
    expect(continueBtn).toBeNull();
  });

  it("does not render Open reader in the bottom action row", () => {
    const html = render();
    // Open reader should no longer appear as a CTA action
    expect(html).not.toContain("Open reader");
  });

  it("shows Done for today as the primary CTA", () => {
    const html = render();
    expect(html).toContain("Done for today");
    expect(html).toContain('data-testid="done-for-today-button"');
  });

  it("Done for today is disabled before threshold", () => {
    const html = render();
    const match = html.match(/<button[^>]*data-testid="done-for-today-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/disabled=""/);
  });

  it("Done for today is enabled after threshold", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, maxPositionSeconds: 115 },
    });
    const match = html.match(/<button[^>]*data-testid="done-for-today-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toMatch(/disabled=""/);
  });

  it("Done for today uses app-button primary style", () => {
    const html = render();
    const match = html.match(/<button[^>]*data-testid="done-for-today-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("app-button");
  });

  it("shows Play again as secondary action", () => {
    const html = render();
    expect(html).toContain("Play again");
    expect(html).toContain('data-testid="play-again-button"');
    const match = html.match(/<button[^>]*data-testid="play-again-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("app-button-secondary");
  });

  it("shows Another passage when next asset exists", () => {
    const html = render({ nextAssetId: "next-1" });
    expect(html).toContain("Another passage");
    expect(html).toContain('data-testid="another-passage-button"');
  });

  it("hides Another passage when no next asset exists", () => {
    const html = render({ nextAssetId: null });
    expect(html).not.toContain("Another passage");
    const match = html.match(/data-testid="another-passage-button"/);
    expect(match).toBeNull();
  });

  it("Done for today is enabled when already completed", () => {
    const html = render({
      completedForToday: true,
      initialCompletion: { ...defaultCompletion, completed: true },
    });
    const match = html.match(/<button[^>]*data-testid="done-for-today-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toMatch(/disabled=""/);
  });

  // ── Completed state ─────────────────────────────────────────

  it("shows 'Listening logged' state indicator when completed", () => {
    const html = render({
      completedForToday: true,
      initialCompletion: { ...defaultCompletion, completed: true },
    });
    expect(html).toContain('data-testid="complete-indicator"');
    expect(html).toContain("Listening logged");
    expect(html).not.toMatch(/<button[^>]*bg-emerald-500/);
  });

  it("shows Undo button when completed", () => {
    const html = render({
      completedForToday: true,
      initialCompletion: { ...defaultCompletion, completed: true },
    });
    const match = html.match(/<button[^>]*data-testid="undo-complete-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toMatch(/disabled=""/);
  });

  it("hides status message when already done", () => {
    const html = render({
      completedForToday: true,
      initialCompletion: { ...defaultCompletion, completed: true },
    });
    expect(html).not.toContain("Listen through once");
    expect(html).not.toContain("Ready to continue");
  });

  // ── Mark complete (header) ──────────────────────────────────

  it("shows Mark complete button when not yet completed", () => {
    const html = render();
    expect(html).toContain("Mark complete");
    expect(html).toContain('data-testid="mark-complete-button"');
  });

  it("Mark complete is always enabled", () => {
    const html = render();
    const match = html.match(/<button[^>]*data-testid="mark-complete-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toMatch(/disabled=""/);
  });

  it("Mark complete becomes state indicator when already completed", () => {
    const html = render({
      completedForToday: true,
      initialCompletion: { ...defaultCompletion, completed: true },
    });
    expect(html).not.toContain('data-testid="mark-complete-button"');
    expect(html).toContain('data-testid="complete-indicator"');
    expect(html).toContain("Listening logged");
    expect(html).toContain('data-testid="undo-complete-button"');
  });

  // ── Transcript ──────────────────────────────────────────────

  it("transcript is hidden by default", () => {
    const html = render();
    expect(html).toContain("Show transcript");
    expect(html).not.toContain("transcript-content");
    expect(html).not.toContain("data-interactive-word");
  });

  it("transcript is visible when initialCompletion.transcriptOpened is true", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, transcriptOpened: true },
    });
    expect(html).toContain("Hide transcript");
    expect(html).toContain("transcript-content");
    // Words are present as tokenized content
    expect(html).toContain("Hola");
    expect(html).toContain("mundo");
  });

  it("open transcript renders tappable word tokens", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, transcriptOpened: true },
    });
    // Words render as interactive buttons via InteractiveText
    expect(html).toContain('data-interactive-word="true"');
    // Check specific words are tappable buttons
    const wordButtons = html.match(/<button[^>]*data-interactive-word="true"[^>]*>[^<]+<\/button>/g) || [];
    expect(wordButtons.length).toBeGreaterThan(0);
    // "Hola" should be a tappable word
    const holaButton = wordButtons.find((b) => b.includes("Hola"));
    expect(holaButton).toBeDefined();
  });

  it("transcript uses InteractiveText not plain paragraphs", () => {
    const html = render({
      initialCompletion: { ...defaultCompletion, transcriptOpened: true },
    });
    // Transcript content should contain interactive word buttons, not just plain text nodes
    const contentStart = html.indexOf("transcript-content");
    const contentSlice = html.slice(contentStart, contentStart + 2000);
    expect(contentSlice).toContain('data-interactive-word="true"');
    // Punctuation rendered as spans, not buttons
    expect(contentSlice).toContain("<span>.</span>");
  });

  it("transcript toggle has accordion chevron", () => {
    const html = render();
    // The toggle contains a chevron SVG
    const toggleArea = html.slice(
      html.indexOf("transcript-toggle"),
      html.indexOf("transcript-toggle") + 500,
    );
    expect(toggleArea).toContain("<svg");
  });

  it("does not show transcript section when asset has no transcript", () => {
    const html = render({
      asset: { ...baseAsset, transcript: null },
    });
    expect(html).not.toContain("Show transcript");
    expect(html).not.toContain("Hide transcript");
  });

  // ── Previous / next item navigation ─────────────────────────

  it("previous track button has skip-back icon and correct aria-label", () => {
    const html = render({ prevAssetId: "prev-1", nextAssetId: "next-1" });
    expect(html).toContain('aria-label="Previous listening item"');
    // Button contains an SVG icon, not text
    const match = html.match(/<button[^>]*data-testid="prev-item-button"[^>]*>.*?<\/button>/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("<svg");
  });

  it("next track button has skip-forward icon and correct aria-label", () => {
    const html = render({ prevAssetId: "prev-1", nextAssetId: "next-1" });
    expect(html).toContain('aria-label="Next listening item"');
    const match = html.match(/<button[^>]*data-testid="next-item-button"[^>]*>.*?<\/button>/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("<svg");
  });

  it("previous button is disabled when no previous item", () => {
    const html = render({ prevAssetId: null, nextAssetId: "next-1" });
    const match = html.match(/<button[^>]*data-testid="prev-item-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/disabled=""/);
  });

  it("next button is disabled when no next item", () => {
    const html = render({ prevAssetId: "prev-1", nextAssetId: null });
    const match = html.match(/<button[^>]*data-testid="next-item-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/disabled=""/);
  });

  it("previous button is enabled when previous item exists", () => {
    const html = render({ prevAssetId: "prev-1" });
    const match = html.match(/<button[^>]*data-testid="prev-item-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toMatch(/disabled=""/);
  });

  it("next button is enabled when next item exists", () => {
    const html = render({ nextAssetId: "next-1" });
    const match = html.match(/<button[^>]*data-testid="next-item-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toMatch(/disabled=""/);
  });

  it("both nav buttons disabled when no neighbors", () => {
    const html = render({ prevAssetId: null, nextAssetId: null });
    const prev = html.match(/<button[^>]*data-testid="prev-item-button"[^>]*>/);
    const next = html.match(/<button[^>]*data-testid="next-item-button"[^>]*>/);
    expect(prev).not.toBeNull();
    expect(next).not.toBeNull();
    expect(prev![0]).toMatch(/disabled=""/);
    expect(next![0]).toMatch(/disabled=""/);
  });

  it("all five transport aria-labels are correct", () => {
    const html = render({ prevAssetId: "p", nextAssetId: "n" });
    expect(html).toContain('aria-label="Previous listening item"');
    expect(html).toContain('aria-label="Rewind 10 seconds"');
    expect(html).toContain('aria-label="Play audio"');
    expect(html).toContain('aria-label="Forward 10 seconds"');
    expect(html).toContain('aria-label="Next listening item"');
  });

  it("transport row coexists with scrubber and speed controls", () => {
    const html = render({ prevAssetId: "p", nextAssetId: "n" });
    expect(html).toContain('aria-label="Audio progress"');
    expect(html).toContain('aria-label="Playback speed"');
    expect(html).toContain('data-testid="speed-display"');
    expect(html).toContain("0.75x");
  });

  // ── Previous button restart-or-navigate behavior ────────────

  it("previous button disabled at start with no previous passage", () => {
    // currentTime=0 on initial render, no prevAssetId → disabled
    const html = render({ prevAssetId: null });
    const match = html.match(/<button[^>]*data-testid="prev-item-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/disabled=""/);
  });

  it("previous button enabled at start when previous passage exists", () => {
    // currentTime=0, but prevAssetId present → enabled (would navigate)
    const html = render({ prevAssetId: "prev-1" });
    const match = html.match(/<button[^>]*data-testid="prev-item-button"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toMatch(/disabled=""/);
  });

  it("next button still disabled when no next item regardless of previous behavior", () => {
    // Verify next button behavior is unchanged by the previous button changes
    const html = render({ prevAssetId: "prev-1", nextAssetId: null });
    const next = html.match(/<button[^>]*data-testid="next-item-button"[^>]*>/);
    expect(next).not.toBeNull();
    expect(next![0]).toMatch(/disabled=""/);
    // prev is still enabled
    const prev = html.match(/<button[^>]*data-testid="prev-item-button"[^>]*>/);
    expect(prev).not.toBeNull();
    expect(prev![0]).not.toMatch(/disabled=""/);
  });

  it("next button still enabled when next item exists regardless of previous behavior", () => {
    const html = render({ prevAssetId: null, nextAssetId: "next-1" });
    const next = html.match(/<button[^>]*data-testid="next-item-button"[^>]*>/);
    expect(next).not.toBeNull();
    expect(next![0]).not.toMatch(/disabled=""/);
  });
});
