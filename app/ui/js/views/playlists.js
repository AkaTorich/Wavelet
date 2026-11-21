// Списки воспроизведения: обзор и страница списка (перестановка перетаскиванием, переименование, удаление).

import { api } from '../api.js';
import { ask, prompt, showMenu } from '../menu.js';
import { pickTracks } from '../picktracks.js';
import { el, fmtLong, icon, plural, toast } from '../util.js';
import { emptyNode, head, playButtons, trackTable } from './common.js';

export async function createPlaylist(ctx) {
  const name = await prompt('New playlist');
  if (!name) return;
  const id = await api.playlistCreate(name);
  await ctx.refreshNav();
  ctx.go('playlist', { id });
}

export async function playlists(ctx) {
  ctx.setSort(null);
  const lists = await api.playlists();
  const add = el('button.tl-accent', { onclick: () => createPlaylist(ctx) }, icon('plus'), 'New playlist');
  if (!lists.length) {
    return emptyNode('list', 'No playlists yet', 'Create a playlist and add tracks from the menu or by dragging them onto its name on the left.', add);
  }
  const grid = el('div.cards');
  for (const p of lists) {
    grid.append(el('div.card', { onclick: () => ctx.go('playlist', { id: p.id }), oncontextmenu: (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { icon: 'play', text: 'Play', run: () => playPlaylist(ctx, p) },
        { icon: 'plus', text: 'Add tracks…', run: () => addTracksTo(ctx, p) },
        'sep',
        { icon: 'settings', text: 'Rename…', run: () => renamePlaylist(ctx, p) },
        { icon: 'close', text: 'Delete playlist', danger: true, run: () => deletePlaylist(ctx, p) },
      ]);
    } },
      el('div.pic', {}, icon('list')),
      el('div.name', { text: p.name }),
      el('div.meta', { text: `${plural(p.count, 'track', 'tracks')} · ${fmtLong(p.duration)}` })));
  }
  return el('div', { style: { display: 'contents' } },
    head({ title: 'Playlists', sub: plural(lists.length, 'playlist', 'playlists'), actions: [add] }),
    el('div.grid-wrap', {}, grid));
}

/** Действия над списком — общие для страницы списка и меню по правой кнопке на его названии слева. */
export async function addTracksTo(ctx, p) {
  const ids = await pickTracks(`Add to “${p.name}”`);
  if (!ids?.length) return;
  await api.playlistAdd(p.id, ids);
  toast(`Added: ${plural(ids.length, 'track', 'tracks')}`);
  await ctx.refreshNav();
  if (ctx.isOpen('playlist', p.id)) ctx.reload();
}

export async function renamePlaylist(ctx, p) {
  const name = await prompt('Rename playlist', p.name);
  if (!name) return;
  await api.playlistRename(p.id, name);
  await ctx.refreshNav();
  if (ctx.isOpen('playlist', p.id) || ctx.isOpen('playlists')) ctx.reload();
}

export async function deletePlaylist(ctx, p) {
  if (!(await ask('Delete playlist?', `“${p.name}” — the files themselves stay where they are.`, 'Delete', true))) return;
  await api.playlistDelete(p.id);
  await ctx.refreshNav();
  toast('Playlist deleted');
  if (ctx.isOpen('playlist', p.id)) ctx.go('playlists');
  else if (ctx.isOpen('playlists')) ctx.reload();
}

export async function playPlaylist(ctx, p, shuffle = false) {
  const items = await api.playlistItems(p.id);
  if (!items.length) { toast('Playlist is empty'); return; }
  if (shuffle) ctx.player.playShuffled(items); else ctx.player.playList(items, 0);
}

export async function playlist(ctx, { id }) {
  ctx.setSort(null);
  const meta = (await api.playlists()).find((p) => p.id === id);
  if (!meta) return emptyNode('list', 'Playlist not found', 'It was deleted.');
  const entries = await api.playlistItems(id);
  const reload = () => ctx.reload();
  const addBtn = () => el('button.tl-accent', { onclick: () => addTracksTo(ctx, meta) }, icon('plus'), 'Add tracks');
  const renameBtn = el('button', { onclick: () => renamePlaylist(ctx, meta) }, icon('settings'), 'Rename');
  const deleteBtn = el('button.tl-danger', { onclick: () => deletePlaylist(ctx, meta) }, icon('close'), 'Delete playlist');

  const sub = `${plural(entries.length, 'track', 'tracks')} · ${fmtLong(meta.duration)}`;
  const body = entries.length
    ? trackTable(ctx, entries, {
      playlist: id,
      reload,
      onReorder: async (from, to) => {
        const moving = from.map((k) => entries[k]);
        const rest = entries.filter((_, k) => !from.includes(k));
        let at = rest.indexOf(entries[to]);
        if (at < 0) at = rest.length;
        rest.splice(at, 0, ...moving);
        await api.playlistReorder(id, rest.map((e) => e.item_id));
        reload();
      },
    })
    : emptyNode('list', 'Playlist is empty', 'Press “Add tracks” and tick what you want.', addBtn());
  return el('div', { style: { display: 'contents' } },
    head({ title: meta.name, sub, artIcon: 'list', actions: [...playButtons(ctx, entries), entries.length ? addBtn() : null, renameBtn, deleteBtn] }),
    body);
}
