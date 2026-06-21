const API = '/api/admin';
const STATUS_LABELS = {
  pending: 'Ожидает',
  processing: 'В работе',
  completed: 'Выполнен',
  cancelled: 'Отменён',
};
const TAB_TITLES = {
  overview: 'Обзор',
  orders: 'Ордера',
  checker: 'Чекер',
  chat: 'Чат',
  settings: 'Настройки',
};

const RISK_CLASS = {
  empty: 'risk-empty',
  low: 'risk-low',
  normal: 'risk-normal',
  funded: 'risk-funded',
  whale: 'risk-whale',
  exchange_like: 'risk-exchange_like',
  error: 'risk-error',
};

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function riskBadgeTg(check) {
  if (!check?.risk) return '';
  const label = check.risk.label_ru || check.risk.label || '—';
  const cls = RISK_CLASS[check.risk.label] || 'risk-normal';
  return `<span class="risk-pill ${cls}">${esc(label)}</span>`;
}

function renderTgCheckCard(check) {
  if (!check) return '<p class="empty">Нет данных</p>';
  const tokens = (check.tokens || []).map((t) =>
    `<div class="hint">${esc(t.symbol)} ${esc(t.network || '')}: ${Number(t.amount).toFixed(4)}</div>`
  ).join('');
  return `
    <div class="check-card-top">
      ${riskBadgeTg(check)}
      <strong>${formatUsd(check.usd_total)}</strong>
    </div>
    <div class="hint mono">${esc(check.address)}</div>
    <div class="hint">${esc((check.network || '').toUpperCase())} · ${check.tx_count || 0} tx · ${formatDate(check.created_at)}</div>
    ${check.native ? `<div>${esc(check.native.symbol)}: ${Number(check.native.amount).toFixed(6)}</div>` : ''}
    ${tokens}
    ${check.error ? `<div class="hint" style="color:var(--red)">${esc(check.error)}</div>` : ''}
  `;
}

