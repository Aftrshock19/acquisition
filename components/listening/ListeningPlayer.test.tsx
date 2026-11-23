import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real next/link schedules prefetching through browser-only globals, which
// the mounted tests below do not provide. A plain anchor is enough here.
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
      createElement("a", { href, ...rest }, children),
  };
});

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

vi.mock("@/components/interactive-text/InteractiveText", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    InteractiveText: ({ tokens }: { tokens: Array<{ surface: string; isWord: boolean }> }) =>
      createElement(
        Fragment,
        null,
        tokens.map((t: { surface: string; isWord: boolean }, i: number) =>
          t.isWord
            ? createElement("button", {
                key: i,
                "data-interactive-word": "true",
                type: "button",
              }, t.surface)
            : createElement("span", { key: i }, t.surface),
        ),
      ),
  };
});

import React, { act } from "react";
import { completeListeningStep } from "@/app/actions/srs";
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

// ── Minimal in-memory DOM ─────────────────────────────────────
//
// vitest runs in the node environment and the repo has no DOM library, so the
// mounted tests below render with react-dom/client into this stand-in. It has
// just enough node, attribute and event plumbing for React to commit, for
// clicks to reach React's root listener, and for the player's own audio
// listeners to receive media events.

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

type FakeListener = { fn: (event: FakeEvent) => void; capture: boolean };
type ListenerOptions = boolean | { capture?: boolean };

class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable = true;
  readonly timeStamp = Date.now();
  target: FakeNode | null = null;
  currentTarget: FakeNode | null = null;
  defaultPrevented = false;
  propagationStopped = false;

  constructor(type: string, bubbles = false) {
    this.type = type;
    this.bubbles = bubbles;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }
}

class FakeNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly ownerDocument: FakeDocument | null;
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  private readonly listeners = new Map<string, FakeListener[]>();

  constructor(nodeType: number, nodeName: string, ownerDocument: FakeDocument | null) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): FakeNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value && this.ownerDocument) {
      this.appendChild(this.ownerDocument.createTextNode(value));
    }
  }

  appendChild(child: FakeNode) {
    return this.insertBefore(child, null);
  }

  insertBefore(child: FakeNode, before: FakeNode | null) {
    child.parentNode?.removeChild(child);
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index === -1) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child: FakeNode) {
    this.childNodes = this.childNodes.filter((node) => node !== child);
    child.parentNode = null;
    return child;
  }

  addEventListener(type: string, fn: FakeListener["fn"], options?: ListenerOptions) {
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { fn, capture }]);
  }

  removeEventListener(type: string, fn: FakeListener["fn"], options?: ListenerOptions) {
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(
        (listener) => listener.fn !== fn || listener.capture !== capture,
      ),
    );
  }

  // Capture from the root down to the target, then bubble back up (or stop at
  // the target for non-bubbling events such as media events).
  dispatchEvent(event: FakeEvent) {
    event.target = this;
    const path: FakeNode[] = [this];
    for (let node = this.parentNode; node; node = node.parentNode) path.push(node);
    const phases: Array<[FakeNode, boolean]> = [
      ...[...path].reverse().map((node): [FakeNode, boolean] => [node, true]),
      ...(event.bubbles ? path : [this]).map((node): [FakeNode, boolean] => [node, false]),
    ];
    for (const [node, capture] of phases) {
      if (event.propagationStopped) break;
      event.currentTarget = node;
      for (const listener of node.listeners.get(event.type) ?? []) {
        if (listener.capture === capture) listener.fn(event);
      }
    }
    event.currentTarget = null;
    return !event.defaultPrevented;
  }
}

class FakeText extends FakeNode {
  nodeValue: string;

  constructor(text: string, ownerDocument: FakeDocument) {
    super(3, "#text", ownerDocument);
    this.nodeValue = text;
  }

  get textContent(): string {
    return this.nodeValue;
  }

  set textContent(value: string) {
    this.nodeValue = value;
  }
}

class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly namespaceURI: string;
  private readonly attributeMap = new Map<string, string>();

  constructor(tagName: string, namespaceURI: string, ownerDocument: FakeDocument) {
    super(1, tagName, ownerDocument);
    this.tagName = tagName;
    this.namespaceURI = namespaceURI;
  }

  getAttribute(name: string) {
    return this.attributeMap.get(name) ?? null;
  }

  hasAttribute(name: string) {
    return this.attributeMap.has(name);
  }

  setAttribute(name: string, value: unknown) {
    this.attributeMap.set(name, String(value));
  }

  removeAttribute(name: string) {
    this.attributeMap.delete(name);
  }
}

// Media state the player reads from its <audio> element; tests set it directly.
class FakeAudioElement extends FakeElement {
  duration = Number.NaN;
  currentTime = 0;
  playbackRate = 1;

  constructor(ownerDocument: FakeDocument) {
    super("AUDIO", HTML_NAMESPACE, ownerDocument);
  }
}

