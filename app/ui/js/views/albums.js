// Альбомы: сетка обложек и страница альбома.

import { api } from '../api.js';
import { el, fmtLong, icon, plural, setArt } from '../util.js';
import { emptyNode, head, playButtons, trackTable } from './common.js';

export async function albums(ctx) {
  ctx.setSort([['artist', 'By artist'], ['album', 'By title'], ['year', 'By year'], ['count', 'By track count']]);
  let list = await api.albums();
  if (!list.length) return ctx.noLibrary() || emptyNode('album', 'No albums', 'Albums are built from the tags of music files.');
  const by = ctx.order || 'artist';
  const cmp = {
    album: (a, b) => a.album.localeCompare(b.album, 'ru'),
    year: (a, b) => (b.year || 0) - (a.year || 0),
    count: (a, b) => b.count - a.count,
  }[by];
  if (cmp) list = list.slice().sort(cmp);

  const grid = el('div.cards');
  for (const a of list) {
    const pic = el('div.pic');
    setArt(pic, a.cover, 'album');
    const play = el('button.icon-btn.play.over', { title: 'Play', onclick: async (e) => {
      e.stopPropagation();
      const items = await api.list({ album: a.album, album_artist: a.artist });
      ctx.player.playList(items, 0);
    } }, icon('play'));
    pic.append(play);
    grid.append(el('div.card', { onclick: () => ctx.go('album', { album: a.album, artist: a.artist }) },
      pic, el('div.name', { text: a.album, title: a.album }),
      el('div.meta', { text: [a.artist, a.year].filter(Boolean).join(' · ') })));
  }
  return el('div', { style: { display: 'contents' } },
    head({ title: 'Albums', sub: plural(list.length, 'album', 'albums') }),
    el('div.grid-wrap', {}, grid));
}

export async function album(ctx, { album: name, artist }) {
  ctx.setSort(null);
  const items = await api.list({ album: name, album_artist: artist });
  if (!items.length) return emptyNode('album', 'Album is empty', '');
  const years = [...new Set(items.map((m) => m.year).filter(Boolean))];
  const total = items.reduce((s, m) => s + m.duration, 0);
  const sub = [artist, years.join('–'), plural(items.length, 'track', 'tracks'), fmtLong(total)].filter(Boolean).join(' · ');
  const artistBtn = artist ? el('button', { onclick: () => ctx.go('artist', { name: artist }) }, icon('artist'), artist) : null;
  return el('div', { style: { display: 'contents' } },
    head({ title: name, sub, art: items.find((m) => m.cover)?.cover, artIcon: 'album', actions: [...playButtons(ctx, items), artistBtn] }),
    trackTable(ctx, items, { numbering: 'track' }));
}
