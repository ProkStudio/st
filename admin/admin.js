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
Time24h.mountAll();

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

const RISK_CLASS = {
  empty: 'risk-empty',
  unactivated: 'risk-unactivated',
  low: 'risk-low',
  normal: 'risk-normal',
  funded: 'risk-funded',
  whale: 'risk-whale',
  exchange_like: 'risk-exchange_like',
  error: 'risk-error',
};

function riskBadge(check) {
  if (!check?.risk) return '';
  const label = check.risk.label_ru || check.risk.label || '—';
  const cls = RISK_CLASS[check.risk.label] || 'risk-normal';
  return `<span class="risk-badge ${cls}" title="${esc(check.risk.reason || '')}">${esc(label)}</span>`;
}

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function renderWalletCheckCard(check, { compact = false, showActions = false, orderId = '' } = {}) {
  if (!check) {
    return `<p class="muted">Проверок пока нет</p>`;
  }
  const cached = check.cached ? `<span class="muted"> · кэш</span>` : '';
  const err = check.error ? `<p class="muted" style="color:var(--red)">${esc(check.error)}</p>` : '';
  const native = check.native
    ? `<div class="wallet-check-stat"><span>${esc(check.native.symbol)}</span><strong>${Number(check.native.amount).toFixed(8).replace(/\.?0+$/, '')}</strong></div>`
    : '';
  const tokens = (check.tokens || []).map((t) =>
    `<li>${esc(t.symbol)} ${esc(t.network || '')}: ${Number(t.amount).toFixed(4)} (${formatUsd(t.usd)})</li>`
  ).join('');
  const verification = (check.verification || []).map((v) =>
    `<li class="${v.ok ? 'verify-ok' : 'verify-fail'}">${esc(v.source)}: ${esc(v.detail || '')}</li>`
  ).join('');
  const explorer = check.explorer_url
    ? `<a class="wallet-explorer-link" href="${esc(check.explorer_url)}" target="_blank" rel="noopener noreferrer">Tronscan ↗</a>`
    : '';
  const actions = showActions ? `
    <button type="button" class="btn-check-sm wallet-check-btn" data-address="${esc(check.address)}" data-order-id="${esc(orderId)}">Обновить</button>
  ` : '';

  if (compact) {
    return `
      <div class="wallet-check-inline">
        <div class="wallet-check-inline-head">
          ${riskBadge(check)}
          <span class="muted">${formatUsd(check.usd_total)} · ${check.tx_count || 0} tx${cached}</span>
          ${actions}
        </div>
        ${err}
      </div>`;
  }

  return `
    <div class="wallet-check-head">
      <div>
        <strong>${esc((check.network || '').toUpperCase())}</strong>${cached}
        <div class="wallet-check-addr">${esc(check.address)}</div>
      </div>
      ${riskBadge(check)}
    </div>
    <div class="wallet-check-grid">
      ${native}
      <div class="wallet-check-stat"><span>USD всего</span><strong>${formatUsd(check.usd_total)}</strong></div>
      <div class="wallet-check-stat"><span>Транзакций</span><strong>${check.tx_count || 0}</strong></div>
    </div>
    ${tokens ? `<ul class="wallet-check-tokens">${tokens}</ul>` : ''}
    ${verification ? `<ul class="wallet-check-verify">${verification}</ul>` : ''}
    ${check.risk?.reason ? `<p class="muted" style="margin-top:0.5rem;font-size:0.82rem">${esc(check.risk.reason)}</p>` : ''}
    ${err}
    <p class="muted wallet-check-footer" style="margin-top:0.5rem;font-size:0.75rem">${formatDate(check.created_at)} · ${esc(check.source || '')} · ${esc(check.api_source || '')} ${explorer}</p>
  `;
}

async function runWalletCheckUi({ address, network, orderId, force = false, targetEl }) {
  const payload = { address, force };
  if (network) payload.network = network;
  if (orderId) payload.order_id = orderId;
  const { check } = await api('/wallet-check', { method: 'POST', body: JSON.stringify(payload) });
  if (targetEl) {
    targetEl.innerHTML = renderWalletCheckCard(check, { compact: !!targetEl.dataset.compact, showActions: true, orderId });
    targetEl.classList.remove('hidden');
    targetEl.querySelector('.wallet-check-btn')?.addEventListener('click', () => {
      runWalletCheckUi({ address: check.address, network: check.network, orderId, force: true, targetEl }).catch((e) => toast(e.message, false));
    });
  }
  return check;
}

