// Видео: сетка кадров с длительностью и полоской «досмотрено до».

import { api } from '../api.js';
import { showMenu } from '../menu.js';
import { want } from '../thumbs.js';
import { el, fmtTime, icon, setArt } from '../util.js';
import { countLine, emptyNode, head, trackMenu } from './common.js';

export async function video(ctx) {
  ctx.setSort([['path', 'По папкам'], ['title', 'По названию'], ['added', 'Новые сверху'], ['duration', 'По длительности'], ['played', 'Недавно смотренные']]);
  const order = ctx.order || 'path';
  const items = await api.list({ kind: 'video', order, desc: order === 'added' || order === 'played' });
  if (!items.length) {
    return ctx.noLibrary() || emptyNode('video', 'Видео нет', 'Видео MP4, M4V, MOV и WebM из папок библиотеки появятся здесь.');
  }
  ctx.track(items, null);
  const grid = el('div.cards.video');
  items.forEach((m, i) => {
    const pic = el('div.pic');
    setArt(pic, m.cover, 'video');
    if (!m.cover) want(m, pic);
    if (m.duration) pic.append(el('span.badge', { text: fmtTime(m.duration) }));
    if (m.position > 5 && m.duration) pic.append(el('div.bar', { style: { width: `${Math.min(100, (m.position / m.duration) * 100)}%` } }));
    pic.append(el('button.icon-btn.play.over', { title: 'Смотреть' }, icon('play')));
    const playing = ctx.player.current?.id === m.id;
    const card = el('div.card' + (playing ? '.playing' : ''), {
      'data-id': m.id,
      onclick: () => ctx.player.playList(items, i),
      oncontextmenu: (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, trackMenu(ctx, [m])); },
    }, pic, el('div.name', { text: m.title, title: m.path }), el('div.meta', { text: m.dir.split(/[\\/]/).pop() }));
    grid.append(card);
  });
  return el('div', { style: { display: 'contents' } },
    head({ title: 'Видео', sub: countLine(items) }),
    el('div.grid-wrap', {}, grid));
}
