// Окно «Добавить записи»: поиск по всей библиотеке, галочки, кнопка «Добавить (N)».
// Отмеченное сохраняется между поисками — можно набрать записи из разных запросов.

import { api } from './api.js';
import { modal } from './menu.js';
import { debounce, el, fmtTime, icon, setArt, subline } from './util.js';

/** Возвращает id выбранных записей (в порядке выбора) или null. */
export async function pickTracks(title) {
  const chosen = new Map(); // id → запись
  const input = el('input', { type: 'search', placeholder: 'Название, исполнитель, альбом, жанр, метка…' });
  const list = el('div.pick-tracks');
  const count = el('span.dim');
  let addBtn = null;

  const updateCount = () => {
    count.textContent = chosen.size ? `Отмечено: ${chosen.size}` : 'Ничего не отмечено';
    if (addBtn) addBtn.textContent = chosen.size ? `Добавить (${chosen.size})` : 'Добавить';
  };

  const row = (m) => {
    const box = el('input', { type: 'checkbox' });
    box.checked = chosen.has(m.id);
    const art = el('div.pt-art');
    setArt(art, m.cover, m.kind === 'video' ? 'video' : 'music');
    const r = el('div.pt-row', { onclick: (e) => {
      if (e.target === box) return;
      box.checked = !box.checked;
      box.dispatchEvent(new Event('change'));
    } }, box, art,
      el('div.pt-text', {}, el('div.pt-title', { text: m.title }), el('div.pt-sub', { text: subline(m) })),
      el('span.pt-dur', { text: m.duration ? fmtTime(m.duration) : '' }));
    box.addEventListener('change', () => {
      if (box.checked) chosen.set(m.id, m); else chosen.delete(m.id);
      r.classList.toggle('on', box.checked);
      updateCount();
    });
    r.classList.toggle('on', box.checked);
    return r;
  };

  const load = async () => {
    const q = input.value.trim();
    const items = await api.list({ query: q, order: q ? 'default' : 'added', desc: !q, limit: 300 });
    list.replaceChildren(...(items.length ? items.map(row) : [el('div.dim.pt-empty', { text: 'Ничего не нашлось' })]));
  };
  input.addEventListener('input', debounce(load, 200));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

  const selectAll = el('button', { type: 'button', onclick: () => {
    for (const r of list.querySelectorAll('.pt-row input')) if (!r.checked) { r.checked = true; r.dispatchEvent(new Event('change')); }
  } }, icon('plus'), 'Отметить все найденные');

  const body = el('div', {}, el('div.pt-search', {}, icon('search'), input), list, el('div.pt-foot', {}, count, selectAll));
  updateCount();
  load();
  const done = modal(title, body, [
    { text: 'Отмена', result: null },
    { text: 'Добавить', accent: true, value: () => (chosen.size ? [...chosen.keys()] : undefined) },
  ]);
  // кнопка «Добавить» уже в окне — подписать её числом отмеченного
  setTimeout(() => { addBtn = document.querySelector('#modal-host .modal:last-child .buttons .tl-accent'); updateCount(); });
  return done;
}