async function loadCheckerJournal() {
  const { checks } = await api('/wallet-checks?limit=100');
  const tbody = $('#checker-journal');
  if (!checks.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Журнал пуст</td></tr>';
    return;
  }
  tbody.innerHTML = checks.map((c) => `
    <tr>
      <td>${formatDate(c.created_at)}</td>
      <td class="order-addr" title="${esc(c.address)}">${esc(c.address.slice(0, 18))}…</td>
      <td>${esc((c.network || '').toUpperCase())}</td>
      <td>${formatUsd(c.usd_total)}</td>
      <td>${c.tx_count || 0}</td>
      <td>${riskBadge(c)}</td>
      <td>${c.order_id ? `#${esc(c.order_id)}` : '—'}</td>
    </tr>
  `).join('');
}

async function loadCheckerTab() {
  const data = await api('/dashboard');
  const st = data.settings;
  $('#wallet-check-enabled').checked = !!st.wallet_check_enabled;
  $('#wallet-check-auto').checked = !!st.wallet_check_auto_on_order;
  $('#wallet-check-cooldown').value = st.wallet_check_cooldown_minutes ?? 5;
  await loadCheckerJournal();
}

async function loadOrderWalletCheck(order, container) {
  if (!order?.address || !container) return;
  try {
    const { check } = await api(`/wallet-checks/latest?order_id=${encodeURIComponent(order.id)}&address=${encodeURIComponent(order.address)}`);
    container.innerHTML = renderWalletCheckCard(check, { compact: true, showActions: true, orderId: order.id });
    container.classList.remove('hidden');
    container.querySelector('.wallet-check-btn')?.addEventListener('click', () => {
      runWalletCheckUi({
        address: order.address,
        orderId: order.id,
        force: false,
        targetEl: container,
      }).catch((e) => toast(e.message, false));
    });
  } catch {
    container.innerHTML = `<button type="button" class="btn-check-sm wallet-check-btn" data-address="${esc(order.address)}" data-order-id="${esc(order.id)}">Проверить адрес</button>`;
    container.classList.remove('hidden');
    container.querySelector('.wallet-check-btn')?.addEventListener('click', (e) => {
      runWalletCheckUi({
        address: order.address,
        orderId: order.id,
        targetEl: container,
      }).catch((err) => toast(err.message, false));
    });
  }
}

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
      <td class="order-check-cell">
        ${statusSelect}
        <button type="button" class="btn-check-sm order-wallet-check" data-id="${o.id}" data-address="${esc(o.address)}">🔍 Баланс</button>
      </td>
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

function chatSessionHeadline(s) {
  const seq = s.seq ? `#${s.seq}` : '#—';
  const order = s.order_id ? `Ордер #${s.order_id}` : 'без ордера';
  return `${seq} · ${order}`;
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
        <strong class="chat-session-headline">${esc(chatSessionHeadline(s))}</strong>
        ${s.unread_admin > 0 ? `<span class="chat-unread">${s.unread_admin}</span>` : ''}
      </div>
      <div class="chat-session-meta">${esc([s.country || 'Неизвестно', s.city].filter(Boolean).join(', '))}</div>
      <div class="chat-session-ip">IP: ${esc(s.ip || '—')}</div>
      <div class="chat-session-device">${esc(s.device_label || 'Устройство неизвестно')}</div>
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
    <div><strong>${esc(chatSessionHeadline(data.session))}</strong></div>
    <div class="chat-meta-line">${esc(loc || 'Неизвестная страна')}</div>
    <div class="chat-meta-line">IP: <code>${esc(data.session.ip || '—')}</code></div>
    <div class="chat-meta-line muted">${esc(data.session.device_label || 'Устройство неизвестно')}</div>
    ${data.session.order ? `<div class="chat-meta-line">💱 ${esc(data.session.order.amount_from)} ${esc(data.session.order.from_currency)} → ${Number(data.session.order.amount_to).toFixed(6)} ${esc(data.session.order.to_currency)}</div>` : ''}
    <div id="chat-wallet-check" class="wallet-check-inline hidden" data-compact="1"></div>
  `;
  if (data.session.order) {
    loadOrderWalletCheck(data.session.order, $('#chat-wallet-check'));
  }
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
  fillSettingsForm(data.settings);
  updateQuickCards(data.settings);

  $('#stat-total').textContent = data.stats.total;
  $('#stat-pending').textContent = data.stats.pending;
  $('#stat-completed').textContent = data.stats.completed;
  $('#stat-fee').textContent = data.settings.markup_percent + '%';
  updateChatBadge(data.settings.unread_chats || 0);

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
  table.parentElement.querySelectorAll('.order-wallet-check').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const check = await runWalletCheckUi({ address: btn.dataset.address, orderId: btn.dataset.id });
        alert(`${check.risk?.label_ru || '—'} · ${formatUsd(check.usd_total)} · ${check.tx_count || 0} tx`);
        loadCheckerJournal().catch(() => {});
      } catch (e) {
        toast(e.message, false);
      }
    };
  });
}

function fillSettingsForm(st) {
  if (!st) return;
  $('#markup-input').value = st.markup_percent;
  $('#exchange-min-input').value = st.exchange_min_usd ?? 50;
  $('#exchange-max-input').value = st.exchange_max_usd ?? 50000;
  $('#usd-rub-input').value = st.usd_rub_rate;
  $('#rate-provider-input').value = st.rate_provider || 'auto';
  $('#rate-refresh-input').value = st.rate_refresh_sec ?? 60;
  $('#order-ttl-input').value = st.order_ttl_minutes || 30;
  $('#deposit-wallet-input').value = st.deposit_wallet || '';
  $('#chat-operator-input').value = st.chat_operator_name || '';
  $('#chat-welcome-input').value = st.chat_welcome_message || '';
  $('#chat-offline-input').value = st.chat_offline_message || '';
  $('#chat-work-start') && Time24h.setValue('chat-work-start', st.chat_work_start || '09:00');
  $('#chat-work-end') && Time24h.setValue('chat-work-end', st.chat_work_end || '21:00');
  $('#chat-online-input').checked = !!st.chat_show_online;
  $('#notif-new-order').checked = !!st.notif_new_order;
  $('#notif-chat').checked = !!st.notif_chat_message;
  $('#notif-bybit').checked = !!st.notif_bybit_deposit;
  $('#notif-maintenance').checked = !!st.notif_maintenance;
  $('#notif-order-status').checked = !!st.notif_order_status;
  $('#site-name-input').value = st.site_name || '';
  $('#site-tagline-input').value = st.site_tagline || '';
  const accent = st.accent_color || '#22c55e';
  $('#accent-color-input').value = accent;
  $('#accent-hex-input').value = accent;
  $('#contact-tg-input').value = st.contact_telegram || '';
  $('#contact-email-input').value = st.contact_email || '';
  $('#rules-text-input').value = st.rules_text || '';
  $('#faq-text-input').value = st.faq_text || '';
  $('#maintenance-mode-input').checked = !!st.maintenance_mode;
  $('#maintenance-mode-input').dataset.wasOn = st.maintenance_mode ? '1' : '';
  $('#maintenance-msg-input').value = st.maintenance_message || '';
  $('#maintenance-schedule-enabled').checked = !!st.maintenance_schedule_enabled;
  $('#maintenance-schedule-start') && Time24h.setValue('maintenance-schedule-start', st.maintenance_schedule_start || '02:00');
  $('#maintenance-schedule-end') && Time24h.setValue('maintenance-schedule-end', st.maintenance_schedule_end || '08:00');
  const hint = $('#maintenance-effective-hint');
  if (hint) {
    hint.textContent = st.maintenance_effective
      ? 'Сейчас обмен для клиентов заблокирован (ручной режим или расписание).'
      : 'Сейчас обмен для клиентов доступен.';
  }
  $('#admin-username-display').textContent = st.admin_username || 'admin';
  $('#stat-rate-mode').textContent = `Режим: ${RATE_MODE_LABELS[st.rate_provider] || st.rate_provider}`;
}

function updateQuickCards(st) {
  $('#quick-markup').textContent = `${st.markup_percent}%`;
  $('#quick-usd-rub').textContent = st.usd_rub_rate;
  $('#quick-rate-src').textContent = RATE_MODE_LABELS[st.rate_provider] || st.rate_provider;
  const w = st.deposit_wallet || '';
  $('#quick-wallet').textContent = w ? `…${w.slice(-8)}` : 'не задан';
  const maint = !!st.maintenance_mode;
  $('#quick-maintenance').checked = maint;
  $('#quick-maintenance-label').textContent = st.maintenance_effective
    ? (maint ? 'Вкл' : 'По расписанию')
    : 'Выкл';
}

function collectSectionPayload(section) {
  switch (section) {
    case 'exchange':
      return {
        markup_percent: $('#markup-input').value,
        exchange_min_usd: $('#exchange-min-input').value,
        exchange_max_usd: $('#exchange-max-input').value,
      };
    case 'rates':
      return {
        rate_provider: $('#rate-provider-input').value,
        rate_refresh_sec: $('#rate-refresh-input').value,
        usd_rub_rate: $('#usd-rub-input').value,
      };
    case 'wallets':
      return { deposit_wallet: $('#deposit-wallet-input').value };
    case 'orders':
      return { order_ttl_minutes: $('#order-ttl-input').value };
    case 'chat':
      return {
        chat_operator_name: $('#chat-operator-input').value,
        chat_welcome_message: $('#chat-welcome-input').value,
        chat_offline_message: $('#chat-offline-input').value,
        chat_work_start: Time24h.getValue('chat-work-start'),
        chat_work_end: Time24h.getValue('chat-work-end'),
        chat_show_online: $('#chat-online-input').checked,
      };
    case 'notifications':
      return {
        notif_new_order: $('#notif-new-order').checked,
        notif_chat_message: $('#notif-chat').checked,
        notif_bybit_deposit: $('#notif-bybit').checked,
        notif_maintenance: $('#notif-maintenance').checked,
        notif_order_status: $('#notif-order-status').checked,
      };
    case 'site':
      return {
        site_name: $('#site-name-input').value,
        site_tagline: $('#site-tagline-input').value,
        accent_color: $('#accent-hex-input').value || $('#accent-color-input').value,
        contact_telegram: $('#contact-tg-input').value,
        contact_email: $('#contact-email-input').value,
        rules_text: $('#rules-text-input').value,
        faq_text: $('#faq-text-input').value,
        maintenance_mode: $('#maintenance-mode-input').checked,
        maintenance_message: $('#maintenance-msg-input').value,
        maintenance_schedule_enabled: $('#maintenance-schedule-enabled').checked,
        maintenance_schedule_start: Time24h.getValue('maintenance-schedule-start'),
        maintenance_schedule_end: Time24h.getValue('maintenance-schedule-end'),
      };
    default:
      return {};
  }
}

async function saveSettingsSection(section) {
  if (section === 'site' && $('#maintenance-mode-input').checked && !$('#maintenance-mode-input').dataset.wasOn) {
    if (!confirm('Выключить обмен для клиентов?')) {
      $('#maintenance-mode-input').checked = false;
      return;
    }
  }
  try {
    await api('/settings', { method: 'PATCH', body: JSON.stringify(collectSectionPayload(section)) });
    toast('Сохранено');
    loadDashboard();
  } catch (e) {
    toast(e.message, false);
  }
}

function switchSettingsPanel(name) {
  $$('.settings-pill').forEach((b) => b.classList.toggle('active', b.dataset.settings === name));
  $$('.settings-panel').forEach((p) => p.classList.toggle('active', p.dataset.settingsPanel === name));
  if (name === 'rates') loadRateStatus().catch(() => {});
  refreshIcons();
}

function openSettingsTab(panel) {
  $$('.nav-item').forEach((b) => b.classList.remove('active'));
  $$('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelector('.nav-item[data-tab="settings"]')?.classList.add('active');
  $('#tab-settings').classList.add('active');
  $('#page-title').textContent = 'Настройки';
  switchSettingsPanel(panel || 'exchange');
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
    const titles = { overview: 'Обзор', orders: 'Ордера', checker: 'Чекер', chat: 'Чат', settings: 'Настройки' };
    $('#page-title').textContent = titles[btn.dataset.tab];
    refreshIcons();
    if (btn.dataset.tab === 'chat') loadChatSessions();
    if (btn.dataset.tab === 'checker') loadCheckerTab().catch((e) => toast(e.message, false));
    if (btn.dataset.tab === 'settings') {
      switchSettingsPanel('exchange');
      loadRateStatus().catch(() => {});
    }
  };
});

$$('.settings-pill').forEach((btn) => {
  btn.onclick = () => switchSettingsPanel(btn.dataset.settings);
});

$$('.save-section').forEach((btn) => {
  btn.onclick = () => saveSettingsSection(btn.dataset.section);
});

$$('.quick-card[data-goto-settings]').forEach((card) => {
  card.querySelector('.quick-edit')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openSettingsTab(card.dataset.gotoSettings);
  });
  card.addEventListener('click', (e) => {
    if (e.target.closest('.toggle-row')) return;
    openSettingsTab(card.dataset.gotoSettings);
  });
});

$('#quick-maintenance').onchange = async () => {
  const on = $('#quick-maintenance').checked;
  if (on && !confirm('Выключить обмен для клиентов?')) {
    $('#quick-maintenance').checked = false;
    return;
  }
  try {
    await api('/settings', { method: 'PATCH', body: JSON.stringify({ maintenance_mode: on }) });
    toast(on ? 'Техрежим включён' : 'Техрежим выключен');
    loadDashboard();
  } catch (e) {
    $('#quick-maintenance').checked = !on;
    toast(e.message, false);
  }
};

$('#accent-color-input').oninput = () => {
  $('#accent-hex-input').value = $('#accent-color-input').value;
};
$('#accent-hex-input').oninput = () => {
  const v = $('#accent-hex-input').value;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) $('#accent-color-input').value = v;
};

$('#save-password-btn').onclick = async () => {
  const pwd = $('#pwd-new').value;
  if (!pwd) return toast('Введите новый пароль', false);
  try {
    await api('/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: $('#pwd-current').value, newPassword: pwd }),
    });
    $('#pwd-current').value = '';
    $('#pwd-new').value = '';
    toast('Пароль изменён');
  } catch (e) { toast(e.message, false); }
};

function toast(msg, ok = true) {
  const el = $('#settings-toast');
  el.textContent = msg;
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  setTimeout(() => { el.textContent = ''; }, 3000);
}

$('#refresh-orders').onclick = loadDashboard;
$('#refresh-chat').onclick = loadChatSessions;
$('#refresh-rate-status').onclick = () => loadRateStatus().catch((e) => toast(e.message, false));
$('#refresh-checker').onclick = () => loadCheckerJournal().catch((e) => toast(e.message, false));

$('#checker-form').onsubmit = async (e) => {
  e.preventDefault();
  const address = $('#checker-address').value.trim();
  const network = $('#checker-network').value;
  const orderId = $('#checker-order-id').value.trim();
  const targetEl = $('#checker-result');
  targetEl.dataset.compact = '';
  try {
    $('#checker-run-btn').disabled = true;
    const check = await runWalletCheckUi({
      address,
      network: network || undefined,
      orderId: orderId || undefined,
      targetEl,
    });
    loadCheckerJournal().catch(() => {});
    toast(check.cached ? 'Из кэша (кулдаун)' : 'Проверка выполнена');
  } catch (err) {
    toast(err.message, false);
  } finally {
    $('#checker-run-btn').disabled = false;
  }
};

$('#checker-force-btn').onclick = async () => {
  const address = $('#checker-address').value.trim();
  if (!address) return toast('Укажите адрес', false);
  try {
    await runWalletCheckUi({
      address,
      network: $('#checker-network').value || undefined,
      orderId: $('#checker-order-id').value.trim() || undefined,
      force: true,
      targetEl: $('#checker-result'),
    });
    loadCheckerJournal().catch(() => {});
    toast('Принудительная проверка выполнена');
  } catch (e) {
    toast(e.message, false);
  }
};

$('#wallet-check-save-btn').onclick = async () => {
  try {
    await api('/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        wallet_check_enabled: $('#wallet-check-enabled').checked,
        wallet_check_auto_on_order: $('#wallet-check-auto').checked,
        wallet_check_cooldown_minutes: $('#wallet-check-cooldown').value,
      }),
    });
    toast('Настройки чекера сохранены');
  } catch (e) {
    toast(e.message, false);
  }
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
