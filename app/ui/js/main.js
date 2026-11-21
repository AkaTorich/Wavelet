// Wavelet — запуск окна: переходы между видами, боковая панель и вкладки, поиск, порядок,
// клавиши, события обхода папок. Каждый вид — функция в views/*.js, которая возвращает узел.

import { api, listen } from './api.js';
import { hideMenu, pickPlaylist, showMenu } from './menu.js';
import { Player } from './player.js';
import { bindPlayerUI } from './playerui.js';
import { bindQueue } from './queue.js';
import { bindTitlebar } from './titlebar.js';
import { $, debounce, el, icon, isPhone, plural, toast } from './util.js';
import { DRAG_TYPE } from './vlist.js';
import * as lib from './views/library.js';
import { album, albums } from './views/albums.js';
import { groups } from './views/groups.js';
import { video } from './views/video.js';
import { addTracksTo, createPlaylist, deletePlaylist, playlist, playlists, playPlaylist, renamePlaylist } from './views/playlists.js';
import { settings } from './views/settings.js';
import { emptyNode } from './views/common.js';

const VIEWS = {
  music: lib.music, search: lib.search, artist: lib.artist, genre: lib.genre, folder: lib.folder, tag: lib.tag,
  recent: lib.recent, frequent: lib.frequent, history: lib.history,
  albums, album, video, playlists, playlist, settings,
  artists: (c) => groups(c, { by: 'artists' }), genres: (c) => groups(c, { by: 'genres' }),
  folders: (c) => groups(c, { by: 'dirs' }), tags: (c) => groups(c, { by: 'tags' }),
};

/** Где подсвечивать вид в боковой панели. */
const PARENT = { album: 'albums', artist: 'artists', genre: 'genres', folder: 'folders', tag: 'tags' };

const NAV = [
  ['music', 'music', 'Music'], ['albums', 'album', 'Albums'], ['artists', 'artist', 'Artists'],
  ['genres', 'genre', 'Genres'], ['video', 'video', 'Video'], ['folders', 'folder', 'Folders'], ['tags', 'tag', 'Labels'],
  ['recent', 'recent', 'Recent'], ['frequent', 'frequent', 'Most played'], ['history', 'recent', 'History'],
  ['settings', 'settings', 'Settings'],
];

const media = $('#media');
const player = new Player(media);
const stack = []; // история переходов: {view, params}
const sortByView = {};
let current = { view: null, params: {} };
let renderToken = 0;
let curItems = [];
let curList = null;
let folders = [];
let lastView = null; // куда вернуться, когда поиск очищен

const ctx = {
  player,
  desktop: true,
  order: null,

  go(view, params = {}, push = true) {
    if (push && current.view) {
      stack.push(current);
      history.pushState(null, '');
    }
    if (view !== 'search') lastView = { view, params };
    current = { view, params };
    if (view !== 'search' && $('#search').value) $('#search').value = '';
    render();
  },

  back() {
    const prev = stack.pop();
    if (!prev) return false;
    current = prev;
    if (prev.view !== 'search') $('#search').value = '';
    render();
    return true;
  },

  reload() { render(true); },

  setSort(options) {
    const sel = $('#sort');
    sel.hidden = !options;
    if (!options) return;
    sel.replaceChildren(...options.map(([v, t]) => el('option', { value: v, text: t })));
    sel.value = ctx.order && options.some(([v]) => v === ctx.order) ? ctx.order : options[0][0];
  },

  track(items, list) { curItems = items; curList = list; },

  isOpen(view, id) { return current.view === view && current.params.id === id; },

  updated(m) {
    curItems.forEach((x, k) => { if (x.id === m.id) curItems[k] = { ...x, ...m }; });
    player.update(m);
    curList?.refresh();
  },

  async tagNames() { return (await api.groups('tags')).map((g) => g.name); },

  noLibrary() {
    if (folders.length) return null;
    return emptyNode('wave', 'Welcome to Wavelet',
      'Choose folders with music and video — Wavelet will scan them, read tags and covers and build a searchable library.',
      el('button.tl-accent', { onclick: () => ctx.go('settings') }, icon('folder'), 'Choose folders'));
  },

  async refreshNav() {
    const box = $('#nav-playlists');
    const lists = await api.playlists().catch(() => []);
    box.replaceChildren(...lists.map((p) => {
      const b = el('button.nav-item', { 'data-view': `playlist:${p.id}`, onclick: () => ctx.go('playlist', { id: p.id }) },
        icon('list'), el('span', { text: p.name }), el('small', { text: String(p.count) }));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { icon: 'play', text: 'Play', run: () => playPlaylist(ctx, p) },
          { icon: 'shuffle', text: 'Shuffle', run: () => playPlaylist(ctx, p, true) },
          { icon: 'plus', text: 'Add tracks…', run: () => addTracksTo(ctx, p) },
          'sep',
          { icon: 'settings', text: 'Rename…', run: () => renamePlaylist(ctx, p) },
          { icon: 'close', text: 'Delete playlist', danger: true, run: () => deletePlaylist(ctx, p) },
        ]);
      });
      b.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); b.classList.add('drop'); } });
      b.addEventListener('dragleave', () => b.classList.remove('drop'));
      b.addEventListener('drop', async (e) => {
        b.classList.remove('drop');
        const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]');
        if (!ids.length) return;
        e.preventDefault();
        await api.playlistAdd(p.id, ids);
        toast(`To “${p.name}”: ${plural(ids.length, 'track', 'tracks')}`);
        ctx.refreshNav();
      });
      return b;
    }));
    markNav();
  },
};

