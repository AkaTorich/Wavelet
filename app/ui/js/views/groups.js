// Сводки: исполнители, жанры, папки, метки — список с числом записей, по щелчку — их записи.

import { api } from '../api.js';
import { el, fmtLong, icon, plural } from '../util.js';
import { VirtualList } from '../vlist.js';
import { emptyNode, head } from './common.js';

const KINDS = {
  artists: { title: 'Исполнители', icon: 'artist', target: 'artist', words: ['исполнитель', 'исполнителя', 'исполнителей'] },
  genres: { title: 'Жанры', icon: 'genre', target: 'genre', words: ['жанр', 'жанра', 'жанров'] },
  dirs: { title: 'Папки', icon: 'folder', target: 'folder', words: ['папка', 'папки', 'папок'] },
  tags: { title: 'Метки', icon: 'tag', target: 'tag', words: ['метка', 'метки', 'меток'] },
};

export async function groups(ctx, { by }) {
  const k = KINDS[by];
  ctx.setSort([['name', 'По имени'], ['count', 'По числу записей']]);
  let items = await api.groups(by);
  if (!items.length) {
    if (by === 'tags') return emptyNode('tag', 'Меток пока нет', 'Метки ставятся через меню записи (правая кнопка) → «Метки и оценка».');
    return ctx.noLibrary() || emptyNode(k.icon, 'Пусто', '');
  }
  if (ctx.order === 'count') items = items.slice().sort((a, b) => b.count - a.count);
  const open = (g) => (by === 'dirs' ? ctx.go('folder', { dir: g.name }) : ctx.go(k.target, { name: g.name }));
  const list = new VirtualList({
    render: (g) => el('div.group', {},
      el('div.gi', {}, icon(k.icon)),
      el('div.gn', { text: by === 'dirs' ? g.name : g.name, title: g.name }),
      el('div.gc', { text: `${g.count} · ${fmtLong(g.duration)}` })),
    onOpen: (i) => open(items[i]),
  });
  list.root.addEventListener('click', (e) => {
    if (window.matchMedia('(max-width: 720px)').matches) return; // на телефоне откроет onOpen
    const row = e.target.closest('.vrow');
    if (!row) return;
    const i = Math.round(parseFloat(row.style.top) / list.rh);
    if (items[i]) open(items[i]);
  });
  list.setItems(items);
  return el('div', { style: { display: 'contents' } },
    head({ title: k.title, sub: plural(items.length, ...k.words) }),
    list.root);
}
