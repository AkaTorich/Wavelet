// Общее для видов: шапка, кнопки «Играть / Перемешать», таблица записей и её меню.

import { api } from '../api.js';
import { editTags, editUserTags, pickPlaylist, prompt, showMenu } from '../menu.js';
import { el, fmtLong, fmtTime, icon, plural, setArt, stars, subline, toast } from '../util.js';
import { VirtualList } from '../vlist.js';

export const TRACK_ORDERS = [
  ['default', 'По порядку'],
  ['title', 'По названию'],
  ['artist', 'По исполнителю'],
  ['album', 'По альбому'],
  ['year', 'По году'],
  ['added', 'Новые сверху'],
  ['duration', 'По длительности'],
  ['rating', 'По оценке'],
  ['plays', 'По прослушиваниям'],
];

/** Порядки, где большее — выше. */
export const DESC_ORDERS = new Set(['added', 'rating', 'plays', 'played']);

export function countLine(items) {
  const audio = items.filter((m) => m.kind === 'audio').length;
  const video = items.length - audio;
  const parts = [];
  if (audio) parts.push(plural(audio, 'запись', 'записи', 'записей'));
  if (video) parts.push(plural(video, 'видео', 'видео', 'видео'));
  const total = items.reduce((s, m) => s + (m.duration || 0), 0);
  if (total) parts.push(fmtLong(total));
  return parts.join(' · ') || 'пусто';
}

export function head({ title, sub, art, artIcon, actions = [] }) {
  const artNode = artIcon || art ? el('div.art') : null;
  if (artNode) setArt(artNode, art, artIcon || 'music');
  return el('div.view-head', {}, artNode,
    el('div.info', {}, el('h1', { text: title, title }), sub ? el('div.sub', { text: sub }) : null,
      actions.length ? el('div.actions', {}, actions) : null));
}

export function playButtons(ctx, items) {
  if (!items.length) return [];
  return [
    el('button.tl-accent', { onclick: () => ctx.player.playList(items, 0) }, icon('play'), 'Играть'),
    el('button', { onclick: () => ctx.player.playShuffled(items) }, icon('shuffle'), 'Перемешать'),
  ];
}

export function emptyNode(iconName, title, text, ...buttons) {
  return el('div.empty', {}, icon(iconName), el('h2', { text: title }), text ? el('div', { text }) : null,
    buttons.length ? el('div.row', {}, buttons) : null);
}

function trackRow(ctx, m, i, numbering, opts) {
  const playing = ctx.player.current?.id === m.id;
  const num = numbering === 'track' ? (m.track || '') : i + 1;
  const thumb = el('div.thumb');
  setArt(thumb, m.cover, m.kind === 'video' ? 'video' : 'music');
  const dots = m.tags.length ? el('span.tagdots', { title: m.tags.join(', ') }, m.tags.slice(0, 3).map(() => el('i'))) : null;
  return el('div.track' + (playing ? '.playing' : ''), {},
    el('span.num', {}, el('span', { text: String(num) })),
    thumb,
    el('span.ttl', {}, m.kind === 'video' ? icon('video', 'ic kind') : null, el('span', { text: m.title, title: m.path }), dots),
    el('span.art-col', { text: m.artist || m.album_artist, title: m.artist }),
    el('span.alb', { text: m.album, title: m.album }),
    el('span.yr', { text: m.year ? String(m.year) : '' }),
    el('span.dur', { text: m.duration ? fmtTime(m.duration) : '' }),
    stars(m.rating, async (r) => { await api.setRating(m.id, r); ctx.updated({ ...m, rating: r }); }),
    el('div.lines', {}, el('div.l1', { text: m.title }), el('div.l2', { text: subline(m) })),
    el('button.icon-btn.row-more', { title: 'Ещё: в список, в очередь, метки…', onclick: (e) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      showMenu(r.left - 180, r.bottom, trackMenu(ctx, [m], opts));
    }, ondblclick: (e) => e.stopPropagation() }, icon('more')));
}