class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement;
  defaultView: object | null = null;

  constructor() {
    super(9, "#document", null);
    this.documentElement = this.createElement("html");
    this.body = this.createElement("body");
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(tagName: string): FakeElement {
    return tagName === "audio"
      ? new FakeAudioElement(this)
      : new FakeElement(tagName.toUpperCase(), HTML_NAMESPACE, this);
  }

  createElementNS(namespaceURI: string, tagName: string) {
    return new FakeElement(tagName, namespaceURI, this);
  }

  createTextNode(text: string) {
    return new FakeText(text, this);
  }
}

function installFakeDom() {
  const fakeDocument = new FakeDocument();
  const fakeWindow = {
    document: fakeDocument,
    event: undefined,
    HTMLIFrameElement: class {},
  };
  fakeDocument.defaultView = fakeWindow;
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return fakeDocument;
}

function findNode(root: FakeNode, predicate: (node: FakeNode) => boolean): FakeNode | null {
  if (predicate(root)) return root;
  for (const child of root.childNodes) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function findByTestId(root: FakeNode, testId: string) {
  const found = findNode(
    root,
    (node) => node instanceof FakeElement && node.getAttribute("data-testid") === testId,
  );
  if (!found) throw new Error(`No element with data-testid="${testId}"`);
  return found;
}

describe("ListeningPlayer auto-complete when the audio ends", () => {
  type CompleteResult = Awaited<ReturnType<typeof completeListeningStep>>;
  const okResult = { ok: true, nextPath: "/done", dailySession: {} } as unknown as CompleteResult;

  let fakeDocument: FakeDocument;
  let root: Root | null = null;

  beforeEach(() => {
    fakeDocument = installFakeDom();
    vi.mocked(completeListeningStep).mockReset().mockResolvedValue(okResult);
  });

  afterEach(async () => {
    const mounted = root;
    root = null;
    if (mounted) await act(async () => mounted.unmount());
    vi.unstubAllGlobals();
  });

  async function mount(props: Partial<Parameters<typeof ListeningPlayer>[0]> = {}) {
    const container = fakeDocument.body.appendChild(fakeDocument.createElement("div"));
    const mountedRoot = createRoot(container as unknown as HTMLElement);
    root = mountedRoot;
    await act(async () => {
      mountedRoot.render(
        <ListeningPlayer
          asset={baseAsset}
          completedForToday={false}
          initialCompletion={defaultCompletion}
          {...props}
        />,
      );
    });
    const audio = findNode(container, (node) => node instanceof FakeAudioElement);
    if (!(audio instanceof FakeAudioElement)) throw new Error("No <audio> element rendered");
    return { container, audio };
  }

  async function click(container: FakeNode, testId: string) {
    await act(async () => {
      findByTestId(container, testId).dispatchEvent(new FakeEvent("click", true));
    });
  }

  async function fire(audio: FakeAudioElement, type: string) {
    await act(async () => {
      audio.dispatchEvent(new FakeEvent(type));
    });
  }

  it("records the transcript and playback rate chosen after mount", async () => {
    const { container, audio } = await mount();
    audio.duration = 120;

    await click(container, "transcript-toggle");
    await click(container, "speed-preset-1.5");
    await click(container, "speed-decrease");
    expect(audio.playbackRate).toBe(1.45);

    await fire(audio, "ended");

    expect(completeListeningStep).toHaveBeenCalledTimes(1);
    expect(completeListeningStep).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        transcriptOpened: true,
        playbackRate: 1.45,
        maxPositionSeconds: 120,
        requiredListenSeconds: 108,
      }),
    );
  });

  it("uses the duration loaded after mount for the required listen time", async () => {
    const { audio } = await mount({ asset: { ...baseAsset, durationSeconds: null } });
    audio.duration = 200;

    await fire(audio, "loadedmetadata");
    await fire(audio, "ended");

    expect(completeListeningStep).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPositionSeconds: 200,
        requiredListenSeconds: 180,
      }),
    );
  });

  it("does not auto-complete again once listening is logged", async () => {
    const { container, audio } = await mount();
    audio.duration = 120;

    await fire(audio, "ended");
    expect(findByTestId(container, "complete-indicator")).toBeTruthy();
    await fire(audio, "ended");

    expect(completeListeningStep).toHaveBeenCalledTimes(1);
  });

  it("does not auto-complete while another save is in flight", async () => {
    let resolveSave: (result: CompleteResult) => void = () => {};
    vi.mocked(completeListeningStep).mockReturnValueOnce(
      new Promise<CompleteResult>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { container, audio } = await mount();
    audio.duration = 120;

    await click(container, "mark-complete-button");
    await fire(audio, "ended");

    expect(completeListeningStep).toHaveBeenCalledTimes(1);
    await act(async () => resolveSave(okResult));
  });
});