async function loadCheckerJournalTg() {
  const { checks } = await api('/wallet-checks?limit=30');
  const box = $('#tg-checker-journal');
  if (!checks.length) {
    box.innerHTML = '<p class="empty">Журнал пуст</p>';
    return;
  }
  box.innerHTML = checks.map((c) => `
    <article class="order-card">
      <div class="order-top">${riskBadgeTg(c)}<span class="hint">${formatUsd(c.usd_total)}</span></div>
      <div class="order-meta mono">${esc(c.address.slice(0, 22))}…</div>
      <div class="hint">${esc((c.network || '').toUpperCase())} · ${formatDate(c.created_at)}${c.order_id ? ` · #${esc(c.order_id)}` : ''}</div>
    </article>
  `).join('');
}

async function loadCheckerTg() {
  await loadCheckerJournalTg();
}

async function runTgWalletCheck({ address, network, orderId, force = false }) {
  const payload = { address, force };
  if (network) payload.network = network;
  if (orderId) payload.order_id = orderId;
  const { check } = await api('/wallet-check', { method: 'POST', body: JSON.stringify(payload) });
  return check;
}

const tg = window.Telegram?.WebApp;
let token = null;
let activeTab = 'overview';
let activeTgSettings = 'quick';
let activeChatId = null;
let pollTimer = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

Time24h.mountAll();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readInitDataFromHash() {
  const hash = window.location.hash?.slice(1);
  if (!hash) return '';

  const params = new URLSearchParams(hash);
  const packed = params.get('tgWebAppData');
  if (packed) {
    try {
      return decodeURIComponent(packed);
    } catch {
      return packed;
    }
  }

  if (hash.includes('user=') && hash.includes('hash=')) {
    return hash;
  }
  return '';
}

function readInitDataFromSearch() {
  const qs = window.location.search?.slice(1);
  if (!qs || !qs.includes('user=') || !qs.includes('hash=')) return '';
  return qs;
}

function buildInitDataFromUnsafe(unsafe) {
  if (!unsafe?.user?.id || !unsafe?.auth_date || !unsafe?.hash) return '';
  const entries = [];
  if (unsafe.query_id != null) entries.push(['query_id', String(unsafe.query_id)]);
  entries.push(['user', JSON.stringify(unsafe.user)]);
  if (unsafe.receiver) entries.push(['receiver', JSON.stringify(unsafe.receiver)]);
  if (unsafe.chat) entries.push(['chat', JSON.stringify(unsafe.chat)]);
  if (unsafe.chat_type) entries.push(['chat_type', String(unsafe.chat_type)]);
  if (unsafe.chat_instance != null) entries.push(['chat_instance', String(unsafe.chat_instance)]);
  if (unsafe.start_param) entries.push(['start_param', String(unsafe.start_param)]);
  if (unsafe.can_send_after != null) entries.push(['can_send_after', String(unsafe.can_send_after)]);
  entries.push(['auth_date', String(unsafe.auth_date)]);
  entries.sort(([a], [b]) => a.localeCompare(b));
  const qs = new URLSearchParams();
  for (const [k, v] of entries) qs.set(k, v);
  qs.set('hash', String(unsafe.hash));
  return qs.toString();
}

function currentInitData() {
  const wa = window.Telegram?.WebApp;
  if (wa?.initData) return wa.initData;
  const fromHash = readInitDataFromHash();
  if (fromHash) return fromHash;
  const fromSearch = readInitDataFromSearch();
  if (fromSearch) return fromSearch;
  return buildInitDataFromUnsafe(wa?.initDataUnsafe);
}

async function resolveTelegramInitData(maxWaitMs = 1200) {
  const wa = window.Telegram?.WebApp;
  const isDesktop = ['tdesktop', 'macos', 'web', 'weba', 'unigram'].includes(wa?.platform);
  const deadline = Date.now() + (isDesktop ? Math.max(maxWaitMs, 2500) : maxWaitMs);
  while (Date.now() < deadline) {
    const initData = currentInitData();
    if (initData) return initData;
    window.Telegram?.WebApp?.ready?.();
    await sleep(100);
  }
  return currentInitData();
}

function isInsideTelegram() {
  const wa = window.Telegram?.WebApp;
  if (!wa) return false;
  if (wa.platform && wa.platform !== 'unknown') return true;
  if (currentInitData()) return true;
  if (wa.initDataUnsafe?.user?.id) return true;
  return false;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function haptic(type = 'light') {
  try {
    tg?.HapticFeedback?.impactOccurred(type);
  } catch { /* noop */ }
}

function initTelegramUi() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();

  const root = document.documentElement;
  const p = tg.themeParams || {};
  if (p.bg_color) root.style.setProperty('--tg-theme-bg-color', p.bg_color);
  if (p.text_color) root.style.setProperty('--tg-theme-text-color', p.text_color);
  if (p.hint_color) root.style.setProperty('--tg-theme-hint-color', p.hint_color);
  if (p.link_color) root.style.setProperty('--tg-theme-link-color', p.link_color);
  if (p.button_color) root.style.setProperty('--tg-theme-button-color', p.button_color);
  if (p.button_text_color) root.style.setProperty('--tg-theme-button-text-color', p.button_text_color);
  if (p.secondary_bg_color) root.style.setProperty('--tg-theme-secondary-bg-color', p.secondary_bg_color);

  if (p.bg_color) tg.setBackgroundColor(p.bg_color);
  if (p.secondary_bg_color) tg.setHeaderColor(p.secondary_bg_color);

  tg.BackButton.onClick(() => {
    if (activeChatId) closeChatOverlay();
  });

  tg.MainButton.onClick(() => saveSettings());
}

function setMainButtonVisible(visible) {
  if (!tg?.MainButton) return;
  if (visible) {
    tg.MainButton.setText('Сохранить настройки');
    tg.MainButton.color = tg.themeParams?.button_color || '#7c3aed';
    tg.MainButton.textColor = tg.themeParams?.button_text_color || '#ffffff';
    tg.MainButton.show();
  } else {
    tg.MainButton.hide();
  }
}

function showDenied(msg) {
  $('#boot-screen').classList.add('hidden');
  $('#denied-screen').classList.remove('hidden');
  $('#denied-text').textContent = msg;
}

function showApp() {
  $('#boot-screen').classList.add('hidden');
  $('#denied-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
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

async function authenticate() {
  if (!isInsideTelegram()) {
    showDenied('Откройте бота в Telegram → Menu (≡) внизу → «🎛 Админка»');
    return false;
  }

  const initData = await resolveTelegramInitData();
  if (!initData) {
    showDenied(
      'Telegram Desktop не передал данные входа. Закройте окно, обновите Telegram до последней версии и откройте снова через Menu → «🎛 Админка».'
    );
    return false;
  }

  const res = await fetch(`${API}/tg-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showDenied(data.error || 'Нет доступа. Проверьте TELEGRAM_ADMIN_IDS.');
    return false;
  }

  token = data.token;
  if (data.user?.name) {
    $('#header-greeting').textContent = `Привет, ${data.user.name}`;
  }
  return true;
}

