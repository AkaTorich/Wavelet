// Всплывающее меню и окна-диалоги: ввод имени, подтверждение, теги файла, свои метки, выбор списка.

import { api } from './api.js';
import { $, el, icon, stars, toast } from './util.js';

// ── меню ──

let menuClose = null;

/** items: [{icon, text, run, danger}] | 'sep' | {node} */
export function showMenu(x, y, items) {
  hideMenu();
  const box = $('#menu');
  box.replaceChildren();
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { box.append(el('hr')); continue; }
    if (it.node) { box.append(it.node); continue; }
    const b = el('button.mi' + (it.danger ? '.danger' : ''), { onclick: () => { hideMenu(); it.run(); } },
      it.icon ? icon(it.icon) : null, it.text);
    box.append(b);
  }
  box.hidden = false;
  const r = box.getBoundingClientRect();
  box.style.left = `${Math.max(6, Math.min(x, innerWidth - r.width - 6))}px`;
  box.style.top = `${Math.max(6, Math.min(y, innerHeight - r.height - 6))}px`;
  const close = (e) => { if (!box.contains(e.target)) hideMenu(); };
  const esc = (e) => { if (e.key === 'Escape') hideMenu(); };
  setTimeout(() => {
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('blur', hideMenu);
  });
  menuClose = () => {
    document.removeEventListener('pointerdown', close, true);
    document.removeEventListener('keydown', esc, true);
    window.removeEventListener('blur', hideMenu);
  };
}

export function hideMenu() {
  $('#menu').hidden = true;
  menuClose?.();
  menuClose = null;
}

/** Меню у кнопки «…». */
export function menuAt(btn, items) {
  const r = btn.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, items);
}

// ── окна ──

export function modal(title, body, buttons) {
  return new Promise((resolve) => {
    const host = $('#modal-host');
    const close = (v) => { back.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const row = el('div.buttons');
    for (const b of buttons) {
      row.append(el('button' + (b.accent ? '.tl-accent' : '') + (b.danger ? '.tl-danger' : ''),
        { type: 'button', onclick: async () => { const v = b.value ? await b.value() : b.result; if (v !== undefined) close(v); } }, b.text));
    }
    const box = el('form.modal', { onsubmit: (e) => { e.preventDefault(); row.querySelector('.tl-accent')?.click(); } },
      el('h2', { text: title }), body, row);
    const back = el('div.backdrop', { onpointerdown: (e) => { if (e.target === back) close(null); } }, box);
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', key, true);
    host.append(back);
    setTimeout(() => box.querySelector('input')?.focus());
  });
}

export async function ask(title, text, okText = 'Yes', danger = false) {
  return modal(title, el('p', { text }), [
    { text: 'Cancel', result: false },
    { text: okText, result: true, accent: !danger, danger },
  ]);
}

export async function prompt(title, value = '', label = 'Title') {
  const input = el('input', { type: 'text', value });
  return modal(title, el('label', {}, label, input), [
    { text: 'Cancel', result: null },
    { text: 'Done', accent: true, value: () => input.value.trim() || undefined },
  ]);
}

/** Теги в самом файле (только музыка) — название, исполнитель, альбом… */
export async function editTags(m) {
  const f = (name, label, value, cls = '') => {
    const input = el('input', { type: 'text', name, value: value ?? '' });
    return [el('label' + cls, {}, label, input), input];
  };
  const fields = {
    title: f('title', 'Title', m.title, '.wide'),
    artist: f('artist', 'Artist', m.artist),
    album_artist: f('album_artist', 'Album artist', m.album_artist),
    album: f('album', 'Album', m.album, '.wide'),
    genre: f('genre', 'Genre', m.genre),
    year: f('year', 'Year', m.year),
    track: f('track', 'Track number', m.track),
    disc: f('disc', 'Disc', m.disc),
  };
  const body = el('div', {},
    el('div.grid', {}, Object.values(fields).map(([label]) => label)),
    el('div.note', { text: m.kind === 'audio' ? 'Written to the file itself and to the library.' : 'Video tags are kept in the library only.' }),
    el('div.note', { text: m.path }));
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
  const edit = await modal('Tags', body, [
    { text: 'Cancel', result: null },
    {
      text: 'Save', accent: true, value: () => {
        const v = (k) => fields[k][1].value;
        return {
          title: v('title'), artist: v('artist'), album_artist: v('album_artist'), album: v('album'), genre: v('genre'),
          year: num(v('year')), track: num(v('track')), disc: num(v('disc')),
        };
      },
    },
  ]);
  if (!edit) return null;
  try {
    const saved = await api.editTags(m.id, edit);
    toast('Tags saved');
    return saved;
  } catch (e) {
    toast(`Could not write: ${e}`, 5000);
    return null;
  }
}

/** Свои метки и оценка записи. */
export async function editUserTags(m, known = []) {
  let tags = [...m.tags];
  let rating = m.rating;
  const chips = el('div.chips');
  const input = el('input', { type: 'text', list: 'tag-names', placeholder: 'New label, then Enter' });
  const list = el('datalist#tag-names', {}, known.map((t) => el('option', { value: t })));
  const starBox = el('div');
  const draw = () => {
    chips.replaceChildren(...tags.map((t) => el('span.chip', {}, t,
      el('button.icon-btn', { type: 'button', title: 'Remove', onclick: () => { tags = tags.filter((x) => x !== t); draw(); } }, icon('close')))));
    starBox.replaceChildren(stars(rating, (r) => { rating = r; draw(); }));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      e.stopPropagation();
      const v = input.value.trim().replace(/,$/, '');
      if (v && !tags.some((t) => t.toLowerCase() === v.toLowerCase())) tags.push(v);
      input.value = '';
      draw();
    }
  });
  draw();
  const body = el('div', {}, el('label', {}, 'Rating', starBox), el('label', {}, 'Labels', chips), input, list,
    el('div.note', { text: 'Labels are searchable like titles: “label:name” or just the word.' }));
  const ok = await modal(m.title, body, [{ text: 'Cancel', result: false }, {
    text: 'Save', accent: true, value: () => {
      const v = input.value.trim();
      if (v && !tags.includes(v)) tags.push(v);
      return true;
    },
  }]);
  if (!ok) return null;
  if (rating !== m.rating) await api.setRating(m.id, rating);
  const saved = await api.setUserTags(m.id, tags);
  return saved;
}

/** Выбор списка воспроизведения (или новый). Возвращает id или null. */
export async function pickPlaylist() {
  const lists = await api.playlists();
  let chosen = null;
  const pick = el('div.pick');
  const nameInput = el('input', { type: 'text', placeholder: 'or a new playlist — name' });
  for (const p of lists) {
    const row = el('button.nav-item', { type: 'button', onclick: () => {
      chosen = p.id;
      pick.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('selected'));
      row.classList.add('selected');
    } }, icon('list'), el('span', { text: p.name }), el('small', { text: String(p.count) }));
    pick.append(row);
  }
  const body = el('div', {}, lists.length ? pick : el('p.dim', { text: 'No playlists yet.' }), nameInput);
  return modal('To playlist', body, [{ text: 'Cancel', result: null }, {
    text: 'Add', accent: true, value: async () => {
      const name = nameInput.value.trim();
      if (name) return api.playlistCreate(name);
      return chosen ?? undefined;
    },
  }]);
}
