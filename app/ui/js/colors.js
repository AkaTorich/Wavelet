// Свои цвета окна. Каждый цвет темы «Киберпанк» относится к одной роли (жёлтый — Accent, голубой — Second accent…);
// одна настройка перекрашивает все места, где этот цвет стоит, со всеми его прозрачностями и оттенками.
// Как: при запуске один раз просматриваются правила всех таблиц стилей, запоминаются свойства с цветами ролей;
// при смене цвета собирается таблица-перекрытие с теми же селекторами (она последняя, поэтому главнее).
// Оттенки роли (например, тёмный конец жёлтой заливки) сдвигаются вместе с ней на ту же разницу.
// Выбор хранится в localStorage окна (папка данных программы) и применяется до первой отрисовки.

const KEY = 'wavelet.colors';

/** Роли: anchor — основной цвет темы, members — все его оттенки, встречающиеся в стилях. */
export const ROLES = [
  { id: 'accent', name: 'Accent', anchor: [252, 238, 10], members: [[252, 238, 10], [224, 200, 0], [253, 243, 84]] },
  { id: 'accent2', name: 'Second accent', anchor: [0, 240, 255], members: [[0, 240, 255]] },
  { id: 'danger', name: 'Delete and alerts', anchor: [255, 42, 109], members: [[255, 42, 109]] },
  { id: 'text', name: 'Text', anchor: [240, 244, 255], members: [[240, 244, 255]] },
  { id: 'dim', name: 'Secondary text', anchor: [154, 162, 192], members: [[154, 162, 192]] },
  { id: 'bg', name: 'Background', anchor: [18, 16, 30], members: [[18, 16, 30], [10, 10, 18], [6, 6, 12], [14, 12, 26], [22, 20, 42]] },
  { id: 'onAccent', name: 'Text on accent buttons', anchor: [20, 18, 10], members: [[20, 18, 10]] },
];

/** Готовые схемы. Первая — исходная тема. */
export const PRESETS = [
  { name: 'Cyberpunk', c: { accent: '#fcee0a', accent2: '#00f0ff', danger: '#ff2a6d', text: '#f0f4ff', dim: '#9aa2c0', bg: '#12101e', onAccent: '#14120a' } },
  { name: 'Neon Pink', c: { accent: '#ff2a6d', accent2: '#05d9e8', danger: '#ffb000', text: '#fdf2ff', dim: '#b09cc6', bg: '#160a1c', onAccent: '#1a0610' } },
  { name: 'Netrunner', c: { accent: '#39ff14', accent2: '#00e5ff', danger: '#ff2a6d', text: '#e8ffea', dim: '#7fa88a', bg: '#06120c', onAccent: '#04140a' } },
  { name: 'Synthwave', c: { accent: '#ff71ce', accent2: '#01cdfe', danger: '#fffb96', text: '#fdf0ff', dim: '#b39ddb', bg: '#1a0b2e', onAccent: '#1a0b1e' } },
  { name: 'Red Alert', c: { accent: '#ff1f3d', accent2: '#ff9f1c', danger: '#ffd400', text: '#fff0f2', dim: '#b58c92', bg: '#140608', onAccent: '#1a0204' } },
  { name: 'Ice', c: { accent: '#7df9ff', accent2: '#b388ff', danger: '#ff4d6d', text: '#eef6ff', dim: '#8ea2b8', bg: '#0a1018', onAccent: '#031014' } },
  { name: 'Toxic', c: { accent: '#b6ff00', accent2: '#ff00a0', danger: '#ff3355', text: '#f4ffe6', dim: '#9bb08a', bg: '#0c1006', onAccent: '#121a00' } },
  { name: 'Amber', c: { accent: '#ffb000', accent2: '#00c2d1', danger: '#ff3d3d', text: '#fff4e0', dim: '#b5a58a', bg: '#120d06', onAccent: '#1a1000' } },
  { name: 'Violet', c: { accent: '#bd00ff', accent2: '#00ffd5', danger: '#ff3864', text: '#f6eeff', dim: '#a497c4', bg: '#0e0818', onAccent: '#f6eeff' } },
];

const COLOR = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+%?)\s*)?\)/g;
let entries = null; // [{ sel, media, prop, value, imp }]
let styleEl = null;
let current = {};

export const defaults = () => Object.fromEntries(ROLES.map((r) => [r.id, toHex(r.anchor)]));
export const colors = () => ({ ...defaults(), ...current });

export function initColors() {
  try { current = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { current = {}; }
  if (Object.keys(current).length) apply();
}

/** Поменять цвета (часть ролей или все); null — вернуть исходные. */
export function setColors(patch) {
  current = patch === null ? {} : { ...current, ...patch };
  for (const [k, v] of Object.entries(current)) if (v.toLowerCase() === defaults()[k]) delete current[k];
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* без запоминания */ }
  apply();
}

export function resetRole(id) {
  delete current[id];
  setColors({});
}

function scan() {
  entries = [];
  const keys = new Set(ROLES.flatMap((r) => r.members.map((m) => m.join(','))));
  const walk = (rules, media) => {
    for (const rule of rules) {
      if (rule.cssRules && rule.media) { walk(rule.cssRules, rule.media.mediaText); continue; }
      if (!rule.style || !rule.selectorText) continue;
      // по тексту правила, а не по свойствам: составные свойства с var() (background: …, var(--x)) иначе пусты
      for (const decl of rule.style.cssText.split(/;(?![^(]*\))/)) {
        const at = decl.indexOf(':');
        if (at < 0) continue;
        const prop = decl.slice(0, at).trim();
        let value = decl.slice(at + 1).trim();
        const imp = /!\s*important$/.test(value);
        if (imp) value = value.replace(/!\s*important$/, '').trim();
        let hit = false;
        for (const m of value.matchAll(COLOR)) if (keys.has(`${m[1]},${m[2]},${m[3]}`)) { hit = true; break; }
        if (hit) entries.push({ sel: rule.selectorText, media, prop, value, imp });
      }
    }
  };
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode === styleEl) continue;
    try { walk(sheet.cssRules, null); } catch { /* чужая таблица */ }
  }
}

function apply() {
  if (!entries) scan();
  // цвет оттенка → новый цвет: роль сдвигает все свои оттенки на ту же разницу
  const map = new Map();
  for (const r of ROLES) {
    const hex = current[r.id];
    if (!hex) continue;
    const c = fromHex(hex);
    for (const m of r.members) map.set(m.join(','), m.map((v, k) => clamp(c[k] + v - r.anchor[k])));
  }
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'wavelet-colors'; }
  document.head.append(styleEl); // всегда последней
  if (!map.size) { styleEl.textContent = ''; return; }
  const blocks = new Map();
  for (const e of entries) {
    let changed = false;
    const v = e.value.replace(COLOR, (all, r, g, b, a) => {
      const n = map.get(`${r},${g},${b}`);
      if (!n) return all;
      changed = true;
      return a == null ? `rgb(${n.join(',')})` : `rgba(${n.join(',')},${a})`;
    });
    if (!changed) continue;
    const key = `${e.media || ''}\u0000${e.sel}`;
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(`${e.prop}:${v}${e.imp ? ' !important' : ''}`);
  }
  let css = '';
  for (const [key, decls] of blocks) {
    const [media, sel] = key.split('\u0000');
    const rule = `${sel}{${decls.join(';')}}`;
    css += media ? `@media ${media}{${rule}}\n` : `${rule}\n`;
  }
  styleEl.textContent = css;
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
export function toHex(c) { return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); }
function fromHex(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
