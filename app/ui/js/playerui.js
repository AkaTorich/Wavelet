// Полоса проигрывателя, видео на месте списка, полный экран и карточка «Сейчас играет» на телефоне.

import { currentWindow } from './api.js';
import { $, artistOf, fmtTime, isPhone, paintRange, setArt, setIcon, subline } from './util.js';
import { Visualizer } from './viz.js';

export function bindPlayerUI(player, hooks) {
  const m = player.m;
  const stage = $('#stage');
  let seeking = false;
  let uiTimer = 0;
  const viz = new Visualizer(m);
  viz.attach($('#viz'));
  viz.attach($('#sheet-viz'), () => 'Spectrum');

  // ── что играет ──
  player.addEventListener('track', () => {
    const cur = player.current;
    const title = cur ? cur.title : 'Nothing playing';
    const sub = cur ? (cur.kind === 'video' ? subline(cur) : [artistOf(cur), cur.album].filter(Boolean).join(' · ')) : '';
    $('#now-title').textContent = title;
    $('#now-sub').textContent = sub;
    $('#sheet-title').textContent = title;
    $('#sheet-sub').textContent = sub;
    $('#stage-title').textContent = cur ? cur.title : '';
    const icon = cur?.kind === 'video' ? 'video' : 'music';
    setArt($('#now-cover'), cur?.cover, icon);
    setArt($('#sheet-cover'), cur?.cover, icon);
    const isVideo = cur?.kind === 'video';
    $('#btn-video').hidden = !isVideo;
    $('#btn-full').hidden = !cur;
    $('#btn-viz').hidden = !cur || isVideo;
    viz.setCover(cur?.cover);
    $('#btn-addlist').hidden = !cur;
    if (isVideo && player.playing !== false) showStage(true);
    else if (!cur) showStage(false);
    else if (!stage.hidden) showStage(true); // открытое место видео переходит в визуализацию и обратно
    document.title = cur ? `${cur.title} — Wavelet` : 'Wavelet';
    currentWindow()?.setTitle(document.title).catch(() => {});
    hooks.onTrack?.();
  });

  player.addEventListener('state', () => {
    const name = player.playing ? 'pause' : 'play';
    setIcon($('#btn-play'), name);
    setIcon($('#s-play'), name);
    $('#btn-play').title = player.playing ? 'Pause' : 'Play';
  });

  player.addEventListener('time', () => {
    const d = m.duration, t = m.currentTime;
    const dur = isFinite(d) ? d : player.current?.duration || 0;
    const frac = dur > 0 ? t / dur : 0;
    if (!seeking) {
      for (const id of ['#seek', '#s-seek']) { const r = $(id); r.value = Math.round(frac * 1000); paintRange(r); }
      $('#t-cur').textContent = $('#s-cur').textContent = fmtTime(t);
    }
    $('#t-dur').textContent = $('#s-dur').textContent = fmtTime(dur);
    $('#bar').style.setProperty('--progress', `${frac * 100}%`);
  });

  player.addEventListener('mode', () => {
    for (const id of ['#btn-shuffle', '#s-shuffle']) $(id).classList.toggle('on', player.shuffle);
    for (const id of ['#btn-repeat', '#s-repeat']) {
      $(id).classList.toggle('on', player.repeat !== 'off');
      setIcon($(id), player.repeat === 'one' ? 'repeat-one' : 'repeat');
    }
    $('#btn-repeat').title = { off: 'Repeat off', all: 'Repeat queue', one: 'Repeat one' }[player.repeat];
  });

  player.addEventListener('volume', () => {
    const v = $('#volume');
    v.value = Math.round((m.muted ? 0 : m.volume) * 100);
    paintRange(v);
    setIcon($('#btn-mute'), m.muted || m.volume === 0 ? 'mute' : 'volume');
  });

  player.addEventListener('subs', () => {
    const has = m.textTracks.length > 0;
    $('#btn-subs').hidden = !has;
    $('#btn-subs').classList.toggle('on', has && player.subsOn);
  });

  // ── кнопки ──
  const click = (id, f) => $(id).addEventListener('click', f);
  click('#btn-play', () => player.toggle());
  click('#s-play', () => player.toggle());
  click('#btn-next', () => player.next());
  click('#s-next', () => player.next());
  click('#btn-prev', () => player.prev());
  click('#s-prev', () => player.prev());
  click('#btn-shuffle', () => player.setShuffle(!player.shuffle));
  click('#s-shuffle', () => player.setShuffle(!player.shuffle));
  click('#btn-repeat', () => player.cycleRepeat());
  click('#s-repeat', () => player.cycleRepeat());
  click('#btn-mute', () => player.toggleMute());
  click('#btn-subs', () => player.setSubtitles(!player.subsOn));
  click('#btn-video', () => showStage(stage.hidden));
  click('#btn-viz', () => showStage(stage.hidden));
  click('#viz-mode', () => cycleViz());
  $('#viz').addEventListener('click', () => cycleViz());
  $('#viz').addEventListener('dblclick', () => toggleFull());
  click('#stage-close', () => showStage(false));
  click('#btn-full', () => toggleFull());
  click('#sheet-close', () => ($('#sheet').hidden = true));
  click('#sheet-queue', () => { $('#sheet').hidden = true; hooks.toggleQueue?.(true); });
  click('#btn-queue', () => hooks.toggleQueue?.());
  click('#btn-addlist', () => { if (player.current) hooks.addToPlaylist?.([player.current]); });

  $('#now').addEventListener('click', () => {
    const cur = player.current;
    if (!cur) return;
    if (isPhone()) {
      if (cur.kind === 'video') showStage(true);
      else { $('#sheet').hidden = false; viz.start(); }
    } else if (cur.kind === 'video') showStage(true);
    else hooks.openAlbum?.(cur);
  });

  $('#volume').addEventListener('input', (e) => { player.setVolume(e.target.value / 100); paintRange(e.target); });

  for (const id of ['#seek', '#s-seek']) {
    const r = $(id);
    r.addEventListener('input', () => {
      seeking = true;
      paintRange(r);
      const d = isFinite(m.duration) ? m.duration : 0;
      $('#t-cur').textContent = $('#s-cur').textContent = fmtTime((r.value / 1000) * d);
    });
    r.addEventListener('change', () => {
      const d = isFinite(m.duration) ? m.duration : 0;
      player.seek((r.value / 1000) * d);
      seeking = false;
    });
  }

  // ── видео ──
  m.addEventListener('click', () => player.toggle());
  m.addEventListener('dblclick', () => toggleFull());
  stage.addEventListener('mousemove', poke);
  document.addEventListener('mousemove', () => { if (document.body.classList.contains('full')) poke(); });

  function poke() {
    document.body.classList.add('ui');
    stage.classList.add('ui');
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => { document.body.classList.remove('ui'); stage.classList.remove('ui'); }, 2500);
  }

  function showStage(on) {
    const cur = player.current, isVideo = cur?.kind === 'video';
    stage.hidden = !(on && cur);
    const vizOn = !stage.hidden && !isVideo;
    $('#viz').hidden = !vizOn;
    $('#viz-mode').hidden = !vizOn;
    stage.classList.toggle('viz', vizOn);
    $('#btn-video').classList.toggle('on', !stage.hidden && isVideo);
    $('#btn-viz').classList.toggle('on', vizOn);
    if (vizOn) { $('#viz-mode').textContent = viz.mode; viz.start(); }
    if (stage.hidden && document.body.classList.contains('full')) setFull(false);
  }

  function cycleViz() {
    $('#viz-mode').textContent = viz.nextMode();
    poke();
  }

  /** V: открыть / закрыть визуализацию музыки. */
  function toggleViz() {
    if (!player.current || player.current.kind === 'video') return;
    showStage(stage.hidden);
  }

  async function setFull(on) {
    document.body.classList.toggle('full', on);
    if (on) { showStage(true); poke(); }
    const w = currentWindow();
    try {
      if (w && !isPhone()) await w.setFullscreen(on);
      else if (on) await document.documentElement.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* остаётся растянутым внутри окна */ }
  }

  function toggleFull() {
    if (!player.current) return;
    setFull(!document.body.classList.contains('full'));
  }

  return { showStage, toggleFull, toggleViz, setFull, isFull: () => document.body.classList.contains('full') };
}
