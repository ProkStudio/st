const API = '/api/admin';
let token = localStorage.getItem('admin_token');
let activeChatId = null;
let chatPollTimer = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

refreshIcons();

const STATUS_LABELS = {
  pending: 'Ожидает',
  processing: 'В работе',
  completed: 'Выполнен',
  cancelled: 'Отменён',
};

const RATE_MODE_LABELS = {
  auto: 'Авто',
  bybit: 'Bybit',
  binance: 'Binance',
  okx: 'OKX',
  coingecko: 'CoinGecko',
};

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function showScreen(name) {
  $('#login-screen').classList.toggle('hidden', name !== 'login');
  $('#dashboard-screen').classList.toggle('hidden', name !== 'dashboard');
}

function badge(status) {
  return `<span class="badge badge-${status}">${STATUS_LABELS[status] || status}</span>`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderOrderRow(o, compact = false) {
  const statusSelect = `
    <select class="status-select" data-id="${o.id}">
      ${Object.keys(STATUS_LABELS).map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
    </select>`;

  if (compact) {
    return `
      <div class="order-row">
        <span class="order-id">#${o.id}</span>
        <div>
          <div class="order-pair">${o.amount_from} ${o.from_currency} → ${Number(o.amount_to).toFixed(6)} ${o.to_currency}</div>
          <div class="order-addr">${o.address}</div>
        </div>
        ${badge(o.status)}
        ${statusSelect}
      </div>`;
  }

  return `
    <tr>
      <td><strong>#${o.id}</strong></td>
      <td>${o.from_currency} → ${o.to_currency}</td>
      <td>${o.amount_from} → ${Number(o.amount_to).toFixed(6)}</td>
      <td class="order-addr">${o.address}</td>
      <td>${badge(o.status)}</td>
      <td>${formatDate(o.created_at)}</td>
      <td>${statusSelect}</td>
    </tr>`;
}

function bindStatusSelects(root) {
  root.querySelectorAll('.status-select').forEach((sel) => {
    sel.onchange = async () => {
      try {
        await api(`/orders/${sel.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: sel.value }),
        });
        loadDashboard();
      } catch (e) {
        alert(e.message);
      }
    };
  });
}

function updateChatBadge(n) {
  const b = $('#chat-badge');
  if (!b) return;
  if (n > 0) {
    b.textContent = n;
    b.classList.remove('hidden');
  } else {
    b.classList.add('hidden');
  }
}

function renderChatSessions(sessions) {
  const list = $('#chat-sessions-list');
  if (!sessions.length) {
    list.innerHTML = '<p class="muted" style="padding:1rem">Сообщений пока нет</p>';
    return;
  }
  list.innerHTML = sessions.map((s) => `
    <button type="button" class="chat-session-item ${s.id === activeChatId ? 'active' : ''}" data-id="${s.id}">
      <div class="chat-session-top">
        <strong>${esc(s.country || 'Неизвестно')}</strong>
        ${s.unread_admin > 0 ? `<span class="chat-unread">${s.unread_admin}</span>` : ''}
      </div>
      <div class="chat-session-ip">IP: ${esc(s.ip || '—')}</div>
      <div class="chat-session-preview">${esc((s.last_preview || '').slice(0, 60))}</div>
      <div class="chat-session-time">${formatDate(s.last_message_at)}</div>
    </button>
  `).join('');

  list.querySelectorAll('.chat-session-item').forEach((btn) => {
    btn.onclick = () => openChatSession(btn.dataset.id);
  });
}

function renderChatMessages(messages) {
  const box = $('#chat-messages');
  box.innerHTML = messages.map((m) => `
    <div class="chat-bubble ${m.sender}">
      <div>${esc(m.body)}</div>
      <time>${formatDate(m.created_at)}</time>
    </div>
  `).join('');
  box.scrollTop = box.scrollHeight;
}

async function openChatSession(id) {
  activeChatId = id;
  const data = await api(`/chat/sessions/${id}`);
  $('#chat-thread-empty').classList.add('hidden');
  $('#chat-thread').classList.remove('hidden');

  const loc = [data.session.country, data.session.city].filter(Boolean).join(', ');
  $('#chat-thread-meta').innerHTML = `
    <div><strong>${esc(loc || 'Неизвестная страна')}</strong></div>
    <div class="chat-meta-line">IP: <code>${esc(data.session.ip || '—')}</code></div>
    <div class="chat-meta-line muted">ID: ${esc(data.session.id.slice(0, 8))}…</div>
  `;
  renderChatMessages(data.messages);
  loadChatSessions();
}

async function loadChatSessions() {
  const { sessions } = await api('/chat/sessions');
  renderChatSessions(sessions);
  const unread = sessions.reduce((a, s) => a + (s.unread_admin > 0 ? 1 : 0), 0);
  updateChatBadge(unread);
}

async function loadRateStatus() {
  const data = await api('/rate-status');
  const mode = data.mode || 'auto';
  const activeLabel = data.activeError
    ? 'Ошибка'
    : (data.activeProviderLabel || '—');
  const activeDetail = data.activeError
    ? data.activeError
    : (data.activePrice ? `BTC ≈ $${Number(data.activePrice).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '');

  $('#rate-active-provider').textContent = activeLabel;
  $('#rate-active-provider').style.color = data.activeError ? 'var(--red)' : 'var(--green)';
  $('#stat-rate-source').textContent = activeLabel;
  $('#stat-rate-mode').textContent = `Режим: ${data.modeLabel || RATE_MODE_LABELS[mode] || mode}`;

  const list = $('#rate-probe-list');
  if (!list) return;

  const probesHtml = (data.probes || []).map((p) => {
    const cls = p.ok ? 'is-ok' : 'is-fail';
    const meta = p.ok
      ? `$${Number(p.price).toLocaleString('en-US', { maximumFractionDigits: 2 })} · ${p.latencyMs} мс`
      : esc((p.error || 'недоступен').slice(0, 80));
    return `
      <div class="rate-probe-item ${cls}">
        <strong>${esc(p.label)}</strong>
        <span class="rate-probe-meta">${meta}</span>
      </div>`;
  }).join('');

  list.innerHTML = activeDetail
    ? `<div class="rate-probe-meta" style="margin-bottom:0.5rem">${esc(activeDetail)}</div>${probesHtml}`
    : probesHtml;
}

async function loadDashboard() {
  const data = await api('/dashboard');
  $('#stat-total').textContent = data.stats.total;
  $('#stat-pending').textContent = data.stats.pending;
  $('#stat-completed').textContent = data.stats.completed;
  $('#stat-fee').textContent = data.settings.markup_percent + '%';
  updateChatBadge(data.settings.unread_chats || 0);

  const rateProvider = data.settings.rate_provider || 'auto';
  $('#rate-provider-input').value = rateProvider;
  $('#stat-rate-mode').textContent = `Режим: ${RATE_MODE_LABELS[rateProvider] || rateProvider}`;

  loadRateStatus().catch(() => {});

  const orders = await api('/orders?limit=6');
  const recent = $('#recent-orders');
  recent.innerHTML = orders.orders.length
    ? orders.orders.map((o) => renderOrderRow(o, true)).join('')
    : '<p class="muted">Ордеров пока нет</p>';
  bindStatusSelects(recent);

  const all = await api('/orders?limit=100');
  const table = $('#orders-table');
  table.innerHTML = all.orders.map((o) => renderOrderRow(o)).join('');
  bindStatusSelects(table.parentElement);

  $('#markup-input').value = data.settings.markup_percent;
  $('#usd-rub-input').value = data.settings.usd_rub_rate;
  $('#order-ttl-input').value = data.settings.order_ttl_minutes || 30;
  $('#deposit-wallet-input').value = data.settings.deposit_wallet || '';
  $('#chat-operator-input').value = data.settings.chat_operator_name || 'Bambusito228 Support';
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
    });
    token = data.token;
    localStorage.setItem('admin_token', token);
    showScreen('dashboard');
    loadDashboard();
    loadChatSessions();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
};

$('#logout-btn').onclick = () => {
  token = null;
  localStorage.removeItem('admin_token');
  showScreen('login');
};

$$('.nav-item').forEach((btn) => {
  btn.onclick = () => {
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    const titles = { overview: 'Обзор', orders: 'Ордера', chat: 'Чат', settings: 'Настройки' };
    $('#page-title').textContent = titles[btn.dataset.tab];
    refreshIcons();
    if (btn.dataset.tab === 'chat') loadChatSessions();
    if (btn.dataset.tab === 'settings') loadRateStatus().catch(() => {});
  };
});

function toast(msg, ok = true) {
  const el = $('#settings-toast');
  el.textContent = msg;
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  setTimeout(() => { el.textContent = ''; }, 3000);
}

$('#save-all-settings').onclick = async () => {
  try {
    await api('/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        markup_percent: $('#markup-input').value,
        usd_rub_rate: $('#usd-rub-input').value,
        order_ttl_minutes: $('#order-ttl-input').value,
        deposit_wallet: $('#deposit-wallet-input').value,
        chat_operator_name: $('#chat-operator-input').value,
        rate_provider: $('#rate-provider-input').value,
      }),
    });
    const pwd = $('#pwd-new').value;
    if (pwd) {
      await api('/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: $('#pwd-current').value, newPassword: pwd }),
      });
      $('#pwd-current').value = '';
      $('#pwd-new').value = '';
    }
    toast('Настройки сохранены');
    loadDashboard();
  } catch (e) { toast(e.message, false); }
};

$('#chat-reply-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!activeChatId) return;
  const input = $('#chat-reply-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    await api(`/chat/sessions/${activeChatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    input.value = '';
    await openChatSession(activeChatId);
  } catch (err) {
    alert(err.message);
  }
};

$('#refresh-orders').onclick = loadDashboard;
$('#refresh-chat').onclick = loadChatSessions;
$('#refresh-rate-status').onclick = () => loadRateStatus().catch((e) => toast(e.message, false));

if (token) {
  showScreen('dashboard');
  loadDashboard().catch(() => {
    localStorage.removeItem('admin_token');
    showScreen('login');
  });
  loadChatSessions().catch(() => {});
  setInterval(() => {
    loadDashboard().catch(() => {});
    if ($('#tab-chat').classList.contains('active')) loadChatSessions().catch(() => {});
    if (activeChatId && $('#tab-chat').classList.contains('active')) {
      api(`/chat/sessions/${activeChatId}`).then((d) => renderChatMessages(d.messages)).catch(() => {});
    }
  }, 8000);
} else {
  showScreen('login');
}