/**
 * Таблица записей. opts.numbering: 'index' | 'track'; opts.playlist: id списка (строки — PlaylistEntry);
 * opts.onReorder(fromIdx, toIdx) — перестановка; opts.reload — перерисовать вид после изменений.
 */
export function trackTable(ctx, items, opts = {}) {
  const list = new VirtualList({
    render: (m, i) => trackRow(ctx, m, i, opts.numbering || 'index', opts),
    onOpen: (i) => ctx.player.playList(items, i),
    onMenu: (e, sel) => showMenu(e.clientX, e.clientY, trackMenu(ctx, sel, opts)),
    onReorder: opts.onReorder,
    idOf: (m) => m.id,
  });
  list.setItems(items);
  ctx.track(items, list);
  const thead = el('div.thead', {}, el('span', { text: '#' }), el('span', { text: 'Название' }), el('span', { text: 'Исполнитель' }),
    el('span', { text: 'Альбом' }), el('span', { text: 'Год' }), el('span', { text: 'Время' }), el('span', { text: 'Оценка' }), el('span'));
  return el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } }, thead, list.root);
}

export function trackMenu(ctx, sel, opts = {}) {
  if (!sel.length) return [];
  const one = sel.length === 1 ? sel[0] : null;
  const items = [
    { icon: 'play', text: sel.length > 1 ? `Играть (${sel.length})` : 'Играть', run: () => ctx.player.playList(sel, 0) },
    { icon: 'next', text: 'Играть следующим', run: () => { ctx.player.playNext(sel); toast('Сыграет следующим'); } },
    { icon: 'queue', text: 'Добавить в очередь', run: () => { ctx.player.enqueue(sel); toast(`В очереди: ${plural(sel.length, 'запись', 'записи', 'записей')}`); } },
    {
      icon: 'list', text: 'Добавить в список…', run: async () => {
        const id = await pickPlaylist();
        if (id == null) return;
        await api.playlistAdd(id, sel.map((m) => m.id));
        toast('Добавлено в список');
        ctx.refreshNav();
      },
    },
    'sep',
  ];
  if (one) {
    items.push({
      icon: 'tag', text: 'Метки и оценка…', run: async () => {
        const saved = await editUserTags(one, await ctx.tagNames());
        if (saved) ctx.updated(saved);
      },
    });
    items.push({
      icon: 'settings', text: 'Теги файла…', run: async () => {
        const saved = await editTags(one);
        if (saved) ctx.updated(saved);
      },
    });
  } else {
    items.push({
      icon: 'tag', text: 'Метка для всех…', run: async () => {
        const name = await prompt('Метка для выбранных', '', 'Метка');
        if (!name) return;
        await api.addTag(sel.map((m) => m.id), name);
        toast(`Метка «${name}» добавлена`);
        opts.reload ? opts.reload() : ctx.reload();
      },
    });
  }
  if (one) {
    items.push('sep');
    if (one.kind === 'audio' && one.album) {
      items.push({ icon: 'album', text: `Альбом «${one.album}»`, run: () => ctx.go('album', { album: one.album, artist: one.album_artist || one.artist }) });
    }
    if (one.artist) items.push({ icon: 'artist', text: one.artist, run: () => ctx.go('artist', { name: one.artist }) });
    items.push({ icon: 'folder', text: 'Эта папка', run: () => ctx.go('folder', { dir: one.dir }) });
    if (ctx.desktop) items.push({ icon: 'folder', text: 'Показать в проводнике', run: () => api.reveal(one.path) });
  }
  if (opts.playlist != null) {
    items.push('sep');
    items.push({
      icon: 'close', text: 'Убрать из списка', danger: true, run: async () => {
        await api.playlistRemove(sel.map((m) => m.item_id));
        ctx.refreshNav();
        opts.reload ? opts.reload() : ctx.reload();
      },
    });
  }
  return items;
}
