(function () {
  const COIN_ICON = {
    BTC: 'btc', ETH: 'eth', USDT: 'usdt', XRP: 'xrp', LTC: 'ltc', TRX: 'trx',
    BNB: 'bnb', SOL: 'sol', DOGE: 'doge', ADA: 'ada', TON: 'ton', DOT: 'dot',
    MATIC: 'matic', AVAX: 'avax', USD: 'usd', RUB: 'rub',
  };

  const PAIRS = [
    ['BTC', 'ETH'], ['ETH', 'USDT'], ['XRP', 'USDT'], ['TRX', 'USDT'],
    ['SOL', 'USDT'], ['BNB', 'USDT'], ['LTC', 'BTC'], ['DOGE', 'USDT'],
    ['ADA', 'USDT'], ['TON', 'USDT'], ['ETH', 'TRX'], ['BTC', 'LTC'],
    ['XRP', 'TRX'], ['SOL', 'ETH'], ['USDT', 'TRX'], ['BNB', 'SOL'],
  ];

  const AMOUNTS = {
    BTC: () => (Math.random() * 0.45 + 0.01).toFixed(3),
    ETH: () => (Math.random() * 3 + 0.05).toFixed(3),
    USDT: () => Math.floor(Math.random() * 9000 + 120),
    XRP: () => Math.floor(Math.random() * 8000 + 200),
    LTC: () => (Math.random() * 12 + 0.5).toFixed(2),
    TRX: () => Math.floor(Math.random() * 40000 + 500),
    BNB: () => (Math.random() * 4 + 0.1).toFixed(2),
    SOL: () => (Math.random() * 25 + 1).toFixed(2),
    DOGE: () => Math.floor(Math.random() * 50000 + 1000),
    ADA: () => Math.floor(Math.random() * 8000 + 200),
    TON: () => (Math.random() * 80 + 2).toFixed(1),
    DOT: () => (Math.random() * 120 + 5).toFixed(1),
    MATIC: () => Math.floor(Math.random() * 5000 + 100),
    AVAX: () => (Math.random() * 30 + 1).toFixed(2),
  };

  function iconClass(code) {
    return COIN_ICON[code] || code.toLowerCase();
  }

  function formatAmount(code, raw) {
    if (typeof raw === 'number') raw = String(raw);
    if (['USDT', 'XRP', 'TRX', 'DOGE', 'ADA', 'MATIC'].includes(code)) {
      return `${raw} ${code}`;
    }
    return `${raw} ${code}`;
  }

  function timeLabel(minutes) {
    if (minutes < 1) return 'только что';
    if (minutes === 1) return '1 мин назад';
    if (minutes < 60) return `${minutes} мин назад`;
    const h = Math.floor(minutes / 60);
    return h === 1 ? '1 ч назад' : `${h} ч назад`;
  }

  function makeTrade() {
    const [from, to] = PAIRS[Math.floor(Math.random() * PAIRS.length)];
    const gen = AMOUNTS[from] || (() => (Math.random() * 100 + 1).toFixed(2));
    const minutes = Math.floor(Math.random() * 55) + 1;
    return {
      from,
      to,
      amount: gen(),
      minutes,
      created: Date.now() - minutes * 60000,
    };
  }

  function renderItem(trade) {
    const li = document.createElement('li');
    li.className = 'recent-item';
    li.innerHTML = `
      <span class="recent-time" data-created="${trade.created}">${timeLabel(trade.minutes)}</span>
      <div class="recent-from">
        <span class="coin-ico svgcoin ${iconClass(trade.from)}"></span>
        <span class="recent-amount">${formatAmount(trade.from, trade.amount)}</span>
      </div>
      <i data-lucide="arrow-right" class="recent-arrow"></i>
      <div class="recent-to">
        <span class="coin-ico svgcoin ${iconClass(trade.to)}"></span>
        <span class="recent-code">${trade.to}</span>
      </div>
    `;
    return li;
  }

  function tickTimes(root) {
    const now = Date.now();
    root.querySelectorAll('.recent-time[data-created]').forEach((el) => {
      const created = parseInt(el.getAttribute('data-created'), 10);
      const min = Math.max(1, Math.floor((now - created) / 60000));
      el.textContent = timeLabel(min);
    });
  }

  function init() {
    const list = document.getElementById('recent_list');
    if (!list) return;

    const trades = Array.from({ length: 8 }, makeTrade)
      .sort((a, b) => a.created - b.created);

    list.innerHTML = '';
    trades.forEach((t) => list.appendChild(renderItem(t)));

    if (window.lucide) lucide.createIcons({ nodes: list.querySelectorAll('[data-lucide]') });

    setInterval(() => tickTimes(list), 30000);

    setInterval(() => {
      const t = makeTrade();
      t.minutes = 0;
      t.created = Date.now();
      const el = renderItem(t);
      list.insertBefore(el, list.firstChild);
      if (list.children.length > 10) list.removeChild(list.lastChild);
      if (window.lucide) lucide.createIcons({ nodes: el.querySelectorAll('[data-lucide]') });
    }, 45000 + Math.random() * 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
