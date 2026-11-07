// Кадры-обложки для видео: по одному, в скрытом <video>, кадр с 10 % длительности (не дальше 30 с).
// Готовый кадр уходит в Rust (папка обложек) и запоминается в базе — второй раз не делается.

import { api, fileUrl } from './api.js';

const queue = [];
const busy = new Set();
let running = false;

/** Сделать кадр для записи и показать в node (фон). */
export function want(m, node, onDone) {
  if (m.cover || busy.has(m.id)) return;
  busy.add(m.id);
  queue.push({ m, node, onDone });
  // начать чуть позже: вид ещё не вставлен в окно, когда просит кадры
  if (!running) { running = true; setTimeout(run, 150); }
}

async function run() {
  running = true;
  while (queue.length) {
    const job = queue.shift();
    if (!job.node.isConnected) { busy.delete(job.m.id); continue; }
    try {
      const { data, duration } = await grab(job.m.path);
      if (duration && !(job.m.duration > 0)) {
        job.m.duration = duration;
        api.setDuration(job.m.id, duration).catch(() => {});
      }
      if (data) {
        const path = await api.saveThumb(job.m.id, data);
        job.m.cover = path;
        job.node.textContent = '';
        job.node.style.backgroundImage = `url("${fileUrl(path)}")`;
        job.onDone?.(path);
      }
    } catch { /* файл не открылся — останется значок */ }
    busy.delete(job.m.id);
  }
  running = false;
}

function grab(path) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.crossOrigin = 'anonymous';
    let done = false;
    const finish = (data) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      const duration = isFinite(v.duration) ? v.duration : 0;
      v.removeAttribute('src');
      v.load();
      resolve({ data, duration });
    };
    const t = setTimeout(() => finish(null), 15000);
    v.addEventListener('loadedmetadata', () => {
      const d = isFinite(v.duration) ? v.duration : 60;
      v.currentTime = Math.min(30, Math.max(1, d * 0.1));
    });
    v.addEventListener('seeked', () => {
      try {
        const w = 480, h = Math.round((w * (v.videoHeight || 270)) / (v.videoWidth || 480));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        finish(c.toDataURL('image/jpeg', 0.82));
      } catch { finish(null); }
    });
    v.addEventListener('error', () => finish(null));
    v.src = fileUrl(path);
  });
}
