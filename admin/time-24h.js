(function (global) {
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function parseHHMM(v) {
    const m = String(v || '09:00').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { h: 9, m: 0 };
    return {
      h: Math.min(23, Math.max(0, parseInt(m[1], 10))),
      m: Math.min(59, Math.max(0, parseInt(m[2], 10))),
    };
  }

  function mount(el) {
    if (!el || el.dataset.mounted) return el;
    el.dataset.mounted = '1';
    el.innerHTML = '';

    const hSel = document.createElement('select');
    hSel.className = 'time-24h-h';
    hSel.setAttribute('aria-label', 'Часы');
    for (let i = 0; i < 24; i += 1) {
      const o = document.createElement('option');
      o.value = pad(i);
      o.textContent = pad(i);
      hSel.appendChild(o);
    }

    const sep = document.createElement('span');
    sep.className = 'time-24h-sep';
    sep.textContent = ':';

    const mSel = document.createElement('select');
    mSel.className = 'time-24h-m';
    mSel.setAttribute('aria-label', 'Минуты');
    for (let i = 0; i < 60; i += 1) {
      const o = document.createElement('option');
      o.value = pad(i);
      o.textContent = pad(i);
      mSel.appendChild(o);
    }

    el.appendChild(hSel);
    el.appendChild(sep);
    el.appendChild(mSel);
    return el;
  }

  function mountAll(root) {
    (root || document).querySelectorAll('.time-24h').forEach(mount);
  }

  function resolveEl(el) {
    if (typeof el === 'string') return document.getElementById(el);
    return el;
  }

  function getValue(el) {
    const node = resolveEl(el);
    if (!node) return '09:00';
    if (!node.dataset.mounted) mount(node);
    const h = node.querySelector('.time-24h-h')?.value || '09';
    const m = node.querySelector('.time-24h-m')?.value || '00';
    return `${h}:${m}`;
  }

  function setValue(el, hhmm) {
    const node = resolveEl(el);
    if (!node) return;
    if (!node.dataset.mounted) mount(node);
    const { h, m } = parseHHMM(hhmm);
    const hSel = node.querySelector('.time-24h-h');
    const mSel = node.querySelector('.time-24h-m');
    if (hSel) hSel.value = pad(h);
    if (mSel) mSel.value = pad(m);
  }

  global.Time24h = { mount, mountAll, getValue, setValue };
})(window);