async function render(keepOrder = false) {
  const token = ++renderToken;
  const { view, params } = current;
  if (!keepOrder) ctx.order = sortByView[view] ?? null;
  hideMenu();
  $('#back').hidden = !stack.length;
  markNav();
  let node;
  try {
    curItems = [];
    curList = null;
    node = await VIEWS[view](ctx, params);
  } catch (e) {
    node = emptyNode('close', 'Error', String(e));
  }
  if (token !== renderToken) return;
  $('#view').replaceChildren(node);
  if (!keepOrder) {
    $('#stage').hidden = true;
    $('#btn-video').classList.remove('on');
  }
}

function markNav() {
  const key = current.view === 'playlist' ? `playlist:${current.params.id}` : PARENT[current.view] || current.view;
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('selected', b.dataset.view === key);
}

function buildNav() {
  $('#nav-main').replaceChildren(el('button.nav-item#nav-now', {}, icon('viz'), el('span', { text: 'Now Playing' })), ...NAV.map(([view, ic, text]) =>
    el('button.nav-item', { 'data-view': view, onclick: () => ctx.go(view) }, icon(ic), el('span', { text }))));
  const cap = $('.nav-caption');
  cap.append(el('button.icon-btn', { title: 'New playlist', onclick: () => createPlaylist(ctx) }, icon('plus')));

  const more = [['artists', 'artist', 'Artists'], ['genres', 'genre', 'Genres'], ['folders', 'folder', 'Folders'], ['tags', 'tag', 'Labels'],
    ['recent', 'recent', 'Recent'], ['frequent', 'frequent', 'Most played'], ['history', 'recent', 'History'], ['settings', 'settings', 'Settings']];
  const tab = (view, ic, text) => el('button', { 'data-view': view, onclick: () => ctx.go(view) }, icon(ic), text);
  const moreBtn = el('button', { onclick: () => {
    const r = moreBtn.getBoundingClientRect();
    showMenu(r.right, r.top - 330, more.map(([v, ic, t]) => ({ icon: ic, text: t, run: () => ctx.go(v) })));
  } }, icon('more'), 'More');
  $('#tabs').replaceChildren(tab('music', 'music', 'Music'), tab('albums', 'album', 'Albums'), tab('video', 'video', 'Video'),
    tab('playlists', 'list', 'Playlists'), moreBtn);
}

function bindTop() {
  $('#back').addEventListener('click', () => history.back());
  const search = $('#search');
  const run = debounce(() => {
    const q = search.value.trim();
    if (q) {
      if (current.view === 'search') { current.params = { q }; render(true); }
      else ctx.go('search', { q });
    } else if (current.view === 'search') {
      const to = lastView || { view: 'music', params: {} };
      ctx.go(to.view, to.params, false);
    }
  }, 250);
  search.addEventListener('input', run);
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; run(); search.blur(); } });
  $('#sort').addEventListener('change', (e) => {
    ctx.order = e.target.value;
    sortByView[current.view] = ctx.order;
    render(true);
  });
}

