// Длинный список, который рисует только видимые строки: десятки тысяч записей не тормозят окно.
// Выделение мышью (Ctrl, Shift), клавиши, двойной щелчок / касание — открыть,
// правая кнопка / долгое касание — меню, перетаскивание строк.

import { el, isPhone } from './util.js';

export const DRAG_TYPE = 'application/x-wavelet-ids';

export class VirtualList {
  /**
   * @param {object} o
   * @param {(item, index) => HTMLElement} o.render
   * @param {(index) => void} [o.onOpen]
   * @param {(event, items, index) => void} [o.onMenu]
   * @param {(fromIndices, toIndex) => void} [o.onReorder] — перестановка перетаскиванием внутри списка
   * @param {(item) => number} [o.idOf] — id записи для перетаскивания в списки
   */
  constructor(o) {
    this.o = o;
    this.items = [];
    this.sel = new Set();
    this.anchor = -1;
    this.rh = 36;
    this.root = el('div.vlist', { tabindex: 0 });
    this.spacer = el('div.spacer');
    this.root.append(this.spacer);
    this.raf = 0;
    this.root.addEventListener('scroll', () => this.schedule());
    this.ro = new ResizeObserver(() => { this.measure(); this.schedule(); });
    this.ro.observe(this.root);
    this.root.addEventListener('keydown', (e) => this.key(e));
  }

  measure() {
    const v = parseFloat(getComputedStyle(this.root).getPropertyValue('--row-h'));
    if (v && v !== this.rh) {
      this.rh = v;
      this.spacer.style.height = `${this.items.length * this.rh}px`;
    }
  }

  setItems(items, keepScroll = false) {
    this.items = items;
    this.sel.clear();
    this.anchor = -1;
    this.measure();
    this.spacer.style.height = `${items.length * this.rh}px`;
    if (!keepScroll) this.root.scrollTop = 0;
    this.draw();
  }

  selectedItems() {
    return [...this.sel].sort((a, b) => a - b).map((i) => this.items[i]);
  }

  schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  refresh() { this.draw(); }

  scrollTo(index) {
    const top = index * this.rh, h = this.root.clientHeight;
    if (top < this.root.scrollTop || top + this.rh > this.root.scrollTop + h) {
      this.root.scrollTop = Math.max(0, top - h / 2);
    }
  }

  draw() {
    const h = this.root.clientHeight || 600;
    const first = Math.max(0, Math.floor(this.root.scrollTop / this.rh) - 6);
    const last = Math.min(this.items.length, Math.ceil((this.root.scrollTop + h) / this.rh) + 6);
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) frag.append(this.row(i));
    this.spacer.replaceChildren(frag);
  }

  row(i) {
    const node = this.o.render(this.items[i], i);
    const wrap = el('div.vrow', { style: { top: `${i * this.rh}px` } });
    wrap.append(node);
    if (this.sel.has(i)) node.classList.add('sel');
    wrap.addEventListener('click', (e) => this.click(e, i));
    wrap.addEventListener('dblclick', () => { if (!isPhone()) this.o.onOpen?.(i); });
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.sel.has(i)) { this.sel = new Set([i]); this.anchor = i; this.draw(); }
      this.o.onMenu?.(e, this.selectedItems(), i);
    });
    this.touch(wrap, i);
    if (!isPhone()) this.dragging(wrap, node, i);
    return wrap;
  }

  click(e, i) {
    if (isPhone()) {
      if (!this.longPressed) this.o.onOpen?.(i);
      this.longPressed = false;
      return;
    }
    if (e.shiftKey && this.anchor >= 0) {
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      if (!e.ctrlKey) this.sel.clear();
      for (let k = a; k <= b; k++) this.sel.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      this.sel.has(i) ? this.sel.delete(i) : this.sel.add(i);
      this.anchor = i;
    } else {
      this.sel = new Set([i]);
      this.anchor = i;
    }
    this.draw();
  }

  /** Долгое касание — меню. */
  touch(wrap, i) {
    let timer = 0, x = 0, y = 0;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      x = e.clientX; y = e.clientY;
      timer = setTimeout(() => {
        this.longPressed = true;
        this.sel = new Set([i]);
        this.o.onMenu?.({ clientX: x, clientY: y }, this.selectedItems(), i);
      }, 520);
    });
    const stop = () => clearTimeout(timer);
    wrap.addEventListener('pointerup', stop);
    wrap.addEventListener('pointercancel', stop);
    wrap.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - x, e.clientY - y) > 10) stop(); });
  }

  dragging(wrap, node, i) {
    wrap.draggable = true;
    wrap.addEventListener('dragstart', (e) => {
      if (!this.sel.has(i)) { this.sel = new Set([i]); this.anchor = i; }
      const idx = [...this.sel].sort((a, b) => a - b);
      this.dragFrom = idx;
      if (this.o.idOf) e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(idx.map((k) => this.o.idOf(this.items[k]))));
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    wrap.addEventListener('dragend', () => { this.dragFrom = null; });
    if (!this.o.onReorder) return;
    wrap.addEventListener('dragover', (e) => {
      if (!this.dragFrom) return;
      e.preventDefault();
      node.classList.add('drop-before');
    });
    wrap.addEventListener('dragleave', () => node.classList.remove('drop-before'));
    wrap.addEventListener('drop', (e) => {
      node.classList.remove('drop-before');
      if (!this.dragFrom) return;
      e.preventDefault();
      this.o.onReorder(this.dragFrom, i);
      this.dragFrom = null;
    });
  }

  key(e) {
    const n = this.items.length;
    if (!n) return;
    let cur = this.anchor;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cur = Math.min(n - 1, Math.max(0, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      if (e.shiftKey) this.sel.add(cur); else this.sel = new Set([cur]);
      this.anchor = cur;
      this.scrollTo(cur);
      this.draw();
    } else if (e.key === 'Enter' && cur >= 0) {
      e.preventDefault();
      this.o.onOpen?.(cur);
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.sel = new Set(this.items.map((_, k) => k));
      this.draw();
    }
  }

  destroy() {
    this.ro.disconnect();
  }
}
