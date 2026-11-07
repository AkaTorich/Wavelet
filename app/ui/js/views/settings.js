// Настройки: папки библиотеки и обход, тема, итог библиотеки, клавиши.

import { api, pickFolder } from '../api.js';
import { ask } from '../menu.js';
import { el, fmtLong, fmtSize, icon, plural, toast } from '../util.js';
import { head } from './common.js';

async function addAndScan(ctx, path) {
  try {
    const added = await api.addFolder(path);
    if (!added) { toast('Эта папка уже входит в библиотеку'); return; }
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
  const fsec = el('section', {}, el('h2', { text: 'Папки библиотеки' }));
  if (!folders.length) fsec.append(el('p.dim', { text: 'Пока ни одной. Добавьте папки с музыкой и видео — программа обойдёт их и составит библиотеку.' }));
  for (const f of folders) {
    fsec.append(el('div.folder-row', {}, icon('folder'), el('span', { text: f, title: f }),
      el('button.icon-btn', { title: 'Убрать из библиотеки', onclick: async () => {
        if (!(await ask('Убрать папку?', `${f}\nЗаписи из неё уйдут из библиотеки, файлы останутся на месте.`, 'Убрать', true))) return;
        const n = await api.removeFolder(f);
        toast(`Убрано: ${plural(n, 'запись', 'записи', 'записей')}`);
        ctx.reload();
      } }, icon('close'))));
  }
  const pathInput = el('input', { type: 'text', placeholder: ctx.desktop ? 'Путь к папке' : '/storage/emulated/0/Music' });
  const row = el('div.row', {},
    ctx.desktop ? el('button.tl-accent', { onclick: async () => {
      const p = await pickFolder('Папка с музыкой или видео');
      if (p) addAndScan(ctx, p);
    } }, icon('plus'), 'Добавить папку') : null,
    pathInput,
    el('button', { onclick: () => { if (pathInput.value.trim()) addAndScan(ctx, pathInput.value.trim()); } }, 'Добавить путь'),
    folders.length ? el('button', { onclick: async () => {
      if (await api.startScan()) toast('Обход папок начат'); else toast('Обход уже идёт');
    } }, icon('rescan'), 'Обойти заново') : null);
  fsec.append(row);
  const fresh = suggested.filter((s) => !folders.some((f) => s.toLowerCase().startsWith(f.toLowerCase())));
  if (fresh.length) {
    fsec.append(el('div.row', {}, el('span.dim', { text: 'Предложить:' }),
      fresh.map((s) => el('button', { onclick: () => addAndScan(ctx, s) }, icon('plus'), s.split(/[\\/]/).pop()))));
  }

  // ── итог ──
  const ssec = el('section', {}, el('h2', { text: 'Библиотека' }), el('div.stat-grid', {},
    el('div', {}, el('b', { text: String(stats.audio) }), 'музыкальных записей'),
    el('div', {}, el('b', { text: String(stats.video) }), 'видео'),
    el('div', {}, el('b', { text: String(stats.albums) }), 'альбомов'),
    el('div', {}, el('b', { text: String(stats.artists) }), 'исполнителей'),
    el('div', {}, el('b', { text: fmtLong(stats.duration) }), 'всего звучания'),
    el('div', {}, el('b', { text: fmtSize(stats.size) }), 'на диске')));


  // ── клавиши ──
  const keys = [
    ['Пробел', 'играть / пауза'], ['← →', 'перемотка на 5 с (с Shift — на 30 с)'], ['Ctrl + ← →', 'предыдущая / следующая'],
    ['↑ ↓', 'громкость (в списке — выбор строки)'], ['F', 'видео во весь экран'], ['M', 'звук вкл/выкл'],
    ['Ctrl + F', 'поиск'], ['Q', 'очередь'], ['Esc', 'выйти из полного экрана'],
  ];
  const ksec = ctx.desktop ? el('section', {}, el('h2', { text: 'Клавиши' }),
    el('div.keys', {}, keys.flatMap(([k, v]) => [el('kbd', { text: k }), el('span', { text: v })]))) : null;

  const ver = el('section', {}, el('h2', { text: 'Wavelet 1.0.0' }),
    el('div.dim', { text: 'Музыка: MP3, FLAC, OGG, Opus, M4A, AAC, WAV. Видео: MP4 (H.264), M4V, MOV, WebM. Субтитры .srt и .vtt рядом с видео.' }));

  return el('div', { style: { display: 'contents' } },
    head({ title: 'Настройки' }),
    el('div.settings', {}, fsec, ssec, ksec, ver));
}
