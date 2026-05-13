// src/core/subtitles.ts
//
// Build an ASS subtitle file from say events. Audio mix and subtitle burn-in
// are added in the SAME per-scene ffmpeg call from the SAME ev.t values, so
// the two cannot drift — this is the structural coupling that prevents the
// audio-leads-karaoke bug.
import type { WordTiming } from "../tts/provider.js";
import { quantizeMsToCs } from "./scene-audio.js";

export interface SubtitleSayEvent {
  /** Scene-relative timestamp in ms, same value used for audio `adelay`. */
  t: number;
  /** Total duration of the say in ms. */
  durationMs: number;
  /** Per-word timings, ms-relative to the start of this say. */
  words: WordTiming[];
}

export interface BuildAssOpts {
  events: SubtitleSayEvent[];
  /** Video dimensions for the ASS PlayRes header. Defaults match the default
   *  viewport (1440x900). */
  playResX?: number;
  playResY?: number;
  /** Font size in ASS units (relative to PlayResY). */
  fontSize?: number;
}

/** ms → "H:MM:SS.cs" (ASS time format, centisecond precision). */
export function formatAssTime(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** ASS uses `{}` for override blocks; word text containing `{` or `}` would
 *  break the parser. TTS produces plain prose so this is defense-in-depth. */
function escapeAssText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")");
}

/** Build a karaoke-tagged Dialogue text from word timings. The karaoke clock
 *  in ASS advances by the sum of all preceding `{\kN}` durations — so we must
 *  account for leading silence AND inter-word gaps, not just word durations.
 *  Otherwise the highlight runs ahead of the audio (TTS adds breath/preroll
 *  before the first word and pauses after commas/periods). Provider-agnostic:
 *  as long as `WordTiming.startMs/endMs` describe true offsets in the MP3,
 *  emitting a leading `{\kgap}` before each word makes the cumulative karaoke
 *  time equal `word.startMs` exactly — same time as the audio sample. */
function buildKaraokeText(words: WordTiming[]): string {
  const parts: string[] = [];
  let cursorCs = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // Quantize each boundary to centiseconds the same way (round-to-grid)
    // before differencing. Differencing pre-rounded values keeps the running
    // karaoke clock identical to a cs-rounded view of word.startMs/endMs —
    // the same grid the .ass Dialogue start lives on.
    const startCs = Math.round(w.startMs / 10);
    const endCs = Math.round(w.endMs / 10);
    const gapCs = Math.max(0, startCs - cursorCs);
    if (gapCs > 0) parts.push(`{\\k${gapCs}}`);
    const durCs = Math.max(0, endCs - startCs);
    const text = escapeAssText((w as { word?: string; text?: string }).word ?? (w as { text?: string }).text ?? "");
    const sep = i < words.length - 1 ? " " : "";
    parts.push(`{\\k${durCs}}${text}${sep}`);
    cursorCs = startCs + durCs;
  }
  return parts.join("");
}

export function buildAss(opts: BuildAssOpts): string {
  const playResX = opts.playResX ?? 1440;
  const playResY = opts.playResY ?? 900;
  const fontSize = opts.fontSize ?? 36;
  // ASS BGR colors. Amber #fbbf24 → BGR 24bffb.
  const primary = "&H0024BFFB"; // amber — color words turn TO after being sung
  const secondary = "&H00FFFFFF"; // white — color words start in
  const outline = "&H00000000"; // black outline
  const back = "&HAA000000"; // semi-transparent black box (opacity ~33%)
  // BorderStyle 3 = opaque box behind text. Alignment 2 = bottom-center.
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,Arial,${fontSize},${primary},${secondary},${outline},${back},0,0,0,0,100,100,0,0,3,2,0,2,40,40,80,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const lines: string[] = [];
  for (const ev of opts.events) {
    // Quantize identically to scene-audio's adelay — the two must agree
    // exactly, or the burned subtitle drifts up to 9ms from the audio sample.
    const t = quantizeMsToCs(ev.t);
    const start = formatAssTime(t);
    const end = formatAssTime(t + ev.durationMs);
    const text = buildKaraokeText(ev.words);
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }
  return header.concat(lines).join("\n") + "\n";
}
