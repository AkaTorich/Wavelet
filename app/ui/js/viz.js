// Визуализация музыки по звуку: Web Audio (AnalyserNode) снимает спектр и волну с того же <video>, что играет.
// Граф звука создаётся при первом открытии визуализации (по щелчку — иначе движок не даст запустить звук),
// дальше звук идёт через него всегда. Файлы отдаёт asset-протокол с заголовком CORS, поэтому данные не «немые».
// Виды: Spectrum — столбцы с отражением, Ring — кольцо вокруг обложки, Scope — волна со шлейфом.

import { fileUrl } from './api.js';

export const VIZ_MODES = ['Spectrum', 'Ring', 'Scope'];

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export class Visualizer {
  constructor(media) {
    this.m = media;
    this.ac = null;
    this.an = null;
    this.views = new Map(); // canvas → { mode: () => имя вида }
    this.raf = 0;
    this.peaks = new Float32Array(0);
    this.cover = null;
    this.coverPath = null;
    this.t = 0;
    try { this.mode = VIZ_MODES.includes(localStorage.getItem('wavelet.viz')) ? localStorage.getItem('wavelet.viz') : 'Spectrum'; } catch { this.mode = 'Spectrum'; }
    media.addEventListener('play', () => this.ac?.resume().catch(() => {}));
  }

  /** Подключить звук к анализатору (один раз). */
  ensure() {
    if (this.ac) { this.ac.resume().catch(() => {}); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ac = new AC();
      const src = this.ac.createMediaElementSource(this.m);
      this.an = this.ac.createAnalyser();
      this.an.fftSize = 2048;
      this.an.smoothingTimeConstant = 0.78;
      src.connect(this.an);
      this.an.connect(this.ac.destination);
      this.freq = new Uint8Array(this.an.frequencyBinCount);
      this.wave = new Uint8Array(this.an.fftSize);
      this.ac.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  nextMode() {
    this.mode = VIZ_MODES[(VIZ_MODES.indexOf(this.mode) + 1) % VIZ_MODES.length];
    try { localStorage.setItem('wavelet.viz', this.mode); } catch { /* без запоминания */ }
    return this.mode;
  }

  setCover(path) {
    if (path === this.coverPath) return;
    this.coverPath = path;
    this.cover = null;
    if (!path) return;
    const img = new Image();
    img.onload = () => { if (this.coverPath === path) this.cover = img; };
    img.src = fileUrl(path);
  }

  /** Холст рисуется, пока он виден. mode — функция, возвращающая вид (или null — общий выбранный). */
  attach(canvas, mode = () => null) {
    this.views.set(canvas, { mode });
  }

  start() {
    if (!this.ensure()) return;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  frame() {
    this.raf = 0;
    const live = [...this.views.entries()].filter(([c]) => c.getClientRects().length && c.offsetWidth > 0);
    if (!live.length) return; // ничего не видно — цикл стоит, пока снова не позовут start()
    this.an.getByteFrequencyData(this.freq);
    this.an.getByteTimeDomainData(this.wave);
    this.t += 1;
    for (const [c, v] of live) {
      const ctx = fit(c);
      const mode = v.mode() || this.mode;
      if (mode === 'Ring') this.ring(ctx, c);
      else if (mode === 'Scope') this.scope(ctx, c);
      else this.spectrum(ctx, c);
    }
    this.raf = requestAnimationFrame(() => this.frame());
  }

  /** Полосы по логарифму частоты 30 Гц … 16 кГц, значения 0…1. */
  bands(n) {
    const out = new Float32Array(n);
    const nyq = this.ac.sampleRate / 2, len = this.freq.length;
    const lo = Math.log(30), hi = Math.log(16000);
    for (let i = 0; i < n; i++) {
      const b0 = Math.floor((Math.exp(lo + (hi - lo) * i / n) / nyq) * len);
      const b1 = Math.max(b0 + 1, Math.ceil((Math.exp(lo + (hi - lo) * (i + 1) / n) / nyq) * len));
      let v = 0;
      for (let b = b0; b < b1 && b < len; b++) v = Math.max(v, this.freq[b]);
      out[i] = Math.min(1, (v / 255) * (0.82 + 0.4 * i / n));
    }
    return out;
  }

  bass() {
    const nyq = this.ac.sampleRate / 2, top = Math.ceil((140 / nyq) * this.freq.length);
    let s = 0;
    for (let b = 1; b <= top; b++) s += this.freq[b];
    return s / (top * 255);
  }

  colors() {
    return {
      a: css('--tl-accent', '#fcee0a'),
      b: css('--tl-accent2', '#00f0ff'),
      c: css('--tl-danger', '#ff2a6d'),
    };
  }

  // ── Spectrum: столбцы над полом с отражением и падающими «шапками» ──
  spectrum(ctx, c) {
    const w = c.width, h = c.height, dpr = c._dpr;
    const n = Math.max(24, Math.min(128, Math.floor(w / (9 * dpr))));
    const v = this.bands(n);
    if (this.peaks.length !== n) this.peaks = new Float32Array(n);
    const col = this.colors();
    ctx.clearRect(0, 0, w, h);
    const base = Math.round(h * 0.7), maxH = h * 0.62;
    // пол
    ctx.strokeStyle = col.b; ctx.globalAlpha = 0.18; ctx.lineWidth = dpr;
    for (let k = 1; k <= 5; k++) { const y = base + (h - base) * (k / 5) ** 1.6; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    const gw = w / n, bw = Math.max(dpr, gw * 0.68);
    const grad = ctx.createLinearGradient(0, base - maxH, 0, base);
    grad.addColorStop(0, col.c); grad.addColorStop(0.45, col.a); grad.addColorStop(1, col.a);
    for (let i = 0; i < n; i++) {
      const bh = Math.max(2 * dpr, v[i] * maxH), x = i * gw + (gw - bw) / 2;
      ctx.fillStyle = grad;
      ctx.fillRect(x, base - bh, bw, bh);
      ctx.globalAlpha = 0.22;
      ctx.fillRect(x, base + 2 * dpr, bw, bh * 0.35);
      ctx.globalAlpha = 1;
      this.peaks[i] = Math.max(this.peaks[i] - 0.008, v[i]);
      ctx.fillStyle = col.b;
      ctx.fillRect(x, base - this.peaks[i] * maxH - 4 * dpr, bw, 2 * dpr);
    }
    ctx.fillStyle = col.a; ctx.globalAlpha = 0.6; ctx.fillRect(0, base, w, dpr); ctx.globalAlpha = 1;
  }

  // ── Ring: кольцо лучей вокруг обложки, дышит от баса ──
  ring(ctx, c) {
    const w = c.width, h = c.height, dpr = c._dpr;
    const col = this.colors();
    const half = 90, v = this.bands(half), bass = this.bass();
    const cx = w / 2, cy = h / 2, s = Math.min(w, h);
    const r0 = s * 0.2 * (1 + bass * 0.18);
    ctx.clearRect(0, 0, w, h);
    // ореол
    const glow = ctx.createRadialGradient(cx, cy, r0 * 0.8, cx, cy, s * 0.55);
    glow.addColorStop(0, hexA(col.a, 0.10 + bass * 0.25)); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    // лучи: правая половина и её зеркало
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(dpr * 1.5, (Math.PI * 2 * r0) / (half * 2) * 0.55);
    for (let i = 0; i < half; i++) {
      const len = 4 * dpr + v[i] * s * 0.24;
      ctx.strokeStyle = i % 2 ? col.b : col.a;
      for (const sign of [1, -1]) {
        const a = -Math.PI / 2 + sign * (Math.PI * (i + 0.5) / half);
        const x0 = cx + Math.cos(a) * (r0 + 6 * dpr), y0 = cy + Math.sin(a) * (r0 + 6 * dpr);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len); ctx.stroke();
      }
    }
    // обложка в круге
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r0, 0, Math.PI * 2); ctx.clip();
    if (this.cover) {
      const k = Math.max((2 * r0) / this.cover.width, (2 * r0) / this.cover.height);
      const iw = this.cover.width * k, ih = this.cover.height * k;
      ctx.drawImage(this.cover, cx - iw / 2, cy - ih / 2, iw, ih);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(cx - r0, cy - r0, 2 * r0, 2 * r0);
    }
    ctx.restore();
    ctx.strokeStyle = col.a; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(cx, cy, r0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = hexA(col.b, 0.5); ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.arc(cx, cy, r0 + 3 * dpr + bass * 10 * dpr, 0, Math.PI * 2); ctx.stroke();
  }

  // ── Scope: волна звука, прошлые кадры гаснут шлейфом ──
  scope(ctx, c) {
    const w = c.width, h = c.height, dpr = c._dpr;
    const col = this.colors();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    const mid = h / 2, amp = h * 0.36, n = this.wave.length, step = Math.max(1, Math.floor(n / (w / dpr)));
    ctx.strokeStyle = hexA(col.b, 0.15); ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    const line = (color, width, scale, shift) => {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0, x = 0; i < n; i += step, x = (i / n) * w) {
        const y = mid + ((this.wave[i] - 128) / 128) * amp * scale + shift;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    line(hexA(col.c, 0.55), 1.5 * dpr, -0.6, 0);
    ctx.shadowColor = col.a; ctx.shadowBlur = 12 * dpr;
    line(col.a, 2.2 * dpr, 1, 0);
    ctx.shadowBlur = 0;
  }
}

/** Размер холста по его месту на экране (с учётом плотности точек, не больше 2×). */
function fit(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c._dpr = dpr;
  return c.getContext('2d');
}

/** Цвет темы с прозрачностью: понимает #rrggbb и rgba(...). */
function hexA(color, a) {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(',').map((x) => x.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
  if (color[0] === '#' && color.length >= 7) {
    return `rgba(${parseInt(color.slice(1, 3), 16)},${parseInt(color.slice(3, 5), 16)},${parseInt(color.slice(5, 7), 16)},${a})`;
  }
  return color;
}