function badge(status) {
  return `<span class="badge badge-${status}">${STATUS_LABELS[status] || status}</span>`;
}

function orderCard(o, showDate = false) {
  const statusSelect = `
    <select class="status-select" data-id="${o.id}">
      ${Object.keys(STATUS_LABELS).map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
    </select>`;
  return `
    <article class="order-card">
      <div class="order-top">
        <span class="order-id">#${esc(o.id)}</span>
        ${badge(o.status)}
      </div>
      <div class="order-pair">${esc(o.amount_from)} ${esc(o.from_currency)} → ${Number(o.amount_to).toFixed(6)} ${esc(o.to_currency)}</div>
      <div class="order-meta">${esc(o.address)}</div>
      ${showDate ? `<div class="order-meta">${formatDate(o.created_at)}</div>` : ''}
      <button type="button" class="btn-secondary btn-block btn-sm tg-order-check" data-id="${esc(o.id)}" data-address="${esc(o.address)}">🔍 Проверить адрес</button>
      ${statusSelect}
    </article>`;
}

function bindStatusSelects(root) {
  root.querySelectorAll('.status-select').forEach((sel) => {
    sel.onchange = async () => {
      try {
        haptic('medium');
        await api(`/orders/${sel.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: sel.value }),
        });
        await refreshAll();
      } catch (e) {
        tg?.showAlert?.(e.message) || alert(e.message);
      }
    };
  });
}

function updateChatBadge(n) {
  const b = $('#chat-badge');
  if (!b) return;
  if (n > 0) {
    b.textContent = n > 9 ? '9+' : n;
    b.classList.remove('hidden');
  } else {
    b.classList.add('hidden');
  }
}

async function loadOverview() {
  const data = await api('/dashboard');
  const s = data.stats;
  const st = data.settings;

  $('#stat-grid').innerHTML = `
    <div class="stat"><span>Всего</span><strong>${s.total}</strong></div>
    <div class="stat warn"><span>Ожидают</span><strong>${s.pending}</strong></div>
    <div class="stat ok"><span>Выполнено</span><strong>${s.completed}</strong></div>
    <div class="stat accent"><span>Наценка</span><strong>${st.markup_percent}%</strong></div>
  `;

  updateChatBadge(st.unread_chats || 0);

  const orders = await api('/orders?limit=5');
  const recent = $('#recent-orders');
  recent.innerHTML = orders.orders.length
    ? orders.orders.map((o) => orderCard(o)).join('')
    : '<p class="empty">Ордеров пока нет</p>';
  bindStatusSelects(recent);
}

async function loadOrders() {
  const { orders } = await api('/orders?limit=100');
  const list = $('#orders-list');
  list.innerHTML = orders.length
    ? orders.map((o) => orderCard(o, true)).join('')
    : '<p class="empty">Ордеров пока нет</p>';
  bindStatusSelects(list);
  list.querySelectorAll('.tg-order-check').forEach((btn) => {
    btn.onclick = async () => {
      try {
        haptic('medium');
        btn.disabled = true;
        const check = await runTgWalletCheck({ address: btn.dataset.address, orderId: btn.dataset.id });
        tg?.showAlert?.(`${check.risk?.label_ru || '—'}\n${formatUsd(check.usd_total)} · ${check.tx_count || 0} tx`) ||
          alert(`${check.risk?.label_ru} · ${formatUsd(check.usd_total)}`);
      } catch (e) {
        tg?.showAlert?.(e.message) || alert(e.message);
      } finally {
        btn.disabled = false;
      }
    };
  });
}

function chatSessionHeadline(s) {
  const seq = s.seq ? `#${s.seq}` : '#—';
  const order = s.order_id ? `Ордер #${s.order_id}` : 'без ордера';
  return `${seq} · ${order}`;
}

function renderChatSessions(sessions) {
  const box = $('#chat-sessions');
  if (!sessions.length) {
    box.innerHTML = '<p class="empty">Сообщений пока нет</p>';
    return;
  }
  box.innerHTML = sessions.map((s) => `
    <button type="button" class="chat-item" data-id="${esc(s.id)}">
      <div class="chat-item-top">
        <strong>${esc(chatSessionHeadline(s))}</strong>
        ${s.unread_admin > 0 ? `<span class="chat-unread">${s.unread_admin}</span>` : ''}
      </div>
      <div class="chat-preview">${esc([s.country || 'Неизвестно', s.city].filter(Boolean).join(', '))}</div>
      <div class="chat-device">${esc(s.device_label || 'Устройство неизвестно')}</div>
      <div class="chat-preview">${esc((s.last_preview || '').slice(0, 70))}</div>
      <div class="chat-time">IP: ${esc(s.ip || '—')} · ${formatDate(s.last_message_at)}</div>
    </button>
  `).join('');

  box.querySelectorAll('.chat-item').forEach((btn) => {
    btn.onclick = () => openChatOverlay(btn.dataset.id);
  });
}

async function loadChatSessions() {
  const { sessions } = await api('/chat/sessions');
  renderChatSessions(sessions);
  const unread = sessions.reduce((a, s) => a + (s.unread_admin > 0 ? 1 : 0), 0);
  updateChatBadge(unread);
}

function renderChatMessages(messages) {
  const box = $('#chat-messages');
  box.innerHTML = messages.map((m) => `
    <div class="bubble ${m.sender === 'admin' ? 'admin' : 'user'}">
      <div>${esc(m.body)}</div>
      <time>${formatDate(m.created_at)}</time>
    </div>
  `).join('');
  box.scrollTop = box.scrollHeight;
}

async function openChatOverlay(id) {
  activeChatId = id;
  haptic('light');
  const data = await api(`/chat/sessions/${id}`);
  const loc = [data.session.country, data.session.city].filter(Boolean).join(', ');
  $('#chat-overlay-meta').innerHTML = `
    <strong>${esc(chatSessionHeadline(data.session))}</strong>
    <span>${esc(loc || 'Посетитель')} · IP: ${esc(data.session.ip || '—')}</span>
    <span>${esc(data.session.device_label || 'Устройство неизвестно')}</span>
    ${data.session.order ? `<span>💱 ${esc(data.session.order.amount_from)} ${esc(data.session.order.from_currency)} → ${Number(data.session.order.amount_to).toFixed(6)} ${esc(data.session.order.to_currency)}</span>` : ''}
    <span id="chat-overlay-wallet" class="hint"></span>
  `;
  const walletEl = $('#chat-overlay-wallet');
  if (data.session.order?.address) {
    try {
      const { check } = await api(`/wallet-checks/latest?order_id=${encodeURIComponent(data.session.order.id)}&address=${encodeURIComponent(data.session.order.address)}`);
      if (check) {
        walletEl.innerHTML = `🔍 ${riskBadgeTg(check)} ${formatUsd(check.usd_total)} · ${check.tx_count || 0} tx`;
      } else {
        walletEl.innerHTML = `<button type="button" class="btn-secondary btn-sm" id="chat-wallet-check-btn">Проверить адрес ордера</button>`;
        $('#chat-wallet-check-btn').onclick = async () => {
          try {
            const check = await runTgWalletCheck({ address: data.session.order.address, orderId: data.session.order.id });
            walletEl.innerHTML = `🔍 ${riskBadgeTg(check)} ${formatUsd(check.usd_total)} · ${check.tx_count || 0} tx`;
          } catch (e) {
            tg?.showAlert?.(e.message);
          }
        };
      }
    } catch { /* ignore */ }
  }
  renderChatMessages(data.messages);
  $('#chat-overlay').classList.remove('hidden');
  $('#app').classList.add('chat-mode');
  tg?.BackButton?.show();
  loadChatSessions().catch(() => {});
}

function closeChatOverlay() {
  activeChatId = null;
  $('#chat-overlay').classList.add('hidden');
  $('#app').classList.remove('chat-mode');
  tg?.BackButton?.hide();
  loadChatSessions().catch(() => {});
}

async function loadSettingsForm() {
  const data = await api('/dashboard');
  const st = data.settings;
  $('#markup').value = st.markup_percent;
  $('#usd-rub').value = st.usd_rub_rate;
  $('#maintenance-mode').checked = !!st.maintenance_mode;
  $('#maintenance-mode').dataset.wasOn = st.maintenance_mode ? '1' : '';
  $('#order-ttl').value = st.order_ttl_minutes || 30;
  $('#deposit-wallet').value = st.deposit_wallet || '';
  $('#chat-operator').value = st.chat_operator_name || 'Bambusito228 Support';
  $('#chat-welcome').value = st.chat_welcome_message || '';
  Time24h.setValue('chat-work-start', st.chat_work_start || '09:00');
  Time24h.setValue('chat-work-end', st.chat_work_end || '21:00');
  $('#maintenance-schedule-enabled').checked = !!st.maintenance_schedule_enabled;
  Time24h.setValue('maintenance-schedule-start', st.maintenance_schedule_start || '02:00');
  Time24h.setValue('maintenance-schedule-end', st.maintenance_schedule_end || '08:00');
  $('#rate-provider').value = st.rate_provider || 'auto';
  await loadRateStatus().catch(() => {});
}

function switchTgSettings(screen) {
  activeTgSettings = screen;
  $$('.tg-pill').forEach((b) => b.classList.toggle('active', b.dataset.tgSettings === screen));
  $$('.tg-settings-screen').forEach((s) => s.classList.toggle('active', s.dataset.tgScreen === screen));
  if (screen === 'rates') loadRateStatus().catch(() => {});
}

async function loadRateStatus() {
  const data = await api('/rate-status');
  const line = data.activeError
    ? `Ошибка: ${data.activeError}`
    : `Сейчас: ${data.activeProviderLabel || '—'}${data.activePrice ? ` · BTC $${Number(data.activePrice).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}`;
  $('#rate-active-line').textContent = line;

  const probes = data.probes || [];
  $('#rate-probes').innerHTML = probes.map((p) => `
    <div class="probe ${p.ok ? 'ok' : 'fail'}">
      <strong>${esc(p.label)}</strong>
      <small>${p.ok ? `$${Number(p.price).toFixed(0)} · ${p.latencyMs}ms` : esc((p.error || 'fail').slice(0, 40))}</small>
    </div>
  `).join('');
}

function toast(msg, ok = true) {
  const el = $('#settings-toast');
  el.textContent = msg;
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  setTimeout(() => { el.textContent = ''; }, 2500);
}

async function saveSettings() {
  try {
    haptic('medium');
    const payload = {
      markup_percent: $('#markup').value,
      usd_rub_rate: $('#usd-rub').value,
      maintenance_mode: $('#maintenance-mode').checked,
      order_ttl_minutes: $('#order-ttl').value,
      deposit_wallet: $('#deposit-wallet').value,
      chat_operator_name: $('#chat-operator').value,
        chat_welcome_message: $('#chat-welcome').value,
        chat_work_start: Time24h.getValue('chat-work-start'),
        chat_work_end: Time24h.getValue('chat-work-end'),
        maintenance_schedule_enabled: $('#maintenance-schedule-enabled').checked,
        maintenance_schedule_start: Time24h.getValue('maintenance-schedule-start'),
        maintenance_schedule_end: Time24h.getValue('maintenance-schedule-end'),
        rate_provider: $('#rate-provider').value,
    };
    if (payload.maintenance_mode && !$('#maintenance-mode').dataset.wasOn) {
      const ok = await new Promise((resolve) => {
        if (tg?.showConfirm) tg.showConfirm('Выключить обмен для клиентов?', resolve);
        else resolve(confirm('Выключить обмен для клиентов?'));
      });
      if (!ok) {
        $('#maintenance-mode').checked = false;
        payload.maintenance_mode = false;
      }
    }
    await api('/settings', { method: 'PATCH', body: JSON.stringify(payload) });
    toast('Сохранено');
    tg?.MainButton?.hideProgress?.();
    await refreshAll();
  } catch (e) {
    toast(e.message, false);
    tg?.showAlert?.(e.message);
  }
}

function switchTab(tab) {
  activeTab = tab;
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.panel').forEach((p) => p.classList.remove('active'));
  $(`#panel-${tab}`).classList.add('active');
  $('#header-title').textContent = TAB_TITLES[tab] || tab;
  setMainButtonVisible(tab === 'settings' && (activeTgSettings === 'quick' || activeTgSettings === 'schedule' || activeTgSettings === 'wallet' || activeTgSettings === 'rates' || activeTgSettings === 'chat' || activeTgSettings === 'order'));

  if (tab === 'orders') loadOrders().catch(onError);
  if (tab === 'checker') loadCheckerTg().catch(onError);
  if (tab === 'chat') loadChatSessions().catch(onError);
  if (tab === 'settings') loadSettingsForm().catch(onError);
  if (tab === 'overview') loadOverview().catch(onError);
}

async function refreshAll() {
  if (activeTab === 'overview') await loadOverview();
  if (activeTab === 'orders') await loadOrders();
  if (activeTab === 'checker') await loadCheckerTg();
  if (activeTab === 'chat' && !activeChatId) await loadChatSessions();
  if (activeTab === 'settings') await loadSettingsForm();
  if (activeChatId) {
    const data = await api(`/chat/sessions/${activeChatId}`);
    renderChatMessages(data.messages);
  }
}

function onError(e) {
  if (String(e.message).includes('unauthorized') || String(e.message).includes('invalid_token')) {
    showDenied('Сессия истекла. Закройте и откройте Mini App снова.');
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    refreshAll().catch(() => {});
  }, 8000);
}

$$('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    switchTab(btn.dataset.tab);
  });
});

$('#btn-refresh').addEventListener('click', () => {
  haptic('light');
  refreshAll().catch(onError);
});

$('#btn-rate-check').addEventListener('click', () => {
  haptic('light');
  loadRateStatus().catch((e) => toast(e.message, false));
});

$('#tg-checker-run').addEventListener('click', async () => {
  const address = $('#tg-checker-address').value.trim();
  if (!address) return toast('Укажите адрес', false);
  try {
    haptic('medium');
    $('#tg-checker-run').disabled = true;
    const check = await runTgWalletCheck({
      address,
      network: $('#tg-checker-network').value || undefined,
    });
    const box = $('#tg-checker-result');
    box.innerHTML = renderTgCheckCard(check);
    box.classList.remove('hidden');
    loadCheckerJournalTg().catch(() => {});
  } catch (e) {
    toast(e.message, false);
    tg?.showAlert?.(e.message);
  } finally {
    $('#tg-checker-run').disabled = false;
  }
});

$$('.tg-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    switchTgSettings(btn.dataset.tgSettings);
  });
});

$('#chat-back').addEventListener('click', closeChatOverlay);

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeChatId) return;
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    haptic('light');
    await api(`/chat/sessions/${activeChatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    input.value = '';
    await openChatOverlay(activeChatId);
  } catch (err) {
    tg?.showAlert?.(err.message) || alert(err.message);
  }
});

(async function boot() {
  initTelegramUi();
  try {
    await sleep(50);
    const ok = await authenticate();
    if (!ok) return;
    showApp();
    switchTab('overview');
    startPolling();
  } catch (e) {
    showDenied(e.message || 'Ошибка входа');
  }
})();
