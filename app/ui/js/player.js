// Проигрыватель: один элемент <video> играет и музыку, и видео. Очередь, перемешивание, повтор,
// счётчик прослушиваний, продолжение видео с места остановки, субтитры, кнопки мультимедиа системы.
// Состояние (очередь, место, громкость) запоминается в базе и восстанавливается при запуске.

import { api, fileUrl } from './api.js';
import { artistOf, debounce, toast } from './util.js';

function shuffled(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export class Player extends EventTarget {
  constructor(media) {
    super();
    this.m = media;
    this.queue = [];
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off'; // off | all | one
    this.original = null; // порядок до перемешивания
    this.counted = null;
    this.resumeAt = 0;
    this.errors = 0;
    this.subsOn = true;
    this.subsUrl = null;
    this.lastSave = 0;
    this.saveLater = debounce(() => this.save(), 800);

    const m = this.m;
    m.addEventListener('play', () => this.emit('state'));
    m.addEventListener('pause', () => { this.emit('state'); this.savePosition(); this.save(); });
    m.addEventListener('ended', () => this.ended());
    m.addEventListener('timeupdate', () => this.tick());
    m.addEventListener('loadedmetadata', () => this.metadata());
    m.addEventListener('volumechange', () => { this.emit('volume'); this.saveLater(); });
    m.addEventListener('error', () => this.failed());
    m.addEventListener('playing', () => { this.errors = 0; });
    this.mediaKeys();
  }

  get current() { return this.queue[this.index] || null; }
  get playing() { return !this.m.paused && !this.m.ended; }
  emit(type) { this.dispatchEvent(new Event(type)); }

  // ── очередь ──

  playList(items, start = 0) {
    if (!items.length) return;
    this.original = null;
    let q = items.slice();
    let idx = Math.min(Math.max(0, start), q.length - 1);
    if (this.shuffle) {
      this.original = q.slice();
      const first = q[idx];
      q = [first, ...shuffled(q.filter((_, k) => k !== idx))];
      idx = 0;
    }
    this.queue = q;
    this.index = idx;
    this.load(true);
    this.emit('queue');
  }

  playShuffled(items) {
    if (!items.length) return;
    this.setShuffle(true, false);
    this.playList(items, Math.floor(Math.random() * items.length));
  }

  enqueue(items) {
    if (!items.length) return;
    this.queue.push(...items);
    if (this.original) this.original.push(...items);
    if (this.index < 0) { this.index = 0; this.load(false); }
    this.emit('queue');
    this.saveLater();
  }

  playNext(items) {
    if (!items.length) return;
    this.queue.splice(this.index + 1, 0, ...items);
    if (this.original) this.original.push(...items);
    if (this.index < 0) { this.index = 0; this.load(false); }
    this.emit('queue');
    this.saveLater();
  }

  jump(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.index = i;
    this.load(true);
    this.emit('queue');
  }

  remove(i) {
    if (i < 0 || i >= this.queue.length) return;
    const wasCurrent = i === this.index;
    const [gone] = this.queue.splice(i, 1);
    if (this.original) this.original = this.original.filter((x) => x !== gone);
    if (i < this.index) this.index--;
    if (wasCurrent) {
      if (!this.queue.length) { this.clear(); return; }
      if (this.index >= this.queue.length) this.index = this.queue.length - 1;
      this.load(this.playing);
    }
    this.emit('queue');
    this.saveLater();
  }

  /** Переставляет строки очереди (индексы from) перед строкой to. */
  move(from, to) {
    const cur = this.current;
    const moving = from.map((k) => this.queue[k]);
    const rest = this.queue.filter((_, k) => !from.includes(k));
    let at = rest.indexOf(this.queue[to]);
    if (at < 0) at = rest.length;
    rest.splice(at, 0, ...moving);
    this.queue = rest;
    this.index = cur ? this.queue.indexOf(cur) : -1;
    this.emit('queue');
    this.saveLater();
  }

  clear() {
    this.queue = [];
    this.original = null;
    this.index = -1;
    this.m.pause();
    this.m.removeAttribute('src');
    this.m.load();
    this.emit('track');
    this.emit('queue');
    this.save();
  }

  // ── управление ──

  toggle() {
    if (!this.current) return;
    if (this.m.paused) this.m.play().catch(() => {});
    else this.m.pause();
  }

  next(auto = false) {
    if (!this.queue.length) return;
    if (this.index < this.queue.length - 1) this.index++;
    else if (this.repeat === 'all') this.index = 0;
    else {
      if (auto) { this.m.pause(); this.m.currentTime = 0; }
      return;
    }
    this.load(true);
    this.emit('queue');
  }

  prev() {
    if (!this.queue.length) return;
    if (this.m.currentTime > 3 || this.index === 0) { this.m.currentTime = 0; return; }
    this.index--;
    this.load(true);
    this.emit('queue');
  }

  seek(t) {
    if (isFinite(t)) this.m.currentTime = Math.max(0, t);
  }

  seekBy(d) { this.seek(this.m.currentTime + d); }

  setVolume(v) {
    this.m.volume = Math.min(1, Math.max(0, v));
    if (this.m.volume > 0) this.m.muted = false;
  }

  toggleMute() { this.m.muted = !this.m.muted; }

  setShuffle(on, reorder = true) {
    if (on === this.shuffle) return;
    this.shuffle = on;
    if (reorder && this.queue.length) {
      const cur = this.current;
      if (on) {
        this.original = this.queue.slice();
        const before = this.queue.slice(0, this.index + 1);
        const after = shuffled(this.queue.slice(this.index + 1));
        this.queue = before.concat(after);
      } else if (this.original) {
        this.queue = this.original;
        this.original = null;
        this.index = cur ? this.queue.indexOf(cur) : 0;
      }
      this.emit('queue');
    }
    this.emit('mode');
    this.saveLater();
  }

  cycleRepeat() {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    this.emit('mode');
    this.saveLater();
  }

  setSubtitles(on) {
    this.subsOn = on;
    for (const t of this.m.textTracks) t.mode = on ? 'showing' : 'hidden';
    this.emit('subs');
  }

  /** Записи в очереди обновились в базе (теги, оценка) — подменить их здесь. */
  update(media) {
    for (const list of [this.queue, this.original || []]) {
      list.forEach((x, k) => { if (x.id === media.id) list[k] = { ...x, ...media }; });
    }
    this.emit('queue');
    if (this.current?.id === media.id) this.emit('track');
  }

  // ── загрузка и события элемента ──

  load(autoplay, at = 0) {
    const m = this.current;
    if (!m) return;
    this.counted = null;
    this.resumeAt = at || (m.kind === 'video' && m.position > 5 ? m.position : 0);
    for (const t of [...this.m.querySelectorAll('track')]) t.remove();
    if (this.subsUrl) { URL.revokeObjectURL(this.subsUrl); this.subsUrl = null; }
    this.m.src = fileUrl(m.path);
    this.m.classList.toggle('shown', m.kind === 'video');
    if (m.kind === 'video' && m.subs) this.loadSubs(m.id);
    if (autoplay) this.m.play().catch(() => {});
    this.emit('track');
    this.session();
    this.saveLater();
  }

  async loadSubs(id) {
    try {
      const vtt = await api.subtitles(id);
      if (!vtt || this.current?.id !== id) return;
      this.subsUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      const tr = document.createElement('track');
      tr.kind = 'subtitles';
      tr.label = 'Subtitles';
      tr.src = this.subsUrl;
      tr.default = true;
      this.m.append(tr);
      tr.track.mode = this.subsOn ? 'showing' : 'hidden';
      this.emit('subs');
    } catch { /* без субтитров */ }
  }

  metadata() {
    const m = this.current;
    if (!m) return;
    const d = this.m.duration;
    if (isFinite(d) && d > 0 && !(m.duration > 0)) {
      m.duration = d;
      api.setDuration(m.id, d).catch(() => {});
    }
    if (this.resumeAt > 0 && (!isFinite(d) || this.resumeAt < d - 10)) this.m.currentTime = this.resumeAt;
    this.resumeAt = 0;
    this.emit('time');
  }

  tick() {
    this.emit('time');
    const m = this.current;
    if (!m) return;
    const t = this.m.currentTime, d = this.m.duration;
    if (this.counted !== m.id && isFinite(d) && d > 0 && (t > d * 0.5 || t > 240)) {
      this.counted = m.id;
      m.play_count++;
      m.last_played = Math.floor(Date.now() / 1000);
      api.markPlayed(m.id).catch(() => {});
    }
    const now = Date.now();
    if (now - this.lastSave > 5000) {
      this.lastSave = now;
      this.savePosition();
      this.save();
    }
    if ('mediaSession' in navigator && isFinite(d) && d > 0) {
      try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(t, d), playbackRate: this.m.playbackRate }); } catch { /* старые движки */ }
    }
  }

  savePosition() {
    const m = this.current;
    if (!m || m.kind !== 'video') return;
    const t = this.m.currentTime, d = this.m.duration;
    const pos = isFinite(d) && t > d - 10 ? 0 : t;
    m.position = pos;
    api.setPosition(m.id, pos).catch(() => {});
  }

  ended() {
    const m = this.current;
    if (m && this.counted !== m.id) {
      this.counted = m.id;
      m.play_count++;
      api.markPlayed(m.id).catch(() => {});
    }
    if (m) m.position = 0;
    if (this.repeat === 'one') { this.m.currentTime = 0; this.m.play().catch(() => {}); return; }
    this.next(true);
  }

  failed() {
    const m = this.current;
    if (!m || !this.m.getAttribute('src')) return;
    toast(`Cannot open: ${m.file_name}`);
    this.errors++;
    if (this.errors < this.queue.length && this.index < this.queue.length - 1) setTimeout(() => this.next(true), 900);
  }

  // ── кнопки мультимедиа системы (клавиатура, панель Windows, шторка телефона) ──

  mediaKeys() {
    if (!('mediaSession' in navigator)) return;
    const s = navigator.mediaSession;
    const on = (a, f) => { try { s.setActionHandler(a, f); } catch { /* не поддерживается */ } };
    on('play', () => this.m.play().catch(() => {}));
    on('pause', () => this.m.pause());
    on('previoustrack', () => this.prev());
    on('nexttrack', () => this.next());
    on('seekto', (d) => this.seek(d.seekTime));
    on('seekbackward', () => this.seekBy(-10));
    on('seekforward', () => this.seekBy(10));
  }

  session() {
    if (!('mediaSession' in navigator)) return;
    const m = this.current;
    if (!m) { navigator.mediaSession.metadata = null; return; }
    const art = m.cover ? [{ src: fileUrl(m.cover), sizes: '512x512' }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: m.title, artist: artistOf(m), album: m.album, artwork: art });
  }

  // ── память между запусками ──

  save() {
    const state = {
      ids: this.queue.map((m) => m.id),
      index: this.index,
      pos: this.m.currentTime || 0,
      vol: this.m.volume,
      muted: this.m.muted,
      shuffle: this.shuffle,
      repeat: this.repeat,
      subs: this.subsOn,
    };
    api.setSetting('player', JSON.stringify(state)).catch(() => {});
  }

  async restore() {
    let s;
    try { s = JSON.parse((await api.setting('player')) || 'null'); } catch { s = null; }
    if (!s) { this.m.volume = 0.8; return; }
    this.m.volume = s.vol ?? 0.8;
    this.m.muted = !!s.muted;
    this.shuffle = !!s.shuffle;
    this.repeat = s.repeat || 'off';
    this.subsOn = s.subs !== false;
    if (s.ids?.length) {
      const items = await api.get(s.ids);
      const byId = new Map(items.map((m) => [m.id, m]));
      const wanted = s.ids[s.index];
      this.queue = s.ids.map((id) => byId.get(id)).filter(Boolean);
      this.index = Math.max(0, this.queue.findIndex((m) => m.id === wanted));
      if (this.queue.length) this.load(false, s.pos || 0);
    }
    this.emit('mode');
    this.emit('queue');
    this.emit('volume');
  }
}
