// Списки записей: вся музыка, поиск, исполнитель, жанр, папка, метка, недавние, частые, история.

import { api } from '../api.js';
import { el, icon } from '../util.js';
import { countLine, DESC_ORDERS, emptyNode, head, playButtons, TRACK_ORDERS, trackTable } from './common.js';

function req(ctx, extra) {
  const order = ctx.order || 'default';
  return { order, desc: DESC_ORDERS.has(order), ...extra };
}

async function trackView(ctx, { title, sub, artIcon, art, request, empty, numbering, sort = true }) {
  if (sort) ctx.setSort(TRACK_ORDERS);
  const items = await api.list(request);
  if (!items.length) return empty || emptyNode('music', 'Пусто', 'Здесь пока нет записей.');
  const first = items.find((m) => m.cover);
  return el('div', { style: { display: 'contents' } },
    head({ title, sub: sub ?? countLine(items), artIcon, art: art === undefined ? first?.cover : art, actions: playButtons(ctx, items) }),
    trackTable(ctx, items, { numbering }));
}

export function music(ctx) {
  return trackView(ctx, {
    title: 'Музыка', artIcon: 'music', art: null, request: req(ctx, { kind: 'audio' }),
    empty: ctx.noLibrary() || emptyNode('music', 'Музыки пока нет', 'Добавьте папки в настройках — программа сама найдёт записи.',
      el('button.tl-accent', { onclick: () => ctx.go('settings') }, icon('folder'), 'Папки библиотеки')),
  });
}

export function search(ctx, { q }) {
  return trackView(ctx, {
    title: `Поиск: ${q}`, artIcon: 'search', art: null, request: req(ctx, { query: q }),
    empty: emptyNode('search', 'Ничего не нашлось', 'Можно уточнять: исполнитель:имя, альбом:…, жанр:…, год:1990-1999, метка:…, вид:видео, папка:…'),
  });
}

export function artist(ctx, { name }) {
  return trackView(ctx, { title: name, artIcon: 'artist', request: req(ctx, { artist: name }) });
}

export function genre(ctx, { name }) {
  return trackView(ctx, { title: name, artIcon: 'genre', request: req(ctx, { genre: name }) });
}

export function folder(ctx, { dir }) {
  return trackView(ctx, { title: dir.split(/[\\/]/).pop() || dir, artIcon: 'folder', request: req(ctx, { dir, order: ctx.order || 'path' }) });
}

export function tag(ctx, { name }) {
  return trackView(ctx, { title: name, artIcon: 'tag', art: null, request: req(ctx, { tag: name }) });
}

export function recent(ctx) {
  return trackView(ctx, {
    title: 'Недавно добавленные', artIcon: 'recent', art: null, sort: false,
    request: { order: 'added', desc: true, limit: 500 },
  });
}

export function frequent(ctx) {
  return trackView(ctx, {
    title: 'Часто играемые', artIcon: 'frequent', art: null, sort: false,
    request: { order: 'plays', desc: true, limit: 300 },
    empty: emptyNode('frequent', 'Пока пусто', 'Сюда попадают записи, прослушанные хотя бы наполовину.'),
  });
}

export function history(ctx) {
  return trackView(ctx, {
    title: 'Недавно игравшие', artIcon: 'recent', art: null, sort: false,
    request: { order: 'played', desc: true, limit: 300 },
    empty: emptyNode('recent', 'Пока пусто', 'Здесь будет то, что вы слушали и смотрели.'),
  });
}
