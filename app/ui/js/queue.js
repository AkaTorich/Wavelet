// Панель очереди: что играет, что дальше; перестановка перетаскиванием, удаление, сохранение в список.

import { api } from './api.js';
import { prompt, showMenu } from './menu.js';
import { $, el, fmtLong, icon, plural, setArt, subline, toast } from './util.js';
import { VirtualList } from './vlist.js';

export function bindQueue(player, ctx) {
  const panel = $('#queue');
  const list = new VirtualList({
    render: (m, i) => {
      const c = el('div.qc');
      setArt(c, m.cover, m.kind === 'video' ? 'video' : 'music');
      const cls = i === player.index ? '.current' : i < player.index ? '.past' : '';
      return el('div.qitem' + cls, {}, c,
        el('div.qx', {}, el('div.qt', { text: m.title }), el('div.qs', { text: subline(m) })),
        el('button.icon-btn', { title: 'Убрать', onclick: (e) => { e.stopPropagation(); player.remove(i); } }, icon('close')));
    },
    onOpen: (i) => player.jump(i),
    onReorder: (from, to) => player.move(from, to),
    onMenu: (e, sel, i) => showMenu(e.clientX, e.clientY, [
      { icon: 'play', text: 'Играть отсюда', run: () => player.jump(i) },
      { icon: 'close', text: sel.length > 1 ? `Убрать (${sel.length})` : 'Убрать из очереди', run: () => {
        const idx = sel.map((m) => player.queue.indexOf(m)).sort((a, b) => b - a);
        for (const k of idx) player.remove(k);
      } },
    ]),
    idOf: (m) => m.id,
  });
  list.root.style.setProperty('--row-h', '52px');
  $('#queue-list').append(list.root);

  const draw = (keepScroll = true) => {
    list.setItems(player.queue, keepScroll);
    const left = player.queue.slice(Math.max(0, player.index)).reduce((s, m) => s + (m.duration || 0), 0);
    $('#queue-info').textContent = player.queue.length ? `${plural(player.queue.length, 'запись', 'записи', 'записей')} · ${fmtLong(left)}` : 'пусто';
  };
  player.addEventListener('queue', () => draw());
  player.addEventListener('track', () => { list.refresh(); if (!panel.hidden && player.index >= 0) list.scrollTo(player.index); });

  $('#queue-clear').addEventListener('click', () => player.clear());
  $('#queue-save').addEventListener('click', async () => {
    if (!player.queue.length) return;
    const name = await prompt('Сохранить очередь как список', 'Очередь ' + new Date().toLocaleDateString('ru-RU'));
    if (!name) return;
    const id = await api.playlistCreate(name);
    await api.playlistAdd(id, player.queue.map((m) => m.id));
    toast(`Список «${name}» сохранён`);
    ctx.refreshNav();
  });

  return {
    toggle(on) {
      panel.hidden = on === undefined ? !panel.hidden : !on;
      $('#btn-queue').classList.toggle('on', !panel.hidden);
      if (!panel.hidden) { draw(); if (player.index >= 0) list.scrollTo(player.index); }
    },
    get open() { return !panel.hidden; },
  };
}
