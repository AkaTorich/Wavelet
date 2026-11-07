// Связь с Rust: команды, события, адреса файлов для проигрывателя и картинок.

const T = window.__TAURI__;

export function invoke(cmd, args = {}) {
  return T.core.invoke(cmd, args);
}

/** Адрес файла с диска для <video>/<img> (встроенный способ Tauri, с докачкой по кускам). */
export function fileUrl(path) {
  return path ? T.core.convertFileSrc(path) : '';
}

export function listen(event, fn) {
  return T.event.listen(event, (e) => fn(e.payload));
}

/** Выбор папки (на ПК — окно системы; на телефоне может не поддерживаться — тогда null). */
export async function pickFolder(title) {
  try {
    const r = await invoke('plugin:dialog|open', { options: { directory: true, multiple: false, title } });
    return typeof r === 'string' ? r : (r && r.path) || null;
  } catch {
    return null;
  }
}

export function currentWindow() {
  return T.window && T.window.getCurrentWindow ? T.window.getCurrentWindow() : null;
}

export const api = {
  list: (req) => invoke('list_media', { req }),
  get: (ids) => invoke('get_media', { ids }),
  stats: () => invoke('stats'),
  albums: () => invoke('albums'),
  groups: (by) => invoke('groups', { by }),
  folders: () => invoke('folders'),
  addFolder: (path) => invoke('add_folder', { path }),
  removeFolder: (path) => invoke('remove_folder', { path }),
  defaultFolders: () => invoke('default_folders'),
  startScan: () => invoke('start_scan'),
  cancelScan: () => invoke('cancel_scan'),
  isScanning: () => invoke('is_scanning'),
  setRating: (id, rating) => invoke('set_rating', { id, rating }),
  markPlayed: (id) => invoke('mark_played', { id }),
  setPosition: (id, pos) => invoke('set_position', { id, pos }),
  setDuration: (id, duration) => invoke('set_duration', { id, duration }),
  saveThumb: (id, dataUrl) => invoke('save_thumb', { id, dataUrl }),
  setUserTags: (id, tags) => invoke('set_user_tags', { id, tags }),
  addTag: (ids, name) => invoke('add_tag', { ids, name }),
  editTags: (id, edit) => invoke('edit_tags', { id, edit }),
  subtitles: (id) => invoke('subtitles', { id }),
  playlists: () => invoke('playlists_list'),
  playlistCreate: (name) => invoke('playlist_create', { name }),
  playlistRename: (id, name) => invoke('playlist_rename', { id, name }),
  playlistDelete: (id) => invoke('playlist_delete', { id }),
  playlistItems: (id) => invoke('playlist_items', { id }),
  playlistAdd: (id, mediaIds) => invoke('playlist_add', { id, mediaIds }),
  playlistRemove: (itemIds) => invoke('playlist_remove', { itemIds }),
  playlistReorder: (id, itemIds) => invoke('playlist_reorder', { id, itemIds }),
  setting: (key) => invoke('setting_get', { key }),
  setSetting: (key, value) => invoke('setting_set', { key, value: String(value) }),
  reveal: (path) => invoke('reveal', { path }),
  platform: () => invoke('platform'),
};
