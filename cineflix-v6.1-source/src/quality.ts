/* ═══════════════════════════════════════════════════════════════════════
   CineFliX Quality Engine · v6.1
   Progressive MP4s have no built-in adaptive streaming, so CineFliX does it:
   1. Start at the best stream this screen + connection can sustain.
   2. Measure real throughput while playing (buffer growth × bitrate).
   3. Auto mode steps UP when there's headroom, DOWN on stalls.
   4. Switches are seamless — the player freezes the last frame while the
      new source seeks, so viewers never see a black flash.
═══════════════════════════════════════════════════════════════════════ */
import type { Stream } from './types';

export type QualityMode = 'auto' | number; // number = fixed resolution
export interface QualityPrefs { mode: QualityMode; enhance: boolean }

const PREFS_KEY = 'cf_quality_v1';
const BW_KEY = 'cf_bw_v1';

/** Typical bitrates (bps) when the file size is unknown. */
const TYPICAL: Record<number, number> = { 240: 0.35e6, 360: 0.7e6, 480: 1.1e6, 540: 1.5e6, 720: 2.2e6, 1080: 4.5e6, 1440: 8e6, 2160: 14e6 };

export function loadPrefs(): QualityPrefs {
  try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); if (p) return { mode: p.mode ?? 'auto', enhance: p.enhance !== false }; } catch { /* */ }
  return { mode: 'auto', enhance: true };
}
export function savePrefs(p: QualityPrefs): void { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* */ } }

/** Highest vertical resolution worth fetching for this device. */
export function screenCap(): number {
  const c = navigator.connection;
  if (c?.saveData) return 360;
  const long = Math.max(screen.width, screen.height) * Math.min(window.devicePixelRatio || 1, 3);
  const needed = long * 9 / 16; // a 16:9 picture filling the screen in landscape
  const steps = [360, 480, 720, 1080, 1440, 2160];
  return steps.find((s) => s >= needed * 0.9) || 2160;
}

/** Best known bandwidth estimate in bps (measured > network hint > default). */
export function estimateBandwidth(): number {
  try { const v = parseFloat(localStorage.getItem(BW_KEY) || ''); if (v > 0) return v; } catch { /* */ }
  const c = navigator.connection;
  // Chrome rounds and caps `downlink`; on a 4G-class link assume HD is sustainable
  // until real measurements arrive (the adaptive controller corrects within seconds).
  if (c?.downlink) return Math.max(c.downlink * 1e6 * 0.85, c.effectiveType === '4g' ? 5e6 : 0);
  if (c?.effectiveType) return ({ 'slow-2g': 0.1e6, '2g': 0.25e6, '3g': 1.2e6, '4g': 6e6 } as Record<string, number>)[c.effectiveType] ?? 3e6;
  return 3e6;
}
function recordBandwidth(bps: number): void {
  const prev = estimateBandwidth();
  const next = prev ? prev * 0.6 + bps * 0.4 : bps; // EWMA — stable across sessions
  try { localStorage.setItem(BW_KEY, String(Math.round(next))); } catch { /* */ }
}

export function bitrateOf(s: Stream, durationSec: number): number {
  if (s.size && durationSec > 60) return (s.size * 8) / durationSec;
  const keys = Object.keys(TYPICAL).map(Number);
  const k = keys.reduce((a, b) => (Math.abs(b - s.res) < Math.abs(a - s.res) ? b : a), 720);
  return TYPICAL[k];
}

/** Resolution tier label for the player badge. */
export function tier(res: number): string {
  if (res >= 2000) return '4K';
  if (res >= 1400) return 'QHD';
  if (res >= 1000) return 'Full HD';
  if (res >= 700) return 'HD';
  return 'SD';
}

/** Index of the stream to start with. `streams` is sorted high → low. */
export function pickInitial(streams: Stream[], durationSec: number, prefs: QualityPrefs): number {
  if (!streams.length) return -1;
  if (prefs.mode !== 'auto') {
    const fixed = streams.findIndex((s) => s.res <= (prefs.mode as number));
    return fixed >= 0 ? fixed : streams.length - 1;
  }
  const cap = screenCap(), bw = estimateBandwidth();
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    if (s.res && s.res > cap) continue;
    if (bitrateOf(s, durationSec) * 1.25 <= bw) return i;
  }
  return streams.length - 1; // lowest
}

