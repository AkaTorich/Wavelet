// Мелкие помощники: создание элементов, значки, время, размеры, подсказки.

import { fileUrl } from './api.js';

export const $ = (sel, root = document) => root.querySelector(sel);

/** el('div.class#id', {attr, onclick}, ...дети) */
export function el(spec, attrs = {}, ...children) {
  const m = spec.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i) || [];
  const node = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    else node.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function icon(name, cls = 'ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

/** Меняет значок внутри кнопки. */
export function setIcon(btn, name) {
  const use = btn.querySelector('use');
  if (use) use.setAttribute('href', '#i-' + name);
}

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Длительность словами для сводок: «2 ч 14 мин», «47 мин». */
export function fmtLong(sec) {
  if ((sec || 0) < 60) return `${Math.round(sec || 0)} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function fmtSize(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = bytes || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i && v < 10 ? 1 : 0)} ${u[i]}`;
}

/** «1 track», «3 tracks». */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastTimer;
export function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

/** Картинка обложки как фон элемента; без обложки — значок. */
export function setArt(node, path, fallbackIcon = 'music') {
  node.textContent = '';
  if (path) {
    node.style.backgroundImage = `url("${fileUrl(path)}")`;
  } else {
    node.style.backgroundImage = '';
    node.append(icon(fallbackIcon));
  }
}

export function artistOf(m) {
  return m.artist || m.album_artist || '';
}

/** Вторая строка записи: «Исполнитель · Альбом» или папка для видео. */
export function subline(m) {
  if (m.kind === 'video') {
    const parts = [];
    if (m.width) parts.push(`${m.width}×${m.height}`);
    parts.push(m.dir.split(/[\\/]/).pop());
    return parts.join(' · ');
  }
  return [artistOf(m), m.album].filter(Boolean).join(' · ') || m.file_name;
}

export function stars(rating, onSet) {
  const box = el('span.stars');
  for (let i = 1; i <= 5; i++) {
    const s = icon('star');
    if (i <= rating) s.classList.add('on');
    if (onSet) {
      s.addEventListener('click', (e) => { e.stopPropagation(); onSet(i === rating ? 0 : i); });
    }
    box.append(s);
  }
  return box;
}

/** Ползунок с закрашенной частью (CSS-переменная --fill). */
export function paintRange(input) {
  const min = +input.min || 0, max = +input.max || 100;
  input.style.setProperty('--fill', `${((+input.value - min) / (max - min || 1)) * 100}%`);
}

export const isPhone = () => window.matchMedia('(max-width: 720px)').matches;
