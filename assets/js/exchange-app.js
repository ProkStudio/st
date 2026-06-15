(function () {
  const COIN_ICON = {
    BTC: 'btc', ETH: 'eth', USDT: 'usdt', XRP: 'xrp', LTC: 'ltc', TRX: 'trx',
    BNB: 'bnb', SOL: 'sol', DOGE: 'doge', ADA: 'ada', TON: 'ton', DOT: 'dot',
    MATIC: 'matic', AVAX: 'avax', USD: 'usd', RUB: 'rub',
  };

  const CURRENCIES = [
    { code: 'BTC', name: 'Bitcoin' },
    { code: 'ETH', name: 'Ethereum' },
    { code: 'USDT', name: 'Tether (TRC20)' },
    { code: 'XRP', name: 'Ripple' },
    { code: 'LTC', name: 'Litecoin' },
    { code: 'TRX', name: 'Tron' },
    { code: 'BNB', name: 'BNB' },
    { code: 'SOL', name: 'Solana' },
    { code: 'DOGE', name: 'Dogecoin' },
    { code: 'ADA', name: 'Cardano' },
    { code: 'TON', name: 'Toncoin' },
    { code: 'DOT', name: 'Polkadot' },
    { code: 'MATIC', name: 'Polygon' },
    { code: 'AVAX', name: 'Avalanche' },
    { code: 'USD', name: 'USD (наличные, Казань)' },
    { code: 'RUB', name: 'RUB (наличные, Казань)' },
  ];

  const PRECISION = 1e8;
  let rateAbort = null;
  let debounceTimer = null;
  let openPicker = null;

  const els = {};

  function $(id) { return document.getElementById(id); }

  function currencyByCode(code) {
    return CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
  }

  function iconClass(code) {
    return COIN_ICON[code] || code.toLowerCase();
  }

  function isCash(code) {
    return code === 'RUB' || code === 'USD';
  }

  function optionHtml(c) {
    const ic = iconClass(c.code);
    return `<option value="${c.code}" data-icon="${ic}">${c.name} (${c.code})</option>`;
  }

  function fillSelects() {
    const opts = CURRENCIES.map(optionHtml).join('');
    els.from.innerHTML = opts;
    els.to.innerHTML = opts;
    els.from.value = 'BTC';
    els.to.value = 'ETH';
  }

  function pickerButtonHtml(c) {
    const ic = iconClass(c.code);
    return `
      <span class="coin-ico svgcoin ${ic}"></span>
      <span class="coin-picker-label"><strong>${c.name}</strong><small>${c.code}</small></span>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
    `;
  }

  function pickerMenuHtml(selectEl) {
    return CURRENCIES.map((c) => {
      const ic = iconClass(c.code);
      const active = selectEl.value === c.code ? ' active' : '';
      return `<button type="button" class="coin-picker-option${active}" data-code="${c.code}">
        <span class="coin-ico svgcoin ${ic}"></span>
        <span class="coin-picker-option-text"><strong>${c.name}</strong><span>${c.code}</span></span>
      </button>`;
    }).join('');
  }

  function syncPickerUI(pickerEl, selectEl) {
    const c = currencyByCode(selectEl.value);
    const btn = pickerEl.querySelector('.coin-picker-btn');
    if (btn) btn.innerHTML = pickerButtonHtml(c);
    pickerEl.querySelectorAll('.coin-picker-option').forEach((opt) => {
      opt.classList.toggle('active', opt.dataset.code === selectEl.value);
    });
  }

  function closePicker(pickerEl) {
    if (!pickerEl) return;
    pickerEl.classList.remove('open');
    if (openPicker === pickerEl) openPicker = null;
  }

  function closeAllPickers() {
    document.querySelectorAll('.coin-picker.open').forEach(closePicker);
  }

  function initCoinPicker(pickerEl, selectEl, onChange) {
    pickerEl.innerHTML = `
      <button type="button" class="coin-picker-btn" aria-haspopup="listbox" aria-expanded="false"></button>
      <div class="coin-picker-menu" role="listbox"></div>
    `;
    const btn = pickerEl.querySelector('.coin-picker-btn');
    const menu = pickerEl.querySelector('.coin-picker-menu');
    menu.innerHTML = pickerMenuHtml(selectEl);
    syncPickerUI(pickerEl, selectEl);

    pickerEl.addEventListener('click', (e) => e.stopPropagation());

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = pickerEl.classList.contains('open');
      closeAllPickers();
      if (!isOpen) {
        pickerEl.classList.add('open');
        openPicker = pickerEl;
        btn.setAttribute('aria-expanded', 'true');
        menu.innerHTML = pickerMenuHtml(selectEl);
        syncPickerUI(pickerEl, selectEl);
      } else {
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    menu.addEventListener('click', (e) => {
      const opt = e.target.closest('.coin-picker-option');
      if (!opt) return;
      selectEl.value = opt.dataset.code;
      syncPickerUI(pickerEl, selectEl);
      closePicker(pickerEl);
      btn.setAttribute('aria-expanded', 'false');
      onChange();
    });
  }

  function setLoading(on) {
    els.rateHint.textContent = on ? 'Обновление курса…' : '';
  }

  function formatOut(n, code) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    if (x >= 1000) return x.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
    const dec = isCash(code) || ['USDT', 'XRP', 'TRX', 'DOGE', 'ADA', 'MATIC'].includes(code) ? 2 : 8;
    return x.toFixed(dec).replace(/\.?0+$/, '');
  }

  function toggleCashUI() {
    const cash = isCash(els.from.value) || isCash(els.to.value);
    els.walletBlock.hidden = cash;
    els.cashBlock.hidden = !cash;
    els.submit.disabled = cash;
    if (cash) els.submit.title = 'Наличный обмен — только в офисе';
    else els.submit.title = '';
    updateSubmit();
  }

  function updateSubmit() {
    if (isCash(els.from.value) || isCash(els.to.value)) {
      els.submit.disabled = true;
      return;
    }
    const amt = parseFloat(els.amountFrom.value);
    const addr = els.wallet.value.trim();
    els.submit.disabled = !(amt > 0 && addr.length >= 8);
  }

  async function fetchRate() {
    const from = els.from.value;
    const to = els.to.value;
    const amount = parseFloat(els.amountFrom.value) || 0;

    toggleCashUI();

    if (from === to) {
      els.amountTo.value = els.amountFrom.value || '0';
      els.rateText.textContent = '1 : 1';
      return;
    }

    if (rateAbort) rateAbort.abort();
    rateAbort = new AbortController();
    setLoading(true);

    try {
      const q = new URLSearchParams({ from, to, amount: String(amount || 1) });
      const res = await fetch(`/api/price?${q}`, { signal: rateAbort.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'rate_error');

      const rate = data[to];
      if (amount > 0) {
        const out = data.amountTo != null ? data.amountTo : amount * rate;
        els.amountTo.value = formatOut(Math.round(out * PRECISION) / PRECISION, to);
      } else {
        els.amountTo.value = '0';
      }
      els.rateText.textContent = `1 ${from} ≈ ${formatOut(rate, to)} ${to}`;
    } catch (e) {
      if (e.name !== 'AbortError') {
        els.amountTo.value = '—';
        els.rateText.textContent = 'Курс временно недоступен';
      }
    } finally {
      setLoading(false);
      updateSubmit();
    }
  }

  function scheduleRate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchRate, 280);
  }

  function onCurrencyChange() {
    syncPickerUI(els.pickerFrom, els.from);
    syncPickerUI(els.pickerTo, els.to);
    scheduleRate();
  }

  function swapCurrencies() {
    const f = els.from.value;
    els.from.value = els.to.value;
    els.to.value = f;
    syncPickerUI(els.pickerFrom, els.from);
    syncPickerUI(els.pickerTo, els.to);
    scheduleRate();
  }

  async function submitOrder() {
    if (els.submit.disabled) return;

    const from = els.from.value;
    const to = els.to.value;
    const amountFrom = parseFloat(els.amountFrom.value);
    const address = els.wallet.value.trim();

    if (!amountFrom || amountFrom <= 0) {
      alert('Укажите корректную сумму');
      return;
    }
    if (address.length < 8) {
      alert('Укажите адрес кошелька получателя');
      return;
    }

    els.submit.disabled = true;
    const label = els.submit.querySelector('span');
    const prev = label.textContent;
    label.textContent = 'Создание ордера…';

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, amountFrom, address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'order_failed');
      location.href = `/order.html?id=${encodeURIComponent(data.order.id)}`;
    } catch (e) {
      alert(e.message || 'Не удалось создать ордер');
      els.submit.disabled = false;
      label.textContent = prev;
      updateSubmit();
    }
  }

  function bindFocusClear(input) {
    input.addEventListener('focus', () => {
      const v = input.value.trim();
      if (!v || v === '0' || /^0\.0*$/.test(v)) input.value = '';
      else input.select();
    });
  }

  function init() {
    els.from = $('select_currency_from');
    els.to = $('select_currency_to');
    els.pickerFrom = $('picker_from');
    els.pickerTo = $('picker_to');
    els.amountFrom = $('select_amount_from');
    els.amountTo = $('select_amount_to');
    els.wallet = $('receive_wallet');
    els.submit = $('exchange_submit');
    els.walletBlock = $('wallet_block');
    els.cashBlock = $('cash_block');
    els.rateText = $('rate_line');
    els.rateHint = $('rate_hint');
    els.swapBtn = $('swap_currencies');

    if (!els.from || !els.submit) return;

    fillSelects();
    initCoinPicker(els.pickerFrom, els.from, onCurrencyChange);
    initCoinPicker(els.pickerTo, els.to, onCurrencyChange);
    bindFocusClear(els.amountFrom);

    document.addEventListener('click', () => {
      closeAllPickers();
      document.querySelectorAll('.coin-picker-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    });

    els.amountFrom.addEventListener('input', scheduleRate);
    els.wallet.addEventListener('input', updateSubmit);
    els.swapBtn.addEventListener('click', swapCurrencies);
    els.submit.addEventListener('click', submitOrder);

    scheduleRate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
