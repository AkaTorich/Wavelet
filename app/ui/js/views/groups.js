// Сводки: исполнители, жанры, папки, метки — список с числом записей, по щелчку — их записи.

import { api } from '../api.js';
import { el, fmtLong, icon, plural } from '../util.js';
import { VirtualList } from '../vlist.js';
import { emptyNode, head } from './common.js';

const KINDS = {
  artists: { title: 'Artists', icon: 'artist', target: 'artist', words: ['artist', 'artists'] },
  genres: { title: 'Genres', icon: 'genre', target: 'genre', words: ['genre', 'genres'] },
  dirs: { title: 'Folders', icon: 'folder', target: 'folder', words: ['folder', 'folders'] },
  tags: { title: 'Labels', icon: 'tag', target: 'tag', words: ['label', 'labels'] },
};

export async function groups(ctx, { by }) {
  const k = KINDS[by];
  ctx.setSort([['name', 'By name'], ['count', 'By track count']]);
  let items = await api.groups(by);
  if (!items.length) {
    if (by === 'tags') return emptyNode('tag', 'No labels yet', 'Set labels from a track’s menu (right click) → “Labels and rating”.');
    return ctx.noLibrary() || emptyNode(k.icon, 'Empty', '');
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