function bindKeys(ui, queue) {
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest('input, textarea, select');
    if (typing || $('#modal-host').childElementCount) return;
    const inList = e.target.closest('.vlist');
    const k = e.key;
    if (k === ' ') { e.preventDefault(); player.toggle(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      const dir = k === 'ArrowRight' ? 1 : -1;
      if (e.ctrlKey) dir > 0 ? player.next() : player.prev();
      else player.seekBy(dir * (e.shiftKey ? 30 : 5));
    } else if ((k === 'ArrowUp' || k === 'ArrowDown') && !inList) {
      e.preventDefault();
      player.setVolume(media.volume + (k === 'ArrowUp' ? 0.05 : -0.05));
    } else if (k === 'f' || k === 'F' || k === 'а' || k === 'А') {
      if (e.ctrlKey) { e.preventDefault(); $('#search').focus(); $('#search').select(); } else ui.toggleFull();
    } else if (k === 'm' || k === 'ь') player.toggleMute();
    else if (k === 'q' || k === 'й') queue.toggle();
    else if (k === 'v' || k === 'V' || k === 'м' || k === 'М') ui.toggleViz();
    else if (k === 'Escape') {
      if (ui.isFull()) ui.setFull(false);
      else if (!$('#sheet').hidden) $('#sheet').hidden = true;
      else if (!$('#stage').hidden) ui.showStage(false);
    } else if (k === 'Backspace' && !e.ctrlKey) history.back();
  });
  // Esc в полном экране окна Windows приходит как выход из него
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && isPhone() && ui.isFull()) ui.setFull(false); });
}

/** «Назад» системы (кнопка Android, боковая кнопка мыши): сначала закрыть всплывшее, потом прежний вид. */
function bindHistory(ui, queue) {
  history.replaceState(null, '');
  window.addEventListener('popstate', () => {
    if (ui.isFull()) { ui.setFull(false); history.pushState(null, ''); return; }
    if (!$('#sheet').hidden) { $('#sheet').hidden = true; history.pushState(null, ''); return; }
    if (isPhone() && queue.open) { queue.toggle(false); history.pushState(null, ''); return; }
    if (!$('#stage').hidden && isPhone()) { ui.showStage(false); history.pushState(null, ''); return; }
    ctx.back();
  });
}

function bindScan() {
  const box = $('#scan-status');
  listen('scan-progress', (p) => {
    box.hidden = false;
    $('#scan-text').textContent = p.total ? `Scanning: ${p.done} of ${p.total}` : 'Looking for files…';
    $('#scan-bar').value = p.total ? p.done / p.total : 0;
  });
  listen('scan-done', async (r) => {
    box.hidden = true;
    folders = await api.folders();
    const parts = [];
    if (r.added) parts.push(`${r.added} new`);
    if (r.updated) parts.push(`${r.updated} changed`);
    if (r.removed) parts.push(`${r.removed} removed`);
    if (parts.length) {
      toast(`Library: ${parts.join(', ')}`);
      if (current.view !== 'search' || !$('#search').matches(':focus')) render(true);
    }
    ctx.refreshNav();
  });
  listen('scan-error', (msg) => { box.hidden = true; toast(`Scan stopped: ${msg}`, 5000); });
}

async function main() {
  const os = await api.platform().catch(() => 'windows');
  ctx.desktop = !['android', 'ios'].includes(os);
  document.body.classList.add(ctx.desktop ? 'desktop' : 'mobile');
  if (ctx.desktop) bindTitlebar();
  buildNav();
  bindTop();
  const queue = bindQueue(player, ctx);
  const ui = bindPlayerUI(player, {
    toggleQueue: (on) => queue.toggle(on),
    addToPlaylist: async (items) => {
      const id = await pickPlaylist();
      if (id == null) return;
      await api.playlistAdd(id, items.map((m) => m.id));
      toast(`Added to playlist: ${items.length === 1 ? items[0].title : plural(items.length, 'track', 'tracks')}`);
      ctx.refreshNav();
      if (current.view === 'playlist' && current.params.id === id) ctx.reload();
    },
    openArtist: (name) => ctx.go('artist', { name }),
    onStage: (open) => {
      $('#nav-now').classList.toggle('selected', open);
      if (open) for (const b of document.querySelectorAll('[data-view].selected')) b.classList.remove('selected');
      else markNav();
    },
    openAlbum: (m) => (m.album ? ctx.go('album', { album: m.album, artist: m.album_artist || m.artist }) : ctx.go('folder', { dir: m.dir })),
    onTrack: () => {
      curList?.refresh();
      for (const c of document.querySelectorAll('.card[data-id]')) c.classList.toggle('playing', +c.dataset.id === player.current?.id);
    },
  });
  $('#nav-now').addEventListener('click', () => ui.openNow());
  bindKeys(ui, queue);
  bindHistory(ui, queue);
  bindScan();
  folders = await api.folders();
  await ctx.refreshNav();
  await player.restore();
  ctx.go(folders.length ? 'music' : 'settings', {}, false);
  if (folders.length) api.startScan().catch(() => {});
}

main();
