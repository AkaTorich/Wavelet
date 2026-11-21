// Свой заголовок окна на ПК: перетаскивание (data-tauri-drag-region), двойной щелчок — развернуть,
// кнопки «свернуть / развернуть / закрыть». Текст повторяет заголовок документа (что сейчас играет).

import { currentWindow } from './api.js';
import { $, setIcon } from './util.js';

export function bindTitlebar() {
  const w = currentWindow();
  if (!w) return;
  const maxBtn = $('#tb-max');

  $('#tb-min').addEventListener('click', () => w.minimize());
  maxBtn.addEventListener('click', () => w.toggleMaximize());
  $('#tb-close').addEventListener('click', () => w.close());

  const syncMax = async () => {
    const on = await w.isMaximized().catch(() => false);
    setIcon(maxBtn, on ? 'win-restore' : 'win-max');
    maxBtn.title = on ? 'Restore' : 'Maximize';
  };
  w.onResized(syncMax);
  syncMax();

  const title = $('#tb-title');
  const syncTitle = () => { title.textContent = document.title; };
  new MutationObserver(syncTitle).observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true });
  syncTitle();
}
