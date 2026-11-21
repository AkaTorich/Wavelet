// Настройки: папки библиотеки и обход, тема, итог библиотеки, клавиши.

import { api, pickFolder } from '../api.js';
import { ask } from '../menu.js';
import { el, fmtLong, fmtSize, icon, plural, toast } from '../util.js';
import { head } from './common.js';
import { colors, PRESETS, resetRole, ROLES, setColors } from '../colors.js';

async function addAndScan(ctx, path) {
  try {
    const added = await api.addFolder(path);
    if (!added) { toast('This folder is already in the library'); return; }
    await api.startScan();
    ctx.reload();
  } catch (e) {
    toast(String(e), 5000);
  }
}

export async function settings(ctx) {
  ctx.setSort(null);
  const [folders, stats, suggested] = await Promise.all([api.folders(), api.stats(), api.defaultFolders()]);

  // ── папки ──
  const fsec = el('section', {}, el('h2', { text: 'Library folders' }));
  if (!folders.length) fsec.append(el('p.dim', { text: 'None yet. Add folders with music and video — Wavelet will scan them and build the library.' }));
  for (const f of folders) {
    fsec.append(el('div.folder-row', {}, icon('folder'), el('span', { text: f, title: f }),
      el('button.icon-btn', { title: 'Remove from library', onclick: async () => {
        if (!(await ask('Remove folder?', `${f}\nIts tracks leave the library; the files stay where they are.`, 'Remove', true))) return;
        const n = await api.removeFolder(f);
        toast(`Removed: ${plural(n, 'track', 'tracks')}`);
        ctx.reload();
      } }, icon('close'))));
  }
  const pathInput = el('input', { type: 'text', placeholder: ctx.desktop ? 'Folder path' : '/storage/emulated/0/Music' });
  const row = el('div.row', {},
    ctx.desktop ? el('button.tl-accent', { onclick: async () => {
      const p = await pickFolder('Folder with music or video');
      if (p) addAndScan(ctx, p);
    } }, icon('plus'), 'Add folder') : null,
    pathInput,
    el('button', { onclick: () => { if (pathInput.value.trim()) addAndScan(ctx, pathInput.value.trim()); } }, 'Add path'),
    folders.length ? el('button', { onclick: async () => {
      if (await api.startScan()) toast('Scan started'); else toast('A scan is already running');
    } }, icon('rescan'), 'Rescan') : null);
  fsec.append(row);
  const fresh = suggested.filter((s) => !folders.some((f) => s.toLowerCase().startsWith(f.toLowerCase())));
  if (fresh.length) {
    fsec.append(el('div.row', {}, el('span.dim', { text: 'Suggested:' }),
      fresh.map((s) => el('button', { onclick: () => addAndScan(ctx, s) }, icon('plus'), s.split(/[\\/]/).pop()))));
  }

  // ── итог ──
  const ssec = el('section', {}, el('h2', { text: 'Library' }), el('div.stat-grid', {},
    el('div', {}, el('b', { text: String(stats.audio) }), 'music tracks'),
    el('div', {}, el('b', { text: String(stats.video) }), 'videos'),
    el('div', {}, el('b', { text: String(stats.albums) }), 'albums'),
    el('div', {}, el('b', { text: String(stats.artists) }), 'artists'),
    el('div', {}, el('b', { text: fmtLong(stats.duration) }), 'total playtime'),
    el('div', {}, el('b', { text: fmtSize(stats.size) }), 'on disk')));


  // ── клавиши ──
  const keys = [
    ['Space', 'play / pause'], ['← →', 'seek 5 s (30 s with Shift)'], ['Ctrl + ← →', 'previous / next'],
    ['↑ ↓', 'volume (in a list — select a row)'], ['F', 'full screen (video or visualizer)'], ['V', 'visualizer'], ['M', 'sound on/off'],
    ['Ctrl + F', 'search'], ['Q', 'queue'], ['Esc', 'leave full screen'],
  ];
  const ksec = ctx.desktop ? el('section', {}, el('h2', { text: 'Keys' }),
    el('div.keys', {}, keys.flatMap(([k, v]) => [el('kbd', { text: k }), el('span', { text: v })]))) : null;

  const ver = el('section', {}, el('h2', { text: 'Wavelet 1.0.0' }),
    el('div.dim', { text: 'Music: MP3, FLAC, OGG, Opus, M4A, AAC, WAV. Video: MP4 (H.264), M4V, MOV, WebM. .srt and .vtt subtitles next to the video.' }));

  return el('div', { style: { display: 'contents' } },
    head({ title: 'Settings' }),
    el('div.settings', {}, fsec, colorSection(), ssec, ksec, ver));
}

// ── цвета: готовые схемы и по одному цвету на роль ──
function colorSection() {
  const sec = el('section.colors');
  const draw = () => {
    const now = colors();
    const same = (p) => ROLES.every((r) => p.c[r.id].toLowerCase() === now[r.id].toLowerCase());
    const presets = el('div.presets', {}, PRESETS.map((p) =>
      el('button.preset' + (same(p) ? '.on' : ''), { type: 'button', title: p.name, onclick: () => { setColors(p.c); draw(); } },
        el('span.swatches', {}, ['bg', 'accent', 'accent2', 'danger'].map((k) => el('i', { style: { background: p.c[k] } }))),
        el('span', { text: p.name }))));
    const rows = el('div.color-rows', {}, ROLES.map((r) => {
      const input = el('input', { type: 'color', value: now[r.id] });
      const code = el('span.code', { text: now[r.id] });
      input.addEventListener('input', () => { code.textContent = input.value; setColors({ [r.id]: input.value }); });
      input.addEventListener('change', () => draw());
      const changed = now[r.id].toLowerCase() !== PRESETS[0].c[r.id];
      return el('div.color-row', {}, el('span', { text: r.name }), input, code,
        el('button.icon-btn', { type: 'button', title: 'Default', hidden: !changed, onclick: () => { resetRole(r.id); draw(); } }, icon('rescan')));
    }));
    sec.replaceChildren(el('h2', { text: 'Colors' }), presets, rows,
      el('div.row', {}, el('button', { type: 'button', onclick: () => { setColors(null); draw(); } }, icon('rescan'), 'Reset to default')));
  };
  draw();
  return sec;
}