/* ── Adaptive controller ─────────────────────────────────────────────── */
export interface AbrHooks {
  video: HTMLVideoElement;
  streams: () => Stream[];
  current: () => number;
  duration: () => number;
  isAuto: () => boolean;
  switchTo: (idx: number, reason: 'up' | 'down') => void;
}

export class AdaptiveQuality {
  private timer = 0;
  private lastEnd = -1;
  private lastT = 0;
  private lastSwitch = Date.now();
  private stalls: number[] = [];
  private stallStart = 0;
  private seeking = false;
  private measured: number[] = [];

  constructor(private h: AbrHooks) {
    const v = h.video;
    v.addEventListener('seeking', () => { this.seeking = true; this.lastEnd = -1; });
    v.addEventListener('seeked', () => { setTimeout(() => { this.seeking = false; }, 1500); });
    v.addEventListener('waiting', () => { if (!this.seeking && !v.paused) this.stallStart = Date.now(); });
    v.addEventListener('playing', () => {
      if (this.stallStart) {
        const dur = Date.now() - this.stallStart; this.stallStart = 0;
        if (dur > 400) { this.stalls.push(Date.now()); this.maybeDown(dur); }
      }
    });
    v.addEventListener('emptied', () => { this.lastEnd = -1; this.measured = []; });
    this.timer = window.setInterval(() => this.sample(), 2000);
  }

  destroy(): void { clearInterval(this.timer); }
  noteSwitch(): void { this.lastSwitch = Date.now(); this.lastEnd = -1; this.measured = []; this.stalls = []; }

  /** Current measured throughput (bps), or 0 before enough samples. */
  get throughput(): number {
    if (this.measured.length < 2) return 0;
    const s = this.measured.slice(-5).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  private bufferAhead(): { ahead: number; end: number } {
    const v = this.h.video, t = v.currentTime;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= t + 0.5 && v.buffered.end(i) >= t) return { ahead: v.buffered.end(i) - t, end: v.buffered.end(i) };
    }
    return { ahead: 0, end: t };
  }

  private sample(): void {
    const v = this.h.video;
    if (v.paused || this.seeking || document.hidden || !v.duration) { this.lastEnd = -1; return; }
    const now = performance.now();
    const { ahead, end } = this.bufferAhead();
    // Only measure while the browser is actively downloading (buffer not full).
    if (this.lastEnd >= 0 && ahead < 100) {
      const dt = (now - this.lastT) / 1000;
      const grew = end - this.lastEnd;
      if (dt > 0.5 && grew > 0) {
        const s = this.h.streams()[this.h.current()];
        if (s) {
          const rate = grew / dt; // media-seconds downloaded per wall-clock second
          const bps = rate * bitrateOf(s, this.h.duration());
          if (isFinite(bps) && bps > 0) { this.measured.push(bps); if (this.measured.length > 12) this.measured.shift(); }
        }
      }
    }
    this.lastEnd = end; this.lastT = now;
    if (this.measured.length >= 3) recordBandwidth(this.throughput);
    this.maybeUp(ahead);
  }

  private maybeUp(ahead: number): void {
    if (!this.h.isAuto() || Date.now() - this.lastSwitch < 25000 || ahead < 20) return;
    const streams = this.h.streams(), cur = this.h.current();
    if (cur <= 0) return;
    const next = streams[cur - 1];
    if (next.res && next.res > screenCap()) return;
    const bw = this.throughput;
    if (bw && bitrateOf(next, this.h.duration()) * 1.35 < bw) { this.h.switchTo(cur - 1, 'up'); this.noteSwitch(); }
  }

  private maybeDown(lastStallMs: number): void {
    if (!this.h.isAuto()) return;
    const recent = this.stalls.filter((t) => Date.now() - t < 30000);
    this.stalls = recent;
    const cur = this.h.current(), streams = this.h.streams();
    if (cur >= streams.length - 1) return;
    if (recent.length >= 2 || lastStallMs > 3500) { this.h.switchTo(cur + 1, 'down'); this.noteSwitch(); }
  }
}
